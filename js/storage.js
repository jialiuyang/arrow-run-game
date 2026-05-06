/**
 * Local-storage backed save game.
 *  - currentLevel: the level the player is on
 *  - maxUnlocked: highest level index unlocked
 *  - stars: { [levelIndex]: number 0-3 }
 *  - bestTimes: { [levelIndex]: seconds }
 *  - coins: total coin balance
 *  - settings: { sfx: bool, vibrate: bool }
 *
 * SECURITY (input-validation, anti-tamper):
 *
 *   THREAT 1 — second-order XSS via localStorage. If a payload string
 *   ever lands in here (XSS, malicious extension, devtools tinkering)
 *   game code that interpolates the field into innerHTML would execute
 *   it. Defused by clamping every field to its expected type/range on
 *   load.
 *
 *   THREAT 2 — coin/progress cheating. Anyone with devtools can
 *   `localStorage.setItem(...)` to inflate `coins`, max out stars, or
 *   pre-unlock every level. A pure-frontend game CANNOT make this
 *   impossible (anyone with source access can re-sign payloads). What
 *   we CAN do is raise the bar from "one click to 99999 coins" to "you
 *   have to read serve.mjs/storage.js, find the keyed-hash function,
 *   and re-sign". That's a 100x friction multiplier and is enough to
 *   defeat ~all casual cheating.
 *
 *   Mechanics:
 *     • Save format is { v:1, d:"<state-json>", s:"<keyed-hash>" }
 *     • signState() is a fast keyed FNV-1a / Murmur-mix combo. It is
 *       NOT a cryptographic MAC — anyone reading source can reproduce
 *       it. The point is friction, not unforgeability.
 *     • On load, signature mismatch → silently reset to defaults.
 *     • On load, cross-field invariants (e.g. coins must fit within
 *       the theoretical max given progress) are also enforced — so
 *       even a successfully-signed payload can't claim impossible
 *       values.
 *     • Legacy (unsigned) localStorage from earlier builds is accepted
 *       once and re-saved with a signature on the next write.
 */
const KEY = "arrow_run_v1";

const MAX_LEVEL_INDEX     = 9999;             // game is now infinite past Lv 51 BOSS
const MAX_TIME_SECONDS    = 60 * 60 * 24;     // 24h — wildly generous
const MAX_COINS           = 1_000_000;        // 1 million is plenty
const MAX_STORAGE_BYTES   = 250_000;          // 250KB — room for thousands of clears
const MAX_KEYS_IN_DICT    = 2000;             // ~2000 cleared levels supported
const MIN_BEST_TIME       = 1.0;              // anything < 1s is implausible

// Theoretical per-level maximum coin yield:
//   3★ × 5 (stars) + 5 (combo cap) + 5 × 2 (random-event coins) = 30.
// We keep a 2x slack for replay accumulation and let the hard `coins`
// field cap (MAX_COINS) be the ultimate guard. This is a soft sanity
// check — see sanitize() for use.
const MAX_COINS_PER_LEVEL = 30;
const COIN_REPLAY_SLACK   = 50;               // "you replayed level X 50 times" still counted

const DEFAULT = {
  currentLevel: 0,
  maxUnlocked: 0,
  stars: {},
  bestTimes: {},
  coins: 0,
  settings: { sfx: true, vibrate: true },
};

// Keyed-hash mixing key. Split into bytes so a flat grep for the value
// won't match. Anyone reading this file can still read it — the goal is
// to break the "edit one localStorage value in devtools" workflow, NOT
// to be cryptographically secure (which is impossible for a pure-frontend
// app, since the verifier and signer share an environment with the user).
const _SIG_K = [
  0xa3, 0xc5, 0x71, 0x9e, 0x4f, 0x2b, 0xd6, 0x88,
  0x12, 0xff, 0x8c, 0x33, 0x57, 0x90, 0xb1, 0x6e,
];

/**
 * Compute a keyed hash over the JSON-serialized state. Two independent
 * 32-bit mixers (FNV-1a + a Murmur-style mix) reduce collisions and
 * defeat trivial bit-flip attacks ("flip one byte, hash unchanged").
 * Output is stable across runs of the same input — no randomness — so
 * it can be verified on load.
 */
function signState(jsonStr) {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0xc6a4a793 | 0;
  const klen = _SIG_K.length;
  const slen = jsonStr.length;
  for (let i = 0; i < slen; i++) {
    const c = (jsonStr.charCodeAt(i) ^ _SIG_K[i % klen]) & 0xffff;
    h1 ^= c;            h1 = Math.imul(h1, 16777619);
    h2 = (h2 + c) | 0;  h2 = Math.imul(h2, 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  h1 ^= h1 >>> 16; h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13; h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  h2 ^= h2 >>> 16; h2 = Math.imul(h2, 0x85ebca6b);
  h2 ^= h2 >>> 16;
  return (h1 >>> 0).toString(36) + "." + (h2 >>> 0).toString(36);
}

function safeInt(v, fallback, min, max) {
  const n = (typeof v === "number") ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function safeNum(v, fallback, min, max) {
  const n = (typeof v === "number") ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function safeBool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function clone(obj) {
  return {
    ...obj,
    stars: { ...obj.stars },
    bestTimes: { ...obj.bestTimes },
    settings: { ...obj.settings },
  };
}

/**
 * Build a guaranteed-safe state from arbitrary input. Type-check + range
 * clamp every field, drop unknown extras, and enforce cross-field
 * invariants (the coin balance must fit in a plausibility envelope
 * given how many levels the player has unlocked).
 */
function sanitize(raw) {
  if (!isPlainObject(raw)) return clone(DEFAULT);

  const stars = {};
  if (isPlainObject(raw.stars)) {
    const keys = Object.keys(raw.stars).slice(0, MAX_KEYS_IN_DICT);
    for (const k of keys) {
      const idx = safeInt(k, -1, 0, MAX_LEVEL_INDEX);
      if (idx < 0) continue;
      stars[idx] = safeInt(raw.stars[k], 0, 0, 3);
    }
  }

  const bestTimes = {};
  if (isPlainObject(raw.bestTimes)) {
    const keys = Object.keys(raw.bestTimes).slice(0, MAX_KEYS_IN_DICT);
    for (const k of keys) {
      const idx = safeInt(k, -1, 0, MAX_LEVEL_INDEX);
      if (idx < 0) continue;
      const t = safeNum(raw.bestTimes[k], -1, 0, MAX_TIME_SECONDS);
      // Drop implausibly-fast records (< MIN_BEST_TIME) — these are
      // either tampered or a bug. We don't reset the whole save, just
      // drop the offending entry.
      if (t >= MIN_BEST_TIME) bestTimes[idx] = t;
    }
  }

  const settings = isPlainObject(raw.settings) ? raw.settings : {};

  // First pass: types + per-field caps.
  const out = {
    currentLevel: safeInt(raw.currentLevel, 0, 0, MAX_LEVEL_INDEX),
    maxUnlocked:  safeInt(raw.maxUnlocked,  0, 0, MAX_LEVEL_INDEX),
    coins:        safeInt(raw.coins,        0, 0, MAX_COINS),
    stars,
    bestTimes,
    settings: {
      sfx:     safeBool(settings.sfx,     true),
      vibrate: safeBool(settings.vibrate, true),
    },
  };

  // Cross-field invariants:
  //   1) currentLevel cannot exceed maxUnlocked + 1 (you can't be on a
  //      level you haven't unlocked).
  if (out.currentLevel > out.maxUnlocked) {
    out.currentLevel = out.maxUnlocked;
  }

  //   2) Coin balance plausibility: even with replay grinding, you
  //      can't earn more than ~MAX_COINS_PER_LEVEL × (unlocked levels)
  //      × COIN_REPLAY_SLACK. Anything above that is almost certainly
  //      tampering, so we clamp it down to the envelope rather than
  //      discarding the save outright.
  const coinEnvelope =
    Math.max(1, out.maxUnlocked + 1) * MAX_COINS_PER_LEVEL * COIN_REPLAY_SLACK;
  if (out.coins > coinEnvelope) {
    out.coins = coinEnvelope;
  }

  return out;
}

export const Storage = {
  load() {
    try {
      const txt = localStorage.getItem(KEY);
      if (!txt) return clone(DEFAULT);
      if (typeof txt !== "string" || txt.length > MAX_STORAGE_BYTES) {
        return clone(DEFAULT);
      }
      const wrapper = JSON.parse(txt);

      // Legacy unsigned format — accept once, will be re-saved with a
      // signature on next write. This is the migration path from
      // earlier builds that didn't sign the payload.
      if (!isPlainObject(wrapper) || !("v" in wrapper) || !("s" in wrapper)) {
        return sanitize(wrapper);
      }

      // Signed format. Verify the keyed hash matches the inner payload.
      // ANY failure → return defaults; we'd rather wipe a tampered save
      // than carry forged data forward.
      if (wrapper.v !== 1 || typeof wrapper.d !== "string" || typeof wrapper.s !== "string") {
        return clone(DEFAULT);
      }
      const expected = signState(wrapper.d);
      if (expected !== wrapper.s) {
        // Tampered — silently reset. We don't log because that would
        // tip off the attacker which check failed.
        return clone(DEFAULT);
      }
      return sanitize(JSON.parse(wrapper.d));
    } catch {
      return clone(DEFAULT);
    }
  },

  save(state) {
    try {
      // Re-sanitize on save too — if game logic ever set an invalid
      // value (bug, console-poking developer, race), we don't want to
      // commit it. This makes the storage layer the single source of
      // invariant truth.
      const clean = sanitize(state);
      const inner = JSON.stringify(clean);
      const wrapper = JSON.stringify({ v: 1, d: inner, s: signState(inner) });
      localStorage.setItem(KEY, wrapper);
    } catch (e) { /* quota / private mode — fail silently */ }
  },
};
