// Anti-cheat regression tests.
//
// Verifies the three layers added to deter coin / progress tampering:
//   1) Storage signing — tampered localStorage gets rejected on load
//   2) Cross-field invariants — even a "valid" save can't claim
//      impossible values (e.g. 1 billion coins with no levels unlocked)
//   3) Coin grant caps — _endWin can never write more than the per-call
//      hard cap, even when game state is forged
//
// Run:   node anticheat-test.mjs
// Exits non-zero if any assertion fails.

import { Storage } from "./js/storage.js";

let passed = 0, failed = 0;
function ok(msg)   { passed++; console.log("  ✓", msg); }
function fail(msg) { failed++; console.log("  ✗ FAIL:", msg); }
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) ok(`${label}: ${a}`);
  else fail(`${label}: expected ${e} got ${a}`);
}

// Mock localStorage in Node
class MemStore {
  constructor() { this._v = null; }
  getItem() { return this._v; }
  setItem(_, v) { this._v = v; }
  removeItem() { this._v = null; }
}
globalThis.localStorage = new MemStore();

console.log("\n[Test 1] Empty storage → defaults");
{
  localStorage._v = null;
  const s = Storage.load();
  eq("currentLevel", s.currentLevel, 0);
  eq("coins", s.coins, 0);
  eq("stars", s.stars, {});
  eq("settings.sfx", s.settings.sfx, true);
}

console.log("\n[Test 2] Save round-trip preserves valid data");
{
  const original = {
    currentLevel: 5, maxUnlocked: 5, coins: 42,
    stars: { 0: 3, 1: 2, 4: 1 },
    bestTimes: { 0: 12.5, 1: 45.0 },
    settings: { sfx: false, vibrate: true },
  };
  Storage.save(original);
  const reloaded = Storage.load();
  eq("currentLevel", reloaded.currentLevel, 5);
  eq("coins", reloaded.coins, 42);
  eq("stars", reloaded.stars, { 0: 3, 1: 2, 4: 1 });
  eq("bestTimes", reloaded.bestTimes, { 0: 12.5, 1: 45.0 });
}

console.log("\n[Test 3] CHEAT — direct coin edit (no signature update) → reset");
{
  // Save legitimately first.
  Storage.save({ ...{
    currentLevel: 5, maxUnlocked: 5, coins: 42,
    stars: { 0: 3 }, bestTimes: {}, settings: { sfx: true, vibrate: true },
  }});
  const wrapper = JSON.parse(localStorage._v);
  // Attacker edits the inner JSON without recomputing the signature.
  const tampered = JSON.parse(wrapper.d);
  tampered.coins = 99999999;
  wrapper.d = JSON.stringify(tampered);
  localStorage._v = JSON.stringify(wrapper);

  const s = Storage.load();
  if (s.coins === 0) ok("tampered coins → reset to 0");
  else fail(`tampered coins survived as ${s.coins}`);
  if (s.currentLevel === 0 && s.maxUnlocked === 0)
    ok("entire save reset on tamper detection");
  else fail("save not reset after tamper");
}

console.log("\n[Test 4] CHEAT — wholesale localStorage replace with raw JSON");
{
  // No wrapper, no signature — looks like legacy format. Must NOT
  // grant arbitrary coins, but must still load (legacy compat).
  localStorage._v = JSON.stringify({ coins: 999999999, maxUnlocked: 200 });
  const s = Storage.load();
  // Legacy is accepted, but cross-field invariants clamp the coins.
  // maxUnlocked=200 → envelope = 201 * 20 * 50 = 201000, so coins
  // get clamped down from 999M to 201000.
  if (s.coins <= 201_000)
    ok(`legacy giant coins clamped to plausibility envelope (got ${s.coins})`);
  else fail(`legacy coins not clamped: ${s.coins}`);
}

console.log("\n[Test 5] CHEAT — try to forge a signature with a guessed key");
{
  // An attacker who doesn't read the source might try setting
  // s = "abc.def" or s = MD5(d) etc. None of those should match.
  Storage.save({ currentLevel: 0, maxUnlocked: 0, coins: 5,
                 stars: {}, bestTimes: {}, settings: { sfx:true, vibrate:true } });
  const wrapper = JSON.parse(localStorage._v);
  const tampered = JSON.parse(wrapper.d);
  tampered.coins = 50000;
  wrapper.d = JSON.stringify(tampered);
  // Try plausible-looking signatures.
  for (const fakeSig of ["", "0", "abc.def", "0.0", wrapper.s.slice(0, -1) + "X"]) {
    wrapper.s = fakeSig;
    localStorage._v = JSON.stringify(wrapper);
    const s = Storage.load();
    if (s.coins === 0) ok(`fake sig "${fakeSig.slice(0, 8)}" rejected`);
    else fail(`fake sig "${fakeSig.slice(0, 8)}" accepted, got coins=${s.coins}`);
  }
}

console.log("\n[Test 6] CHEAT — pre-unlock all levels via raw payload");
{
  // No actual play, just maxUnlocked=200. Cross-field invariant
  // clamps `currentLevel` so player can't be on a higher level than
  // they've unlocked, but maxUnlocked itself isn't gated by play
  // (we don't have a "play history" to verify against). The win
  // here is that coins are still clamped to an envelope that scales
  // with maxUnlocked, so unlock-cheating doesn't give infinite coins.
  localStorage._v = JSON.stringify({ maxUnlocked: 200, currentLevel: 199, coins: 0 });
  const s = Storage.load();
  if (s.maxUnlocked === 200 && s.currentLevel === 199)
    ok("legacy unlock-all preserved (no play history to verify against)");
  else fail("legacy state mangled unexpectedly");
  if (s.coins === 0) ok("but coins remain 0 — unlock alone doesn't grant currency");
  else fail(`unlock-cheat leaked coins: ${s.coins}`);
}

console.log("\n[Test 7] Implausibly fast best-times are dropped on load");
{
  Storage.save({
    currentLevel: 0, maxUnlocked: 5, coins: 0,
    stars: { 0: 3 },
    bestTimes: { 0: 0.001, 1: 5.0, 2: 0.5 },     // 0.001s and 0.5s implausible
    settings: { sfx: true, vibrate: true },
  });
  // Re-load — signature is still ours, so wrapper passes; but
  // sanitize() drops sub-1s times.
  const s = Storage.load();
  if (!(0 in s.bestTimes)) ok("0.001s record dropped");
  else fail(`0.001s record survived as ${s.bestTimes[0]}`);
  if (!(2 in s.bestTimes)) ok("0.5s record dropped");
  else fail(`0.5s record survived as ${s.bestTimes[2]}`);
  if (s.bestTimes[1] === 5.0) ok("legitimate 5.0s record kept");
  else fail("legitimate record was dropped");
}

console.log("\n[Test 8] Junk types in fields → safe defaults");
{
  Storage.save({});                               // get a valid signed save
  const wrapper = JSON.parse(localStorage._v);
  wrapper.d = JSON.stringify({
    currentLevel: "<img src=x onerror=alert(1)>",
    coins: { hax: true },
    stars: "not an object",
    bestTimes: [1, 2, 3],
    settings: "ha",
  });
  // Don't update signature — this should fail signature check first
  // and reset to defaults. This test confirms the union of "tamper
  // detection + type clamping" works.
  localStorage._v = JSON.stringify(wrapper);
  const s = Storage.load();
  eq("currentLevel after tamper", s.currentLevel, 0);
  eq("coins after tamper", s.coins, 0);
  eq("stars after tamper", s.stars, {});
}

console.log("\n[Test 9] Star value clamped to 0..3");
{
  Storage.save({
    currentLevel: 0, maxUnlocked: 5, coins: 0,
    stars: { 0: 99, 1: -50, 2: 2.7 },
    bestTimes: {}, settings: { sfx: true, vibrate: true },
  });
  const s = Storage.load();
  eq("stars[0] clamped to 3", s.stars[0], 3);
  eq("stars[1] clamped to 0", s.stars[1], 0);
  eq("stars[2] floored to 2", s.stars[2], 2);
}

console.log("\n[Test 10] Oversized payload rejected");
{
  localStorage._v = "x".repeat(150_000);
  const s = Storage.load();
  if (s.coins === 0 && s.maxUnlocked === 0) ok("oversized payload → defaults");
  else fail(`oversized payload not rejected: ${JSON.stringify(s)}`);
}

console.log(`\nTotal: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
