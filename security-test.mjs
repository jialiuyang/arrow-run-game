// Security regression tests for serve.mjs.
//
// Spins up the dev server on a unique port, runs ~15 attack-pattern
// requests against it, asserts the responses, then shuts down. No real
// vulnerabilities are required to run this — these tests just make sure
// the existing hardening doesn't silently regress.
//
// Run:   node security-test.mjs
// Exits non-zero if any test fails.

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";

const PORT = 8801;          // separate port so the live dev server can stay running
const HOST = "127.0.0.1";
const ROOT_URL = `http://${HOST}:${PORT}`;

let passed = 0, failed = 0;
function ok(msg)   { passed++; console.log("  ✓", msg); }
function fail(msg) { failed++; console.log("  ✗ FAIL:", msg); }

function req(method, path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: HOST, port: PORT, path, method, headers: extraHeaders },
      (res) => {
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    r.on("error", reject);
    r.end();
  });
}

// ── Spin up the server in a child process ──────────────────────────────
console.log(`Spawning serve.mjs on ${ROOT_URL} ...`);
const server = spawn(process.execPath, ["serve.mjs"], {
  env: { ...process.env, PORT: String(PORT), HOST },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});       // suppress
server.stderr.on("data", () => {});

// Wait for the server to come up
async function waitForUp(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await req("GET", "/");
      if (r.status === 200) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("server did not start in time");
}

(async () => {
  await waitForUp();
  console.log("\n[Test] Healthy GET / returns 200 with all security headers");
  {
    const r = await req("GET", "/");
    if (r.status === 200) ok("200 OK on /"); else fail(`expected 200 got ${r.status}`);
    const required = [
      "content-security-policy",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
    ];
    for (const h of required) {
      if (r.headers[h]) ok(`header ${h} present`);
      else fail(`missing header ${h}`);
    }
    if ((r.headers["x-content-type-options"] || "").toLowerCase() === "nosniff")
      ok("X-Content-Type-Options=nosniff");
    else fail("X-Content-Type-Options should be nosniff");
    if ((r.headers["x-frame-options"] || "").toUpperCase() === "DENY")
      ok("X-Frame-Options=DENY");
    else fail("X-Frame-Options should be DENY");
    const csp = r.headers["content-security-policy"] || "";
    if (csp.includes("script-src 'self'") && !csp.includes("'unsafe-eval'") && !csp.includes("script-src 'self' 'unsafe-inline'"))
      ok("CSP script-src is strict (no 'unsafe-eval' / no inline scripts)");
    else fail(`CSP script-src not strict: ${csp}`);
  }

  console.log("\n[Test] Method allowlist");
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await req(m, "/");
    if (r.status === 405) ok(`${m} → 405`);
    else fail(`${m} → expected 405 got ${r.status}`);
  }
  {
    const r = await req("HEAD", "/");
    if (r.status === 200 && (!r.body || r.body.length === 0)) ok("HEAD / → 200 + empty body");
    else fail(`HEAD / → expected 200 empty got ${r.status} bodyLen=${r.body.length}`);
  }

  console.log("\n[Test] Path-traversal rejection");
  for (const path of [
    "/../package.json",
    "/../../etc/passwd",
    "/foo/../../package.json",
    "/%2e%2e/package.json",
    "/%2e%2e%2fpackage.json",
    "/..%2fpackage.json",
  ]) {
    const r = await req("GET", path);
    if (r.status === 400 || r.status === 403 || r.status === 404)
      ok(`traversal "${path}" blocked (${r.status})`);
    else fail(`traversal "${path}" returned ${r.status}`);
  }

  console.log("\n[Test] NUL byte / control characters");
  for (const path of ["/index.html%00.txt", "/index.html%01"]) {
    const r = await req("GET", path);
    if (r.status === 400 || r.status === 404) ok(`control-char "${path}" blocked (${r.status})`);
    else fail(`control-char "${path}" returned ${r.status}`);
  }

  console.log("\n[Test] Hidden-file rejection");
  for (const path of ["/.git/config", "/.env", "/.DS_Store", "/.vscode/settings.json"]) {
    const r = await req("GET", path);
    if (r.status === 400 || r.status === 404) ok(`hidden "${path}" blocked (${r.status})`);
    else fail(`hidden "${path}" returned ${r.status}`);
  }

  console.log("\n[Test] Extension allowlist");
  for (const path of ["/serve.bak", "/secrets.zip", "/foo.exe", "/foo.sh"]) {
    const r = await req("GET", path);
    if (r.status === 404) ok(`unknown ext "${path}" → 404`);
    else fail(`unknown ext "${path}" returned ${r.status}`);
  }

  console.log("\n[Test] URL length cap");
  {
    const path = "/" + "a".repeat(3000) + ".html";
    const r = await req("GET", path);
    if (r.status === 414 || r.status === 400) ok(`oversize URL → ${r.status}`);
    else fail(`oversize URL returned ${r.status}`);
  }

  console.log("\n[Test] Server header is removed (no fingerprinting)");
  {
    const r = await req("GET", "/");
    if (!r.headers["server"]) ok("no Server header");
    else fail(`Server header leaked: ${r.headers["server"]}`);
  }

  console.log("\n[Test] HTTP timeouts configured (slowloris guard)");
  {
    // Open a raw socket, send only a partial request, expect the server
    // to slam the connection within ~12s instead of holding forever.
    const sock = net.connect(PORT, HOST);
    sock.write("GET / HTTP/1.1\r\nHost: localhost\r\n");   // no terminator
    const got = await new Promise((resolve) => {
      let closed = false;
      sock.on("close", () => { if (!closed) { closed = true; resolve("closed"); } });
      sock.on("error", () => { if (!closed) { closed = true; resolve("error"); } });
      setTimeout(() => { if (!closed) { closed = true; sock.destroy(); resolve("timeout-not-fired"); } }, 12_000);
    });
    if (got === "closed" || got === "error") ok(`partial-request connection torn down (${got})`);
    else fail(`partial-request still alive after 12s (${got})`);
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  server.kill();
  // Give Node a tick to flush the kill
  setTimeout(() => process.exit(failed === 0 ? 0 : 1), 200);
})().catch((e) => {
  console.error("FAILED:", e);
  server.kill();
  process.exit(1);
});
