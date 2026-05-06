// Tiny static file server for local play / smoke testing.
// Run: node serve.mjs   then open http://localhost:8765/
//
// SECURITY POSTURE — this is a DEVELOPMENT server. It is hardened against
// the obvious abuse cases (path traversal, hidden-file exposure, method
// abuse, slowloris, missing headers) so that running it on a Wi-Fi LAN
// for phone testing is not a foot-gun, but it is still NOT intended as a
// production-grade origin. For production, put the static files behind a
// real edge (nginx, caddy, Cloudflare Pages, etc.).
//
// What this server does to defend itself:
//   • Method allowlist (GET / HEAD only — blocks PUT / DELETE / OPTIONS / etc.)
//   • Strict URL parsing + length cap + control-char + NUL-byte rejection
//   • Path-traversal defense (literal `..` rejection + post-resolve
//     `startsWith(ROOT + sep)` check, with realpath() to block symlink
//     escape)
//   • Hidden-file guard (any path segment starting with `.` is blocked,
//     so .git/, .env, .DS_Store, .vscode/ etc. cannot be accidentally
//     downloaded)
//   • Strict extension allowlist for MIME — unknown extensions are 404,
//     so source backups (.bak, .orig, .swp, dotfiles) are inaccessible
//   • Connection / request timeouts to absorb slowloris-style attacks
//   • Defense-in-depth security response headers on every reply (CSP,
//     X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
//     Permissions-Policy, COOP, CORP, …)
//   • No request bodies are read — eliminates body-parser DoS
//
// Configurable via env:
//   PORT           — listen port (default 8765)
//   HOST           — bind address (default 0.0.0.0 for LAN access; set to
//                    127.0.0.1 to make this strictly localhost-only)
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const PORT = Number(process.env.PORT) || 8765;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const ROOT_WITH_SEP = ROOT + path.sep;

// Hard caps. The numbers are intentionally generous for a static server,
// but tight enough to refuse obviously-pathological inputs immediately.
const MAX_URL_LENGTH = 2048;
const MAX_HEADERS_TIMEOUT_MS  = 10_000;
const MAX_REQUEST_TIMEOUT_MS  = 30_000;
const KEEP_ALIVE_TIMEOUT_MS   = 5_000;

// Strict extension allowlist. ANY extension not on this list returns
// 404. This is how we make sure backup files (foo.js.bak), editor swap
// files (.swp), dotfiles, source archives (.zip) etc. cannot be served
// even if they accidentally end up under the project root.
const MIME = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "application/javascript; charset=utf-8",
  ".mjs":   "application/javascript; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".json":  "application/json; charset=utf-8",
  ".svg":   "image/svg+xml",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".webp":  "image/webp",
  ".ico":   "image/x-icon",
  ".txt":   "text/plain; charset=utf-8",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".map":   "application/json; charset=utf-8",
};

// Defense-in-depth security headers on every response. See SECURITY.md
// for rationale on each directive. These complement (rather than replace)
// the CSP <meta> tag in index.html, since headers cover ALL responses
// including 4xx error pages, while meta only covers the page that loads
// it.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self'; " +                  // NO inline scripts in this app
    "style-src 'self' 'unsafe-inline'; " +   // boot-splash CSS + svg style attrs
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "media-src 'self' blob:; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
    "magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
};

function send(res, code, body, extra = {}) {
  // Strip Node's default Server header (information disclosure).
  if (res.removeHeader) res.removeHeader("Server");
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(body);
}

/**
 * Validate + normalize the request path. Returns a safe, decoded,
 * leading-slash-trimmed relative path on success, or null on rejection.
 *
 * Rejection rules (each is a separate, layered check so a single bypass
 * does not lower the bar):
 *   1) NUL byte / control character anywhere
 *   2) Malformed percent-encoding (decodeURIComponent throws)
 *   3) Length cap (post-decode)
 *   4) Any path segment named `..` (traversal)
 *   5) Any path segment starting with `.` (hidden file/folder)
 */
function sanitizePath(rawPath) {
  if (typeof rawPath !== "string") return null;
  if (rawPath.length > MAX_URL_LENGTH) return null;
  if (/[\x00-\x1f]/.test(rawPath)) return null;

  let decoded;
  try { decoded = decodeURIComponent(rawPath); }
  catch { return null; }
  if (decoded.length > MAX_URL_LENGTH) return null;
  if (/[\x00-\x1f]/.test(decoded)) return null;

  const segments = decoded.split(/[\\/]+/);
  for (const seg of segments) {
    if (seg === "..") return null;
    if (seg.length > 0 && seg[0] === ".") return null;   // hidden files
  }
  return decoded;
}

const server = http.createServer(async (req, res) => {
  // ── Method allowlist ────────────────────────────────────────────────
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "method not allowed", { Allow: "GET, HEAD" });
  }

  // ── URL length sanity cap ──────────────────────────────────────────
  if (!req.url || req.url.length > MAX_URL_LENGTH) {
    return send(res, 414, "uri too long");
  }

  // ── Extract raw path from req.url WITHOUT WHATWG URL normalization.
  //    new URL('/../foo', base).pathname collapses `..` segments out
  //    SILENTLY, so `/../package.json` would arrive at our validator
  //    already laundered to `/package.json`. By splitting on `?` / `#`
  //    ourselves we keep the attacker's traversal markers visible to
  //    sanitizePath, which then rejects them. ────────────────────────
  let rawPath;
  {
    const qIdx = req.url.indexOf("?");
    const hIdx = req.url.indexOf("#");
    let end = req.url.length;
    if (qIdx >= 0 && qIdx < end) end = qIdx;
    if (hIdx >= 0 && hIdx < end) end = hIdx;
    rawPath = req.url.slice(0, end);
  }

  // ── Path validation ────────────────────────────────────────────────
  let safePath = sanitizePath(rawPath);
  if (safePath == null) return send(res, 400, "bad request");
  if (safePath === "/" || safePath === "") safePath = "/index.html";

  const relPath = safePath.replace(/^[\\/]+/, "");

  // ── Resolve under ROOT and re-verify (defends against Windows path
  //    quirks, mixed slashes, encoded NULs, etc.) ─────────────────────
  const candidate = path.resolve(ROOT, relPath);
  if (candidate !== ROOT && !candidate.startsWith(ROOT_WITH_SEP)) {
    return send(res, 403, "forbidden");
  }

  // ── Symlink-traversal defense via realpath ─────────────────────────
  let realFilepath;
  try {
    realFilepath = await fs.realpath(candidate);
  } catch (e) {
    if (e.code === "ENOENT") return send(res, 404, "not found");
    return send(res, 500, "internal error");
  }
  if (realFilepath !== ROOT && !realFilepath.startsWith(ROOT_WITH_SEP)) {
    return send(res, 403, "forbidden");
  }

  // ── Strict MIME allowlist on the FINAL extension ───────────────────
  const ext = path.extname(realFilepath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return send(res, 404, "not found");

  let stat;
  try { stat = await fs.stat(realFilepath); }
  catch { return send(res, 404, "not found"); }
  if (!stat.isFile()) return send(res, 404, "not found");

  // ── HEAD: headers only ─────────────────────────────────────────────
  if (req.method === "HEAD") {
    return send(res, 200, "", {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
    });
  }

  let data;
  try { data = await fs.readFile(realFilepath); }
  catch { return send(res, 500, "internal error"); }

  send(res, 200, data, { "Content-Type": mime });
});

// ── Slowloris / hanging-connection guards ────────────────────────────
// Three independent timers, any one of which will kill a misbehaving
// connection. Belt + suspenders + a third backup belt.
server.headersTimeout   = MAX_HEADERS_TIMEOUT_MS;          // header phase
server.requestTimeout   = MAX_REQUEST_TIMEOUT_MS;          // whole request
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;           // idle keep-alive
server.timeout          = MAX_HEADERS_TIMEOUT_MS;          // socket inactivity

server.maxHeadersCount  = 50;                              // header bomb cap

// Node by default emits a 'timeout' event but does NOT close the
// socket — we have to do it explicitly. Without this listener, slow
// clients that have already finished the headers but still hold the
// socket open could linger past `headersTimeout`.
server.on("timeout", (socket) => {
  try { socket.destroy(); } catch { /* socket already gone */ }
});

server.on("clientError", (err, socket) => {
  // Garbage at the protocol level — close the socket without giving
  // back any information that could help fingerprint the server.
  try { socket.destroy(); } catch { /* socket already gone */ }
});

// Per-socket inactivity timer. Fires the same window as headersTimeout
// regardless of which Node-internal phase the socket is stuck in
// (header parse, body read, response write, …). On Node 18+ this is
// a no-op duplicate of server.timeout, but it guarantees the same
// behavior on older runtimes.
server.on("connection", (socket) => {
  socket.setTimeout(MAX_HEADERS_TIMEOUT_MS, () => {
    try { socket.destroy(); } catch { /* gone */ }
  });
});

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) {
        out.push({ name, address: info.address });
      }
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log(`\n箭头快跑 dev server running\n`);
  console.log(`  本机:     http://localhost:${PORT}/`);
  if (HOST === "0.0.0.0" || HOST === "::") {
    for (const { name, address } of lanAddresses()) {
      console.log(`  局域网:   http://${address}:${PORT}/   (${name})`);
    }
    console.log(`\n手机访问步骤：`);
    console.log(`  1. 确认手机和电脑在同一个 Wi-Fi`);
    console.log(`  2. 用上面"局域网"地址在手机浏览器打开`);
    console.log(`  3. 第一次打不开？多半是 Windows 防火墙拦了。`);
    console.log(`     在 [管理员] PowerShell 执行一次：`);
    console.log(`     New-NetFirewallRule -DisplayName 'Arrow Run Dev (8765)' \\\n` +
                `       -Direction Inbound -Action Allow -Protocol TCP \\\n` +
                `       -LocalPort ${PORT} -Profile Private,Domain\n`);
    console.log(`⚠ 注意：服务监听 0.0.0.0，仅供 LAN 内开发调试。生产请用 nginx/caddy/CDN。`);
    console.log(`  想限制为仅本机访问：HOST=127.0.0.1 node serve.mjs\n`);
  } else {
    console.log(`\n  仅本机访问 (HOST=${HOST})。\n`);
  }
});
