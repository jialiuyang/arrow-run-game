// =====================================================================
// LEVELS — difficulty isn't just "more arrows". The real difficulty knob
// is the AVERAGE NUMBER OF CLEARABLE ARROWS at each step of the solve.
// Few choices per step → harder (you must spot the only correct move).
// Many choices per step → easier (anything you click works).
// We always guarantee minChoices ≥ 1 so the puzzle never deadlocks.
//
// PERFORMANCE: the 12 curated levels are PRECOMPUTED into
// `levels-data.js` (run `node tools/generate-levels-data.mjs` to rebuild).
// At runtime we just decode them — page load goes from ~20s → ~50ms.
// The generator below is only used for ENDLESS MODE.
// =====================================================================
import { PRECOMPUTED_LEVELS } from "./levels-data.js";
import { LEVEL_CONFIG, BOSS_CONFIG } from "./config.js";

const PALETTES = {
  pastel:   ["#f59ec5", "#a48cef", "#7cd9d2", "#ffc97c", "#ff8c8c"],
  tropical: ["#ff5e7a", "#ffb84a", "#34c389", "#6c8cff", "#a26cff"],
  sunset:   ["#ff6b6b", "#ffa45c", "#ffd166", "#f78da7", "#c54b6c"],
  ocean:    ["#00b4d8", "#0077b6", "#48cae4", "#90e0ef", "#005f73"],
  neon:     ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff"],
  forest:   ["#2d6a4f", "#52b788", "#b7e4c7", "#74c69d", "#1b4332"],
};

// Time formula: Lv 1 = TIME_BASE_SEC, +TIME_STEP_SEC per level. The Boss
// level gets the natural time divided by BOSS_TIME_DIVISOR (a brutal speed
// run). Tunable via LEVEL_CONFIG in config.js.
export const TIME = (n) => {
  const base = LEVEL_CONFIG.TIME_BASE_SEC + (n - 1) * LEVEL_CONFIG.TIME_STEP_SEC;
  if (n === BOSS_CONFIG.LEVEL) {
    const naturalForLast = LEVEL_CONFIG.TIME_BASE_SEC + (BOSS_CONFIG.LEVEL - 2) * LEVEL_CONFIG.TIME_STEP_SEC;
    return Math.floor(naturalForLast / LEVEL_CONFIG.BOSS_TIME_DIVISOR);
  }
  return base;
};

// Total game length. After the Boss level the run is over.
export const MAX_LEVEL = LEVEL_CONFIG.MAX_LEVEL;

// Names + palettes are designer-picked per level. Everything else (grid,
// counts, difficulty knobs, minArrows floor) is DERIVED from the level
// number via `levelParams(N)` so curated and endless share identical
// scaling rules. Editing a row only changes its name/palette.
//
// Color policy: colored mazes are the default; monochrome (palette: null)
// is the rare exception reserved for "logic-puzzle" feeling levels. Lv 1
// is colored on purpose so new players see the game's full visual style
// from the very first move.
const CURATED_THEME = [
  { name: "纵横交织", palette: PALETTES.tropical },
  { name: "迷宫初探", palette: PALETTES.ocean    },
  { name: "粉彩绽放", palette: PALETTES.pastel   },
  { name: "层层包围", palette: PALETTES.forest   },
  { name: "热带风暴", palette: PALETTES.tropical },
  { name: "运用逻辑", palette: null              },
  { name: "晚霞迷宫", palette: PALETTES.sunset   },
  { name: "千头万绪", palette: PALETTES.neon     },
  { name: "深海迷踪", palette: PALETTES.ocean    },
  { name: "九曲迴肠", palette: null              },
  { name: "霓虹巨阵", palette: PALETTES.neon     },
  { name: "终极挑战", palette: PALETTES.sunset   },
];

/**
 * Unified per-level parameter generator. Used by BOTH curated (offline
 * build) and endless (in-browser) so the difficulty curve is one formula.
 *
 * Two regimes (both at +2 arrows/level — see `minArrows` below):
 *   • Lv 1–10  (gentle teach-in): modest grid + body length. Capped
 *     overshoot so the line-count progression is visible to the player.
 *   • Lv 11+   (sharp ramp): MUCH longer body cap, higher dependency
 *     density, and uncapped densify so the grid packs densely WITHOUT
 *     post-hoc filler stubs. The density comes from many long curving
 *     snakes interlocking, not from a sea of tiny 2-cell patches.
 */
export function levelParams(N) {
  const C = LEVEL_CONFIG;

  // ── BOSS Lv 51 "无限轮回" ── hellish difficulty. Maximum arrow count
  // packed tight, only 1 clickable at a time (forced sequence). The
  // post-hoc enforceInitialClickable pass keeps the count high while
  // reversing/blocking excess clickable arrows down to 1.
  if (N === BOSS_CONFIG.LEVEL) {
    return {
      minArrows: BOSS_CONFIG.MIN_ARROWS,
      capArrows: Infinity,
      cols: BOSS_CONFIG.COLS, rows: BOSS_CONFIG.ROWS,
      count: BOSS_CONFIG.COUNT,
      maxBody: BOSS_CONFIG.MAX_BODY,
      longBias: BOSS_CONFIG.LONG_BIAS,
      depBias: BOSS_CONFIG.DEP_BIAS,
      targetTight: BOSS_CONFIG.TARGET_TIGHT,
      coverage: BOSS_CONFIG.COVERAGE,
      targetMaxChoices: BOSS_CONFIG.TARGET_MAX_CHOICES,
      isBoss: true,
      coverageCap: null,
    };
  }

  const hard = N > C.HARD_THRESHOLD;
  const overHard = N - C.HARD_THRESHOLD;       // how far past the hard line

  // ── STEP 1 — Target line count: minArrows = BASE + N * STEP ──
  // Everything downstream (grid size, arrow lengths, pass shares) is
  // derived from this number so the generator naturally hits the target
  // without any post-hoc fill pass.
  const minArrows = C.MIN_ARROWS_BASE + N * C.MIN_ARROWS_STEP;

  // ── STEP 2 — Arrow-length distribution ──
  // Long arrows are prioritized (LENGTH_RATIO_LONG of total), then medium,
  // then a small share of short stubs. Short 2-cell arrows are also
  // HARD-CAPPED via SHORT_STUB_LIMIT in generateRaw.
  const avgLong   = hard
    ? Math.min(C.AVG_LONG_HARD_CAP, C.AVG_LONG_HARD_BASE + overHard * C.AVG_LONG_HARD_STEP)
    : Math.min(C.AVG_LONG_EASY_CAP, C.AVG_LONG_EASY_BASE + N * C.AVG_LONG_EASY_STEP);
  const avgMedium = C.AVG_MEDIUM_LEN;
  const avgShort  = C.AVG_SHORT_LEN;
  const expectedAvgLen = C.LENGTH_RATIO_LONG * avgLong
                       + C.LENGTH_RATIO_MEDIUM * avgMedium
                       + C.LENGTH_RATIO_SHORT * avgShort;

  // ── STEP 3 — Size the grid so coverage = arrows × avgLen / cells ──
  const coverage = hard
    ? Math.min(C.COVERAGE_HARD_CAP, C.COVERAGE_HARD_BASE + overHard * C.COVERAGE_HARD_STEP)
    : C.COVERAGE_EASY_BASE + (N - 1) * C.COVERAGE_EASY_STEP;

  const targetCells = minArrows * expectedAvgLen / coverage;
  const aspect = C.GRID_ASPECT;
  // Grid caps prevent pathological growth in extreme cases.
  const maxC = hard
    ? Math.min(C.HARD_MAX_COLS_CAP, C.HARD_MAX_COLS_BASE + Math.floor(overHard * C.HARD_MAX_COLS_GROWTH))
    : C.EASY_MAX_COLS;
  const maxR = hard
    ? Math.min(C.HARD_MAX_ROWS_CAP, C.HARD_MAX_ROWS_BASE + Math.floor(overHard * C.HARD_MAX_ROWS_GROWTH))
    : C.EASY_MAX_ROWS;
  const cols = Math.max(C.MIN_COLS, Math.min(maxC, Math.round(Math.sqrt(targetCells / aspect))));
  const rows = Math.max(C.MIN_ROWS, Math.min(maxR, Math.round(cols * aspect)));

  // Match minArrows exactly (no slack) so the generator stops as soon
  // as it hits the spec.
  const count = minArrows;

  // ── Clickable-count dimension ──
  // Ramp from CHOICES_AT_LV1 (Lv 1) → 1 (Lv ≥ FORCED_SEQ_LEVEL).
  // STRICTLY enforced by enforceInitialClickable.
  const targetMaxChoices_pre = N >= C.FORCED_SEQ_LEVEL
    ? 1
    : Math.max(1, Math.round(
        C.CHOICES_AT_LV1 - (N - 1) * (C.CHOICES_AT_LV1 - 1) / (C.FORCED_SEQ_LEVEL - 1)
      ));

  // Hard levels: uncap so densify packs the grid completely. The strict
  // "可点击线条" cap is enforced post-hoc by reversing arrow directions.
  const capArrows = hard ? Infinity : minArrows + C.CAP_ARROWS_SLACK;
  const colsT = cols, rowsT = rows;

  // Body length grows with level.
  const maxBody = hard
    ? Math.min(C.MAX_BODY_HARD_CAP, C.MAX_BODY_HARD_BASE + overHard * C.MAX_BODY_HARD_STEP)
    : Math.min(C.MAX_BODY_EASY_CAP, C.MAX_BODY_EASY_BASE + N * C.MAX_BODY_EASY_STEP);

  // longBias: how many of `count` arrows go into the LONG pass (0..1).
  const longBias = hard
    ? Math.min(C.LONG_BIAS_HARD_CAP, C.LONG_BIAS_HARD_BASE + overHard * C.LONG_BIAS_HARD_STEP)
    : Math.min(C.LONG_BIAS_EASY_CAP, C.LONG_BIAS_EASY_BASE + N * C.LONG_BIAS_EASY_STEP);

  // Dependency bias — higher = fewer initially-clickable arrows.
  // Critical for Lv ≥ FORCED_SEQ_LEVEL where the post-hoc enforce can
  // only do so much (every reversal risks introducing a topology cycle).
  const depBias = (hard && targetMaxChoices_pre === 1)
    ? C.DEP_BIAS_FORCED
    : (hard && targetMaxChoices_pre <= 5)
      ? Math.min(C.DEP_BIAS_TIGHT_CAP, C.DEP_BIAS_TIGHT_BASE + (5 - targetMaxChoices_pre) * C.DEP_BIAS_TIGHT_STEP)
      : hard
        ? Math.min(C.DEP_BIAS_HARD_CAP, C.DEP_BIAS_HARD_BASE + overHard * C.DEP_BIAS_HARD_STEP)
        : C.DEP_BIAS_EASY_BASE + N * C.DEP_BIAS_EASY_STEP;

  const targetMaxChoices = targetMaxChoices_pre;
  // Convert to tightFrac target (existing knob). Lower target choices ⇒
  // higher fraction of "tight" steps (≤3 clearable).
  const targetTight = Math.min(0.95, Math.max(0.10, 1 - targetMaxChoices / C.TIGHT_DENOM));

  // Visual coverage cap is no longer needed — generation is now COUNT-
  // driven (see STEP 1-3 above). Densify stops at `minArrows`, not at a
  // % of grid coverage, so coverage emerges naturally from `minArrows ×
  // expectedAvgLen / cells` ≈ 80–85%. Setting null disables the
  // coverage-based early stop in densifyPass.
  const coverageCap = null;

  return { minArrows, capArrows, cols: colsT, rows: rowsT, count, maxBody, longBias, depBias, targetTight, coverage, targetMaxChoices, coverageCap };
}

// LEVEL_CONFIGS — derived per-level from levelParams(N). Consumed only
// by the offline build script `tools/generate-levels-data.mjs`.
export const LEVEL_CONFIGS = CURATED_THEME.map((theme, i) => ({
  ...theme,
  ...levelParams(i + 1),
}));

/**
 * Decode the compact arrow form `{c:"x,y|x,y|...", k:"#color"}` back to
 * the runtime form `{cells:[{x,y},...], color:"#..."}`. ~50µs total for
 * all 12 levels combined — effectively instant.
 */
function decodeArrow(a) {
  const cells = a.c.split("|").map(s => {
    const [x, y] = s.split(",");
    return { x: +x, y: +y };
  });
  return a.k ? { cells, color: a.k } : { cells };
}

// LAZY-DECODE: at module load we only build the lightweight metadata
// (name/cols/rows/timeLimit/lives) for each curated level. The heavyweight
// `arrows` field is decoded on first access via the getter below. First
// paint only pays for level 0; the other 11 levels are free until visited.
export const LEVELS = PRECOMPUTED_LEVELS.map((lv) => {
  let _decoded = null;
  return {
    name: lv.name,
    cols: lv.cols,
    rows: lv.rows,
    timeLimit: lv.timeLimit,
    lives: lv.lives,
    get arrows() {
      if (_decoded == null) _decoded = lv.arrows.map(decodeArrow);
      return _decoded;
    },
  };
});

// =====================================================================
// MAZE GENERATOR — multi-trial candidate selection by difficulty fit.
// Used by the build script + endless mode (no curated-level cost).
// =====================================================================
//
// SOLVABILITY PROOF (per single candidate, before selection):
//   For each new arrow N, we verify that its head's path-to-edge does
//   not cross any cells of arrows 1..N-1. N's body cells MAY freely
//   cross earlier arrows' head paths, creating dependencies. Removal in
//   REVERSE insertion order is always valid.
//
// Picks the candidate whose tight-fraction (% of solve steps with ≤ 3
// clearable arrows) is closest to `targetTight`.
export function makeMazeLevel(cols, rows, targetArrows, maxBodyLen, seed, palette = null, longBias = 0.5, targetTight = 0.20, dependencyBias = 0, fast = false, minArrows = 0, capArrows = Infinity, targetMaxChoices = null, coverageCap = null) {
  // Curated builds (offline) get many trials for best quality. Endless
  // (in-browser) gets a tiny budget to stay under ~500ms per level.
  // The strict "可点击线条" cap is enforced AFTER generation by the
  // reversal/add-blocker pass, so trials measure the raw backbone for
  // a fast difficulty signal — densify+enforce happens only on the
  // winning seed.
  const wantTightChoices = false;     // post-hoc enforce handles it
  const TRIALS = fast ? 2 : (targetTight > 0.30 ? 40 : 28);
  let best = null;
  let bestScore = Infinity;

  let bestSeed = seed;
  const totalCells = cols * rows;
  const trialAttemptScale = fast ? 0.5 : 1.0;
  for (let t = 0; t < TRIALS; t++) {
    const trialSeed = seed * 31 + t * 9133;
    // Trials measure the raw backbone (no densify) — cheap, accurate
    // enough for difficulty selection. Densify + enforce runs on the
    // winning seed below.
    const candidate = generateRaw(cols, rows, targetArrows, maxBodyLen, trialSeed, longBias, dependencyBias, /* densify= */ false, trialAttemptScale, capArrows, /* tightChoiceMode= */ false);
    if (!candidate.length) continue;
    const stats = analyzeDifficulty(candidate, cols, rows);
    if (!stats.solved || stats.minChoices < 1) continue;

    // PRIMARY: distance from target tight-fraction. Asymmetric — for hard
    // levels, being TOO EASY (low tightFrac) is heavily penalized. For
    // easy levels, being TOO HARD is the bigger sin.
    const tGap = stats.tightFrac - targetTight;
    const wantHard = targetTight > 0.30;
    const easyPenalty = tGap < 0 ? -tGap * (wantHard ? 5.0 : 1.5) : 0;
    const hardPenalty = tGap > 0 ? tGap  * (wantHard ? 0.5 : 3.0) : 0;

    // SECONDARY: VISUAL DENSITY — count occupied cells, not arrows.
    // Big arrows fill more cells per arrow, so cell-count is the real
    // proxy for "looks tightly packed". Quadratic penalty hits sparse
    // candidates hard so the selector prefers densable layouts.
    let occCells = 0;
    for (const a of candidate) occCells += a.cells.length;
    const densityGap = Math.max(0, 0.75 - occCells / totalCells);  // want ≥ 75% pre-densify
    const densityPenalty = densityGap * densityGap * 8;            // quadratic

    // TERTIARY: forced moments are extra spice on hard levels
    const forcedBonus = wantHard ? Math.min(0.3, stats.forcedFrac) * -1.0 : 0;

    // QUATERNARY: target average clickable count (NEW dimension).
    // The user's spec says Lv 1 keeps current ~10 clickable; every 5
    // levels drops by 1 down to 1 minimum. We score by squared distance
    // so candidates with the right "feel" win. Heavily weighted on later
    // levels (small target ⇒ tight forced sequences are required).
    let choicesPenalty = 0;
    if (targetMaxChoices != null) {
      const gap = stats.avgChoices - targetMaxChoices;
      // Asymmetric: too many choices on a "should-be-tight" level is
      // much worse than too few choices on an "open" level. The weight
      // grows as the target shrinks (1 = punish ANY excess hard).
      const w = 0.6 + (10 - targetMaxChoices) * 0.30;
      choicesPenalty = gap > 0 ? gap * gap * w : Math.abs(gap) * 0.4;
    }

    const score = easyPenalty + hardPenalty + densityPenalty + forcedBonus + choicesPenalty;

    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      bestSeed = trialSeed;
    }
  }

  if (!best) {
    bestSeed = seed;
    best = generateRaw(cols, rows, targetArrows, maxBodyLen, seed, longBias, dependencyBias, /* densify= */ false, 1.0, capArrows);
  }

  // Re-run the winning seed with full densify so we get the maximum
  // arrow count for the level (matches "+4/level" target). The post-hoc
  // enforceInitialClickable pass handles the clickable cap by reversing
  // arrow directions — total arrow count stays high.
  best = generateRaw(cols, rows, targetArrows, maxBodyLen, bestSeed, longBias, dependencyBias, /* densify= */ true, 1.0, capArrows, /* tightChoiceMode= */ false, coverageCap);

  // Hard floor: if the final densified arrow count is below the design
  // minimum, retry with a slightly larger grid. Capped at +6 in each
  // dimension so we don't loop forever.
  // Auto-grow retry only when capArrows < Infinity (early levels with a
  // strict +1/level rule). For hard levels (capArrows = Infinity) the
  // grid is intentionally fixed at the levelParams-chosen size so
  // densify can saturate a SMALL grid → visually dense, no whitespace.
  // Growing the grid would reduce coverage and bring back the patches.
  // Auto-grow retry: only fires if generation falls below `minArrows`,
  // which should now be RARE — the level params are sized so densify
  // hits the target naturally. When it does fire (some unlucky seeds),
  // we grow the grid +2/+2 and try again, capped to prevent runaway.
  if (minArrows > 0 && best.length < minArrows && cols < 46 && rows < 56) {
    return makeMazeLevel(
      cols + 2, rows + 2, targetArrows, maxBodyLen,
      seed + 9999, palette, longBias, targetTight, dependencyBias, fast, minArrows, capArrows, targetMaxChoices, coverageCap
    );
  }

  // ── Strict initial-clickable enforcement ──
  // The "可点击的线条" dimension: count how many arrows are clickable
  // RIGHT AT THE START (head's path-to-edge clear). If we exceed
  // targetMaxChoices, iteratively prune the safest excess arrow
  // (preferring short arrows that don't block other clickable ones)
  // until we hit the target. Always preserves at least 1 clickable so
  // the puzzle stays solvable.
  if (targetMaxChoices != null && targetMaxChoices >= 1) {
    best = enforceInitialClickable(best, cols, rows, targetMaxChoices, mulberry32(seed * 13 + 17), fast, coverageCap);
  }

  // Apply palette colors AFTER difficulty selection (color doesn't affect logic)
  const colorRng = mulberry32(seed * 7919 + 1);
  const pickColor = () => {
    if (!palette || palette.length === 0) return undefined;
    return palette[Math.floor(colorRng() * palette.length)];
  };
  return best.map(a => ({ cells: a.cells, color: pickColor() }));
}

// =====================================================================
// DIFFICULTY ANALYZER — measures how "constrained" play feels.
// =====================================================================
//
// Returns:
//   avgChoices    — mean # clearable arrows per step (lower = harder)
//   minChoices    — minimum across all steps (must be ≥ 1 to be solvable)
//   maxChoices    — max # clearable in any single step
//   tightFrac     — fraction of steps with ≤ 3 clearable arrows
//                   (this is the BEST proxy for "feels hard": forces the
//                    player to scan and find the unique correct move)
//   forcedFrac    — fraction of steps with exactly 1 clearable arrow
//                   (the most extreme "needle in haystack" moments)
//   depth, solved
//
/**
 * Strictly enforce a cap on "initially clickable" arrows.
 *
 * Strategy (in order of preference — non-destructive transforms first;
 * removal is the absolute LAST resort):
 *   1. REVERSE the arrow's direction (head moves to opposite end).
 *   2. ROTATE the head segment to one of the OTHER 3 perpendicular
 *      directions (replace just the head cell with an adjacent one).
 *   3. EXTEND the arrow head forward 1 cell (changes blocking).
 *   4. SHORTEN by removing the head (new head at previous segment).
 *   5. ADD a blocker arrow elsewhere in the maze.
 *   6. REMOVE — only as absolute last resort if NOTHING else worked.
 *
 * All transforms verify the puzzle stays a DAG (topo sort) and that
 * the operation actually REDUCED clickable count.
 */
export function enforceInitialClickable(arrowsIn, cols, rows, target, rng = Math.random, fast = false, coverageCap = null) {
  // Pre-flight: if the INPUT already contains a dependency cycle (the
  // densify acceptBlocked=true passes can create these — they place
  // arrows whose body cells block each other transitively), enforce
  // can't safely transform it: any change risks worsening the cycle,
  // and we'd still hand back an unsolvable puzzle. Return it unchanged
  // so the caller can detect the failure and try a different seed.
  if (!isSolvableTopo(arrowsIn, cols, rows)) {
    return arrowsIn.map(a => ({ ...a, cells: a.cells.slice() }));
  }
  let arrows = arrowsIn.map(a => ({ ...a, cells: a.cells.slice() }));
  let guard = 0;
  let prevCount = Infinity;
  let noProgressCount = 0;        // # consecutive iterations w/o reducing click count
  // Cap iterations differently for runtime vs build (tunable in config.js):
  //  fast (runtime endless): tight cap to keep level switches snappy.
  //  full (build precompute): higher cap for better convergence.
  const MAX_ITERS = fast ? LEVEL_CONFIG.ENFORCE_MAX_ITERS_FAST : LEVEL_CONFIG.ENFORCE_MAX_ITERS_FULL;
  // Bail after this many consecutive iters of no progress. The dynamic
  // `transformCandidateCap` ensures each iter scans enough candidates,
  // so true "stuck" is real stuck — no reason to wait long.
  const NO_PROGRESS_LIMIT = fast ? LEVEL_CONFIG.ENFORCE_NO_PROGRESS_FAST : LEVEL_CONFIG.ENFORCE_NO_PROGRESS_FULL;
  // ── PER-OP TOPO CHECK ──
  // We MUST check topology after every successful transform. Skipping
  // it (the old "fast mode") saved time but produced unsolvable puzzles
  // (every reversal in a dense maze can create dependency cycles). The
  // helpers below are responsible for undoing the change if the topo
  // check fails — see tryReverse / tryRotateHead / etc.
  const skipTopoPerOp = false;
  // Snapshot for absolute safety: if we end up with a cycle for any
  // reason, return this guaranteed-solvable starting state.
  const initialSnapshot = arrows.map(a => ({ ...a, cells: a.cells.slice() }));
  // Track the best snapshot we've seen so far (lowest clickable count
  // that's still >= 1). If the final state ends up unplayable (zero
  // clickable arrows = no way to start the puzzle), we restore this.
  let bestSnapshot = initialSnapshot;
  let bestClickable = Infinity;
  while (guard++ < MAX_ITERS) {
    const { clickable, occupied, dirs } = analyzeStartState(arrows, cols, rows);
    // Snapshot any state that's playable (≥ 1 clickable) and better
    // than what we have so far. Cheap because we already paid for
    // analyzeStartState.
    if (clickable.length >= 1 && clickable.length < bestClickable) {
      bestSnapshot = arrows.map(a => ({ ...a, cells: a.cells.slice() }));
      bestClickable = clickable.length;
    }
    if (clickable.length <= target && clickable.length >= 1) break;
    // If a transform overshot us to 0 clickable (unplayable), restore
    // the last known good snapshot and STOP — further transforms would
    // just thrash back to 0.
    if (clickable.length === 0) {
      arrows = bestSnapshot.map(a => ({ ...a, cells: a.cells.slice() }));
      break;
    }

    // Track no-progress streaks so we eventually bail (no infinite loop).
    // Per user spec: "不要要移除，而是要改变其中几个线条箭头的方向" —
    // we never delete arrows, even when the clickable cap can't be hit.
    if (clickable.length >= prevCount) {
      noProgressCount++;
    } else {
      noProgressCount = 0;
    }
    prevCount = clickable.length;

    const shuffled = clickable.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Dynamic candidate cap: when the gap to target is large (e.g. Lv 30
    // going from 30 clickable down to 1), we MUST consider many arrows
    // per pass or the helpers all fail on the first 8 and the loop
    // bails without progress.
    const cap = transformCandidateCap(clickable.length, target, fast);

    // ── Non-destructive transforms (the only allowed strategy) ──
    // Each helper mutates arrows[+occupied] on success and returns true.
    // Each helper also runs an O(N) topo check after applying its change;
    // if a cycle would be created, the change is rolled back and the next
    // candidate is tried. This guarantees the puzzle remains solvable.
    if (tryReverse(arrows, shuffled, cols, rows, occupied, skipTopoPerOp, cap))     continue;
    if (tryRotateHead(arrows, shuffled, cols, rows, occupied, skipTopoPerOp, cap))  continue;
    if (tryShortenHead(arrows, shuffled, cols, rows, occupied, skipTopoPerOp, cap)) continue;
    if (tryExtendHead(arrows, shuffled, cols, rows, occupied, skipTopoPerOp, cap))  continue;
    // Add-blocker — places a new BLOCKER arrow whose body crosses one of
    // the clickable's head paths. This is the most powerful transform
    // because it works even when geometry rules out the direction-only
    // strategies above. User spec: "改变线条方向或延长旁边的线条堵住路线".
    if (tryAddBlocker(arrows, cols, rows, clickable, occupied, dirs, rng, skipTopoPerOp)) continue;

    // No transform made progress. If stuck for NO_PROGRESS_LIMIT
    // consecutive iters, accept the current count and BAIL (line count
    // is preserved; clickable count is best-effort).
    if (noProgressCount >= NO_PROGRESS_LIMIT) break;
  }

  // Per-op topo checks above guarantee no cycle was introduced, but
  // assert it as a safety net. If somehow violated, return the original
  // (guaranteed solvable) input.
  if (!isSolvableTopo(arrows, cols, rows)) {
    return initialSnapshot;
  }
  // Final playability check — no clickable arrows means the puzzle
  // can't be started. Fall back to the best playable snapshot.
  const finalState = analyzeStartState(arrows, cols, rows);
  if (finalState.clickable.length === 0) {
    return bestClickable < Infinity ? bestSnapshot : initialSnapshot;
  }

  // (Post-enforce fill / parallel-rotation passes intentionally REMOVED.
  // Per user request: "把填充的代码逻辑删掉，不要填充了！太卡了" —
  // the fill + polish passes were the dominant runtime cost on dense
  // maps (Lv 30+) because each placement triggered an O(N) topo check.
  // Removing them brings level switches back to sub-second territory at
  // the cost of a little visible whitespace, which is acceptable.)

  return arrows;
}

// Cap on # candidates considered per helper call. Each candidate that
// passes the cheap geometric check triggers an O(N²) topo verification,
// so we limit it to keep dense maps tractable. Auto-scales with the
// gap to target — when many clickable need converting (e.g. Lv 30+
// going from 30 to 1), we MUST try most of them per pass or we bail
// without making progress.
function transformCandidateCap(clickableCount, target, fast) {
  // Always try at least 30 candidates. When the gap is large we try
  // all of them so no clickable goes un-attempted in a single pass.
  const gap = Math.max(0, clickableCount - target);
  if (fast) return Math.max(30, Math.min(clickableCount, gap * 2 + 20));
  return clickableCount;          // full mode: try every candidate
}

/** Reverse one clickable arrow: head moves to the opposite end. */
function tryReverse(arrows, candidates, cols, rows, occupied, skipTopo = false, maxCandidates = 8) {
  let tried = 0;
  for (const aId of candidates) {
    if (tried >= maxCandidates) break;
    const a = arrows[aId];
    if (a.cells.length < 2) continue;
    const newCells = a.cells.slice().reverse();
    const newHead = newCells[newCells.length - 1];
    const newPrev = newCells[newCells.length - 2];
    const newDir = { dx: newHead.x - newPrev.x, dy: newHead.y - newPrev.y };
    let cx = newHead.x + newDir.dx, cy = newHead.y + newDir.dy;
    let blockedByOther = false;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const owner = occupied.get(`${cx},${cy}`);
      if (owner != null && owner !== aId) { blockedByOther = true; break; }
      cx += newDir.dx; cy += newDir.dy;
    }
    if (!blockedByOther) continue;
    tried++;
    const oldCells = a.cells;
    a.cells = newCells;
    if (skipTopo || isSolvableTopo(arrows, cols, rows)) return true;
    a.cells = oldCells;
  }
  return false;
}

/** Rotate the head cell to a perpendicular direction. The arrow keeps
 *  most of its body but the head segment swings 90° to a different
 *  empty cell adjacent to the previous body cell. This gives 3 alt
 *  directions on top of REVERSE's 1, covering all 4 directions. */
function tryRotateHead(arrows, candidates, cols, rows, occupied, skipTopo = false, maxCandidates = 8) {
  const dirsAll = [
    { dx:  0, dy: -1 }, { dx:  0, dy: 1 },
    { dx: -1, dy:  0 }, { dx:  1, dy: 0 },
  ];
  let tried = 0;
  for (const aId of candidates) {
    if (tried >= maxCandidates) break;
    const a = arrows[aId];
    if (a.cells.length < 2) continue;
    const head = a.cells[a.cells.length - 1];
    const prev = a.cells[a.cells.length - 2];
    const oldDir = { dx: head.x - prev.x, dy: head.y - prev.y };
    for (const d of dirsAll) {
      if (d.dx === oldDir.dx && d.dy === oldDir.dy) continue;             // same dir
      if (d.dx === -oldDir.dx && d.dy === -oldDir.dy) continue;           // would point back into body
      const nh = { x: prev.x + d.dx, y: prev.y + d.dy };
      if (nh.x < 0 || nh.x >= cols || nh.y < 0 || nh.y >= rows) continue;
      // New head cell must be empty (or the OLD head cell, which we'll free).
      const k = `${nh.x},${nh.y}`;
      const owner = occupied.get(k);
      if (owner != null && !(owner === aId && nh.x === head.x && nh.y === head.y)) continue;
      // Check new head's path is blocked by some other arrow.
      // Note: the OLD head cell (head.x, head.y) is about to be freed
      // when we apply the rotation, so don't count it as a blocker.
      let blocked = false;
      let cx = nh.x + d.dx, cy = nh.y + d.dy;
      while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
        if (cx === head.x && cy === head.y) { cx += d.dx; cy += d.dy; continue; }
        const o = occupied.get(`${cx},${cy}`);
        if (o != null && o !== aId) { blocked = true; break; }
        cx += d.dx; cy += d.dy;
      }
      if (!blocked) continue;
      tried++;
      // Apply: replace head cell. Update occupied map BEFORE topo check.
      const oldCells = a.cells;
      const oldHeadKey = `${head.x},${head.y}`;
      a.cells = a.cells.slice(0, -1).concat([nh]);
      occupied.delete(oldHeadKey);
      occupied.set(k, aId);
      if (skipTopo || isSolvableTopo(arrows, cols, rows)) return true;
      // Undo
      a.cells = oldCells;
      occupied.set(oldHeadKey, aId);
      if (k !== oldHeadKey) occupied.delete(k);
    }
  }
  return false;
}

/** Extend the arrow head 1 cell forward (same direction). The longer
 *  head may now reach into another arrow's cells, becoming blocked. */
function tryExtendHead(arrows, candidates, cols, rows, occupied, skipTopo = false, maxCandidates = 8) {
  let tried = 0;
  for (const aId of candidates) {
    if (tried >= maxCandidates) break;
    const a = arrows[aId];
    if (a.cells.length < 2) continue;
    const head = a.cells[a.cells.length - 1];
    const prev = a.cells[a.cells.length - 2];
    const d = { dx: head.x - prev.x, dy: head.y - prev.y };
    const nh = { x: head.x + d.dx, y: head.y + d.dy };
    if (nh.x < 0 || nh.x >= cols || nh.y < 0 || nh.y >= rows) continue;
    const k = `${nh.x},${nh.y}`;
    if (occupied.has(k)) continue;
    // After extension, new head path starts at nh+d. Must be blocked.
    let blocked = false;
    let cx = nh.x + d.dx, cy = nh.y + d.dy;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const o = occupied.get(`${cx},${cy}`);
      if (o != null && o !== aId) { blocked = true; break; }
      cx += d.dx; cy += d.dy;
    }
    if (!blocked) continue;
    tried++;
    const oldCells = a.cells;
    a.cells = a.cells.concat([nh]);
    occupied.set(k, aId);
    if (skipTopo || isSolvableTopo(arrows, cols, rows)) return true;
    a.cells = oldCells;
    occupied.delete(k);
  }
  return false;
}

/** Shorten the arrow by dropping the head cell. The new head sits one
 *  cell back. If the body had a corner there, the inferred direction
 *  changes and the new head path may now be blocked. */
function tryShortenHead(arrows, candidates, cols, rows, occupied, skipTopo = false, maxCandidates = 8) {
  let tried = 0;
  for (const aId of candidates) {
    if (tried >= maxCandidates) break;
    const a = arrows[aId];
    if (a.cells.length < 3) continue;        // need at least head + 2 body cells
    const head = a.cells[a.cells.length - 1];
    const prev = a.cells[a.cells.length - 2];
    const prev2 = a.cells[a.cells.length - 3];
    const newHead = prev;
    const newDir = { dx: prev.x - prev2.x, dy: prev.y - prev2.y };
    // New head path
    let blocked = false;
    let cx = newHead.x + newDir.dx, cy = newHead.y + newDir.dy;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      if (cx === head.x && cy === head.y) { cx += newDir.dx; cy += newDir.dy; continue; }
      const o = occupied.get(`${cx},${cy}`);
      if (o != null && o !== aId) { blocked = true; break; }
      cx += newDir.dx; cy += newDir.dy;
    }
    if (!blocked) continue;
    tried++;
    const oldCells = a.cells;
    const oldHeadKey = `${head.x},${head.y}`;
    a.cells = a.cells.slice(0, -1);
    occupied.delete(oldHeadKey);
    if (skipTopo || isSolvableTopo(arrows, cols, rows)) return true;
    a.cells = oldCells;
    occupied.set(oldHeadKey, aId);
  }
  return false;
}

/** Try to add ONE blocker arrow that reduces clickable by 1 and is
 *  itself blocked by some existing arrow. Returns true on success. */
function tryAddBlocker(arrows, cols, rows, clickable, occupied, dirs, rng, skipTopo = false) {
  const dirsAll = [
    { dx:  0, dy: -1 }, { dx:  0, dy: 1 },
    { dx: -1, dy:  0 }, { dx:  1, dy: 0 },
  ];
  // Build set of cells that lie on SOME clickable arrow's head path.
  // Placing a body cell here = blocking a clickable.
  const clickablePathCells = new Set();
  for (const aId of clickable) {
    const head = arrows[aId].cells[arrows[aId].cells.length - 1];
    const ad = dirs[aId];
    let cx = head.x + ad.dx, cy = head.y + ad.dy;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const k = `${cx},${cy}`;
      if (!occupied.has(k)) clickablePathCells.add(k);
      cx += ad.dx; cy += ad.dy;
    }
  }
  if (clickablePathCells.size === 0) return false;

  // Collect all empty cells (potential head positions); shuffle.
  const empties = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!occupied.has(`${x},${y}`)) empties.push({ x, y });
    }
  }
  for (let i = empties.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [empties[i], empties[j]] = [empties[j], empties[i]];
  }

  for (const ph of empties) {
    for (const d of dirsAll) {
      // Walk head path forward; new arrow must be BLOCKED.
      let blockedByExisting = false;
      let nx = ph.x + d.dx, ny = ph.y + d.dy;
      while (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
        if (occupied.has(`${nx},${ny}`)) { blockedByExisting = true; break; }
        nx += d.dx; ny += d.dy;
      }
      if (!blockedByExisting) continue;

      // Walk body backward; collect up to 6 empty cells. Body MUST
      // include at least one cell from clickablePathCells (so the new
      // arrow blocks at least one clickable).
      const body = [];
      let blocksClickable = false;
      let bx = ph.x - d.dx, by = ph.y - d.dy;
      while (bx >= 0 && bx < cols && by >= 0 && by >= 0 && by < rows && body.length < 6) {
        const bk = `${bx},${by}`;
        if (occupied.has(bk)) break;
        body.push({ x: bx, y: by });
        if (clickablePathCells.has(bk)) blocksClickable = true;
        bx -= d.dx; by -= d.dy;
      }
      if (body.length === 0) continue;

      // Head itself counts toward "blocks a clickable" too.
      if (clickablePathCells.has(`${ph.x},${ph.y}`)) blocksClickable = true;
      if (!blocksClickable) continue;

      // Build cells in order: deepest body first → ... → head last.
      const cells = body.slice().reverse();
      cells.push({ x: ph.x, y: ph.y });
      arrows.push({ cells });
      if (skipTopo || isSolvableTopo(arrows, cols, rows)) return true;
      arrows.pop();
    }
  }
  return false;
}

/** Fast topological-sort solvability check.
 *  Build the "X blocks Y" dependency graph (X's cells lie on Y's head
 *  path). The puzzle is solvable iff this graph is a DAG. Linear time. */
export function isSolvableTopo(arrows, cols, rows) {
  const N = arrows.length;
  if (N === 0) return true;
  const occupied = new Map();
  const dirs = new Array(N);
  for (let i = 0; i < N; i++) {
    for (const c of arrows[i].cells) occupied.set(`${c.x},${c.y}`, i);
    const head = arrows[i].cells[arrows[i].cells.length - 1];
    let dir = { dx: 0, dy: -1 };
    if (arrows[i].cells.length >= 2) {
      const p = arrows[i].cells[arrows[i].cells.length - 2];
      dir = { dx: head.x - p.x, dy: head.y - p.y };
    }
    dirs[i] = dir;
  }
  const inDeg = new Array(N).fill(0);
  const out = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const head = arrows[i].cells[arrows[i].cells.length - 1];
    const d = dirs[i];
    let cx = head.x + d.dx, cy = head.y + d.dy;
    const seen = new Set();
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const o = occupied.get(`${cx},${cy}`);
      if (o != null && o !== i && !seen.has(o)) {
        seen.add(o);
        out[o].push(i);
        inDeg[i]++;
      }
      cx += d.dx; cy += d.dy;
    }
  }
  // Kahn's algorithm: pop zero in-degree, remove edges, count visited.
  const queue = [];
  for (let i = 0; i < N; i++) if (inDeg[i] === 0) queue.push(i);
  let visited = 0;
  while (queue.length) {
    const u = queue.pop();
    visited++;
    for (const v of out[u]) {
      if (--inDeg[v] === 0) queue.push(v);
    }
  }
  return visited === N;
}

/** Internal helper: compute initially-clickable arrow IDs and how many
 *  arrows each one blocks. Also returns the occupancy map + per-arrow
 *  direction so callers don't recompute. */
function analyzeStartState(arrows, cols, rows) {
  const occupied = new Map();           // cellKey -> arrowId
  const dirs = new Array(arrows.length);
  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];
    for (const c of a.cells) occupied.set(`${c.x},${c.y}`, i);
    const head = a.cells[a.cells.length - 1];
    let dir = { dx: 0, dy: -1 };
    if (a.cells.length >= 2) {
      const p = a.cells[a.cells.length - 2];
      dir = { dx: head.x - p.x, dy: head.y - p.y };
    }
    dirs[i] = dir;
  }
  const blocksCount = new Array(arrows.length).fill(0);
  const clickable = [];
  for (let i = 0; i < arrows.length; i++) {
    const head = arrows[i].cells[arrows[i].cells.length - 1];
    const d = dirs[i];
    let cx = head.x + d.dx, cy = head.y + d.dy;
    let blocked = false;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const o = occupied.get(`${cx},${cy}`);
      if (o != null && o !== i) {
        blocked = true;
        blocksCount[o]++;
      }
      cx += d.dx; cy += d.dy;
    }
    if (!blocked) clickable.push(i);
  }
  return { clickable, blocksCount, occupied, dirs };
}

// We average over K random plays for stable measurement.
export function analyzeDifficulty(arrowsData, cols, rows) {
  const N = arrowsData.length;
  if (N === 0) return { avgChoices: 0, minChoices: 0, maxChoices: 0, tightFrac: 0, forcedFrac: 0, depth: 0, solved: true };

  // Precompute head + direction + cells per arrow
  const arrows = arrowsData.map((a, i) => {
    const cells = a.cells;
    const head = cells[cells.length - 1];
    let dir;
    if (cells.length >= 2) {
      const prev = cells[cells.length - 2];
      dir = { dx: head.x - prev.x, dy: head.y - prev.y };
    } else {
      dir = { dx: 0, dy: -1 };
    }
    return { id: i, cells, head, dir };
  });

  // Build dependency graph: for each arrow A, which arrows are CURRENTLY
  // blocking A's head path? (i.e. those arrows must be removed before A.)
  const cellOwner = new Map();
  for (const a of arrows) {
    for (const c of a.cells) cellOwner.set(`${c.x},${c.y}`, a.id);
  }
  const blockedBy = arrows.map(() => new Set());          // arrowId → Set of blocker ids
  const unblocks  = arrows.map(() => []);                  // arrowId → arrows it unblocks when removed
  for (const a of arrows) {
    let cx = a.head.x + a.dir.dx, cy = a.head.y + a.dir.dy;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const owner = cellOwner.get(`${cx},${cy}`);
      if (owner != null && owner !== a.id) blockedBy[a.id].add(owner);
      cx += a.dir.dx; cy += a.dir.dy;
    }
  }
  for (let i = 0; i < N; i++) {
    for (const b of blockedBy[i]) unblocks[b].push(i);
  }

  // Run K random-play simulations to get a stable estimate of choice profile
  const K = 4;
  let totalChoices = 0;
  let totalSteps = 0;
  let tightSteps = 0;     // steps with ≤ 3 clearable
  let forcedSteps = 0;    // steps with exactly 1 clearable
  let minChoices = Infinity;
  let maxChoices = 0;
  let allSolved = true;

  const rng = mulberry32(0xC0FFEE);

  for (let trial = 0; trial < K; trial++) {
    const pending = blockedBy.map(s => s.size);
    const onBoard = new Uint8Array(N).fill(1);
    let live = N;
    let solved = true;

    while (live > 0) {
      const clearable = [];
      for (let i = 0; i < N; i++) {
        if (onBoard[i] && pending[i] === 0) clearable.push(i);
      }
      if (clearable.length === 0) { solved = false; break; }

      const c = clearable.length;
      totalChoices += c;
      totalSteps++;
      if (c <= 3) tightSteps++;
      if (c === 1) forcedSteps++;
      if (c < minChoices) minChoices = c;
      if (c > maxChoices) maxChoices = c;

      const pickId = clearable[Math.floor(rng() * clearable.length)];
      onBoard[pickId] = 0;
      live--;
      for (const next of unblocks[pickId]) pending[next]--;
    }
    if (!solved) allSolved = false;
  }

  return {
    avgChoices: totalSteps > 0 ? totalChoices / totalSteps : 0,
    minChoices: minChoices === Infinity ? 0 : minChoices,
    maxChoices,
    tightFrac:  totalSteps > 0 ? tightSteps  / totalSteps : 0,
    forcedFrac: totalSteps > 0 ? forcedSteps / totalSteps : 0,
    depth: N,
    solved: allSolved,
  };
}

// =====================================================================
// RAW GENERATOR (one candidate). Returns [{cells:[...]}], no colors.
//
// `dependencyBias` (0..1) makes the placer prefer LONG head paths toward
// the FAR edge of the board (instead of the nearest edge). Long head
// paths cross more other-arrow body cells, which means those arrows can
// be blocked by many others → fewer simultaneously-clearable arrows
// during play → harder, more order-dependent puzzles.
// =====================================================================
function generateRaw(cols, rows, targetArrows, maxBodyLen, seed, longBias = 0.5, dependencyBias = 0.0, runDensify = true, attemptScale = 1.0, capArrows = Infinity, tightChoiceMode = false, coverageCap = null) {
  const rng = mulberry32(seed * 9301 + 49297);
  const occupied = new Set();
  const headPathCells = new Set();
  const arrows = [];

  // Track committed head positions per direction so we can enforce:
  //   "no two same-direction heads in adjacent perpendicular cells"
  // i.e. no ↑↑ side-by-side at all. Stricter than the old "max 2 in a row"
  // — visually you never see two same-direction arrow lines next to each
  // other, which the user wanted.
  const headByPosDir = new Set();
  function _dirKey(d) {
    if (d.dy === -1) return "U";
    if (d.dy ===  1) return "D";
    if (d.dx === -1) return "L";
    return "R";
  }
  function hasAdjacentSameDir(hx, hy, d) {
    // Perp axis: vertical arrows look left/right, horizontal look up/down.
    const px = d.dx !== 0 ? 0 : 1;
    const py = d.dx !== 0 ? 1 : 0;
    const dk = _dirKey(d);
    return headByPosDir.has(`${hx + px},${hy + py}|${dk}`)
        || headByPosDir.has(`${hx - px},${hy - py}|${dk}`);
  }
  function isOnPerimeter(x, y) {
    return x === 0 || x === cols - 1 || y === 0 || y === rows - 1;
  }
  /**
   * Combined adjacency rule. Always rejects same-direction heads
   * perpendicular to the head direction (existing rule). When the head
   * sits on the outer perimeter, ADDITIONALLY rejects same-direction
   * heads at the parallel-axis perimeter neighbors — i.e. no two
   * adjacent perimeter arrows point the same way.
   */
  function adjacencyViolation(hx, hy, d) {
    if (hasAdjacentSameDir(hx, hy, d)) return true;
    if (isOnPerimeter(hx, hy)) {
      const dk = _dirKey(d);
      const ns = [
        { x: hx + d.dx, y: hy + d.dy },
        { x: hx - d.dx, y: hy - d.dy },
      ];
      for (const n of ns) {
        if (n.x < 0 || n.x >= cols || n.y < 0 || n.y >= rows) continue;
        if (headByPosDir.has(`${n.x},${n.y}|${dk}`)) return true;
      }
    }
    return false;
  }

  const lb = Math.max(0, Math.min(1, longBias));
  const db = Math.max(0, Math.min(1, dependencyBias));
  // Pass shares — long-FIRST per user spec ("优先生成长线条").
  // Long pass produces arrows with body >5 cells (total >6 cells) and
  // takes the lion's share. Medium fills moderate gaps. Short stubs are
  // capped to 5 per level via SHORT_STUB_LIMIT below.
  const longShare   = 0.50;
  const mediumShare = 0.42;
  const shortShare  = 0.08;
  // Long pass minimum body = 6 cells (= total 7 cells, comfortably above
  // the >5 "long line" threshold).
  const longMin = Math.max(6, Math.floor(maxBodyLen * 0.55));
  // Hard cap on short stubs (2-cell arrows = head + 1 body). Per spec:
  // "短线条1格的线条不能超过5个". Tunable in config.js.
  const SHORT_STUB_LIMIT = LEVEL_CONFIG.SHORT_STUB_LIMIT;
  let shortStubCount = 0;
  // Pass 1 builds the dependency backbone using long arrows with INTERIOR
  // heads pointing to FAR edges. Later passes fill in. Pass 4 (stubs)
  // runs harder to maximize visual density before densify cleans up.
  const passes = [
    { minLen: longMin, maxLen: maxBodyLen,                  share: longShare,   attemptMul: 800,  posBias: "center",  farEdge: db        },
    { minLen: 3,       maxLen: Math.max(4, maxBodyLen - 2), share: mediumShare, attemptMul: 600,  posBias: "uniform", farEdge: db * 0.5 },
    { minLen: 2,       maxLen: Math.max(3, maxBodyLen - 4), share: shortShare,  attemptMul: 800,  posBias: "edge",    farEdge: 0        },
    // Final stub pass — visit every empty cell as a head candidate.
    { minLen: 2,       maxLen: 3,                           share: 0.5,         attemptMul: 1500, posBias: "uniform", farEdge: 0        },
  ];

  // The TRUE hard cap is `targetArrows` (= minArrows from levelParams).
  // We stop placing as soon as we hit it — no over-shoot. capArrows is
  // a separate "early-level strict ceiling" that's usually = targetArrows
  // for those levels and Infinity for hard ones.
  const hardCap = Math.min(targetArrows, capArrows);
  for (let i = 0; i < 3; i++) {
    if (arrows.length >= hardCap) break;
    const pass = passes[i];
    const passTarget = Math.ceil(targetArrows * pass.share);
    const stopAt = Math.min(hardCap, arrows.length + passTarget);
    placePass(pass.minLen, pass.maxLen, stopAt, Math.ceil(passTarget * pass.attemptMul * attemptScale), pass.posBias, pass.farEdge);
  }
  // Stub pass — fills any remaining slack toward `hardCap` with 2-3 cell
  // micro-arrows. Visits every empty cell as a head candidate.
  if (runDensify && !tightChoiceMode && arrows.length < hardCap) {
    const stubPass = passes[3];
    placePass(stubPass.minLen, stubPass.maxLen, hardCap,
              cols * rows * 3, stubPass.posBias, stubPass.farEdge);
  }
  // Densify chain — runs only if we still haven't reached `hardCap`.
  // Order: LONG → MEDIUM → SHORT, mirroring user's "优先生成长线条" rule.
  // Each call short-circuits as soon as arrows.length === hardCap, so
  // we never produce more arrows than the level spec asks for.
  //
  // First three passes prefer CLICKABLE placements (acceptBlocked=false)
  // because clickable stubs add proper "exit-able" arrows that the puzzle
  // structure expects. Late passes flip to acceptBlocked=true to mop up
  // interior pockets that the clickable-only rule can't reach.
  //
  // Adjacency rule stays ON throughout (no parallel arrow ladders).
  // 2-cell stubs (minLen=1) are only allowed via the LATER passes and
  // hard-capped to SHORT_STUB_LIMIT total (see densifyPass body).
  if (runDensify && !tightChoiceMode && arrows.length < hardCap) {
    // Pass A — LONG densify stubs (body 5-9 = total 6-10 cells).
    densifyPass(5, 9, cols * rows * 2, hardCap, /* relaxAdj= */ false);
    // Pass B — MEDIUM stubs (body 3-5 = total 4-6 cells).
    if (arrows.length < hardCap) densifyPass(3, 5, cols * rows * 2, hardCap, /* relaxAdj= */ false);
    // Pass C — slightly shorter (body 2-4 = total 3-5 cells).
    if (arrows.length < hardCap) densifyPass(2, 4, cols * rows * 3, hardCap, /* relaxAdj= */ false);
    // Blocked-stub passes: fill interior pockets with NON-clickable arrows.
    if (arrows.length < hardCap) densifyPass(3, 6, cols * rows * 2, hardCap, /* relaxAdj= */ false, /* acceptBlocked= */ true);
    if (arrows.length < hardCap) densifyPass(2, 4, cols * rows * 3, hardCap, /* relaxAdj= */ false, /* acceptBlocked= */ true);
    // Last-resort: 2-cell stubs (minLen=1, body=1, total=2 cells).
    // SHORT_STUB_LIMIT caps these at 5 per level.
    if (arrows.length < hardCap) densifyPass(1, 2, cols * rows * 4, hardCap, /* relaxAdj= */ false, /* acceptBlocked= */ true);
    if (arrows.length < hardCap) densifyPass(1, 2, cols * rows * 4, hardCap, /* relaxAdj= */ true, /* acceptBlocked= */ true);
  }
  return arrows;

  function biasedPos(bias, max) {
    const u = rng();
    if (bias === "center") {
      const t = (u + rng()) / 2;
      return Math.floor(t * max);
    }
    if (bias === "edge") {
      const t = u < 0.5 ? u * u * 2 : 1 - (1 - u) * (1 - u) * 2;
      return Math.floor(t * max);
    }
    return Math.floor(u * max);
  }

  function placePass(minLen, maxLen, stopAt, maxAttempts, posBias, farEdgeBias = 0) {
    let attempts = 0;
    while (arrows.length < stopAt && attempts < maxAttempts) {
      attempts++;
      const hx = biasedPos(posBias, cols);
      const hy = biasedPos(posBias, rows);
      const headKey = `${hx},${hy}`;
      if (occupied.has(headKey)) continue;

      // Filter out directions that point OFF the grid from a perimeter
      // cell (dist === 0 means head is already on that edge). Such
      // arrows would be trivially clickable (zero-cell head path) and
      // IMPOSSIBLE to block — the user explicitly called these out as
      // unwanted. Removing them at generation is the only fix because
      // there's no cell beyond the edge for a blocker to occupy.
      const distToEdge = [
        { d: { dx:  0, dy: -1 }, dist: hy },
        { d: { dx:  0, dy:  1 }, dist: rows - 1 - hy },
        { d: { dx: -1, dy:  0 }, dist: hx },
        { d: { dx:  1, dy:  0 }, dist: cols - 1 - hx },
      ].filter(o => o.dist > 0);
      if (distToEdge.length === 0) continue;       // shouldn't happen on >1×1 grids
      // Blend two strategies:
      //   near-edge weight (1/(d+1)^1.5) → easy to fit, short head path
      //   far-edge weight ((d+1)^1.2)    → long head path, more dependencies
      const weights = distToEdge.map(o => {
        const near = 1 / Math.pow(o.dist + 1, 1.5);
        const far  = Math.pow(o.dist + 1, 1.2) / 50;  // normalized
        return (1 - farEdgeBias) * near + farEdgeBias * far;
      });
      const totalW = weights.reduce((a, b) => a + b, 0);
      let pick = rng() * totalW;
      let d = distToEdge[0].d;
      for (let i = 0; i < distToEdge.length; i++) {
        if (pick < weights[i]) { d = distToEdge[i].d; break; }
        pick -= weights[i];
      }

      // Visual-variety guard: no two same-direction heads adjacent
      // (stricter rule on the outer perimeter — no two adjacent
      // perimeter arrows may share a direction).
      if (adjacencyViolation(hx, hy, d)) continue;

      let pathOk = true;
      const myHeadPath = [];
      let cx = hx + d.dx, cy = hy + d.dy;
      while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
        if (occupied.has(`${cx},${cy}`)) { pathOk = false; break; }
        myHeadPath.push(`${cx},${cy}`);
        cx += d.dx; cy += d.dy;
      }
      if (!pathOk) continue;

      const cells = [{ x: hx, y: hy }];
      occupied.add(headKey);
      const targetLen = minLen + Math.floor(rng() * (maxLen - minLen + 1));
      let ax = hx, ay = hy;
      const bodyAdded = [headKey];
      const myCellSet = new Set([headKey]);

      for (let i = 0; i < targetLen; i++) {
        let order;
        if (i === 0) {
          order = [{ dx: -d.dx, dy: -d.dy }];
        } else {
          const cands = [
            { dx: -d.dx, dy: -d.dy },
            ...perpendicular(d), ...perpendicular(d), ...perpendicular(d),
          ];
          order = shuffle(cands, rng);
          // Slight preference: lay body across earlier arrows' head paths
          // (creates a dependency that the player must resolve first).
          order.sort((a, b) => {
            const ka = `${ax + a.dx},${ay + a.dy}`;
            const kb = `${ax + b.dx},${ay + b.dy}`;
            return (headPathCells.has(kb) ? 1 : 0) - (headPathCells.has(ka) ? 1 : 0);
          });
        }
        let added = false;
        for (const cand of order) {
          const nx = ax + cand.dx, ny = ay + cand.dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const nk = `${nx},${ny}`;
          if (occupied.has(nk) || myCellSet.has(nk)) continue;
          if (isInFrontOfHead(nx, ny, hx, hy, d)) continue;
          ax = nx; ay = ny;
          cells.unshift({ x: nx, y: ny });
          occupied.add(nk);
          myCellSet.add(nk);
          bodyAdded.push(nk);
          added = true;
          break;
        }
        if (!added) break;
      }

      // `minLen` is the BODY length (= `targetLen` upper bound), so the
      // total cell requirement is `minLen + 1` (head + body). Earlier
      // version compared `cells.length < minLen` which silently accepted
      // arrows one body cell short of the requested length — letting
      // 2-cell stubs leak from passes that should produce 3+ cells.
      if (cells.length < minLen + 1) {
        for (const k of bodyAdded) occupied.delete(k);
        continue;
      }
      arrows.push({ cells });
      headByPosDir.add(`${hx},${hy}|${_dirKey(d)}`);
      for (const k of myHeadPath) headPathCells.add(k);
    }
  }

  /**
   * DENSIFY: pack short stub arrows into empty cells until no more fit.
   *
   * The trick: process cells CLOSEST TO THE EDGE FIRST. Each placement
   * leaves the head adjacent to (or on) the edge with body extending
   * inward — so each arrow's body becomes the "edge" that the next
   * inward cell can use as its head-path target. This snowballs the
   * fill from perimeter inward, penetrating "trapped island" empty
   * regions that a uniform shuffle can't reach.
   *
   * We also iterate multiple times because each placement can unblock
   * cells that previously had no clear-path direction.
   */
  function densifyPass(minLen, maxLen, _maxAttempts, capArrows = Infinity, relaxAdj = false, acceptBlocked = false) {
    let totalAdded = 0;
    // Up to 12 sweeps — most fill happens in the first 2-3, but later
    // sweeps mop up cells freed by prior ones (each placement can
    // unblock previously path-trapped cells). We bail early as soon as
    // a sweep produces 0 new arrows (converged) or we hit capArrows.
    for (let sweep = 0; sweep < 12; sweep++) {
      if (arrows.length >= capArrows) break;
      const empty = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (!occupied.has(`${x},${y}`)) {
            // Sort key: edge-distance (lower = closer to edge = process first)
            const dEdge = Math.min(x, cols - 1 - x, y, rows - 1 - y);
            empty.push({ x, y, dEdge, jitter: rng() });
          }
        }
      }
      if (empty.length === 0) break;
      empty.sort((a, b) => (a.dEdge - b.dEdge) || (a.jitter - b.jitter));

      let added = 0;
      for (const pos of empty) {
        if (arrows.length >= capArrows) break;
        const hx = pos.x, hy = pos.y;
        const headKey = `${hx},${hy}`;
        if (occupied.has(headKey)) continue;          // filled mid-sweep

        // Try all 4 directions; accept SHORTEST clear path (shortest =
        // least likely to hog a corridor needed by a deeper-inside stub).
        let chosenDir = null;
        let chosenPath = null;
        let chosenLen = Infinity;
        const dirs = shuffle([
          { dx:  0, dy: -1 }, { dx:  0, dy: 1 },
          { dx: -1, dy:  0 }, { dx:  1, dy: 0 },
        ], rng);
        for (const d of dirs) {
          // Skip directions that would touch a same-direction head.
          // (For Lv 30+ "no whitespace" mode we relax this — the
          // emergency-fill pass needs it bypassed to reach trapped cells.)
          if (!relaxAdj && adjacencyViolation(hx, hy, d)) continue;
          // Need an empty BACK cell for body1: the runtime infers
          // headDir from cells[N] - cells[N-1], so body1 MUST sit
          // opposite the head direction or the arrow's direction
          // misreads at runtime → looks unclearable mid-puzzle.
          const bx = hx - d.dx, by = hy - d.dy;
          if (bx < 0 || bx >= cols || by < 0 || by >= rows) continue;
          if (occupied.has(`${bx},${by}`)) continue;
          // Walk the head path forward. Two outcomes:
          //   (a) reaches edge with no occupied cell → CLICKABLE arrow.
          //   (b) hits an occupied cell → BLOCKED (non-clickable) arrow.
          // When acceptBlocked is on we accept either; otherwise only (a).
          // Either way the resulting arrow is structurally valid and the
          // runtime infers clickability from the live state.
          let blockedByOther = false;
          const headPath = [];
          let cx = hx + d.dx, cy = hy + d.dy;
          while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
            if (occupied.has(`${cx},${cy}`)) { blockedByOther = true; break; }
            headPath.push(`${cx},${cy}`);
            cx += d.dx; cy += d.dy;
          }
          if (!acceptBlocked && blockedByOther) continue;
          // ── REJECT TRIVIALLY CLICKABLE ──
          // headPath.length === 0 && !blockedByOther means the head sits
          // on the perimeter pointing OFF the grid → instantly clickable
          // and IMPOSSIBLE TO BLOCK (no cells exist beyond the edge for
          // a blocker arrow). These are the rows of edge-pointing arrows
          // the user circled in their screenshot. Refusing them at
          // generation time is the only way to avoid them — enforce can
          // only reverse, and reversal usually creates a topology cycle.
          if (headPath.length === 0 && !blockedByOther) continue;
          // ── SCORING ──
          // Blocked is INHERENTLY non-clickable, so it's strictly better
          // than any clickable placement. Use a negative score for
          // blocked candidates so they always beat clickable ones.
          // Within the same category, shorter paths are preferred (less
          // corridor hogging).
          const score = blockedByOther ? -1000 + headPath.length : headPath.length;
          if (score < chosenLen) {
            chosenLen = score;
            chosenDir = d;
            chosenPath = blockedByOther ? [] : headPath;
          }
        }
        if (!chosenDir) continue;

        // Place head + body backward.
        const cells = [{ x: hx, y: hy }];
        occupied.add(headKey);
        const myCellSet = new Set([headKey]);
        const bodyAdded = [headKey];
        let ax = hx, ay = hy;
        const targetLen = minLen + Math.floor(rng() * (maxLen - minLen + 1));

        for (let i = 0; i < targetLen; i++) {
          let order;
          if (i === 0) {
            // First body cell MUST be the "back" cell (opposite head
            // direction) so the runtime correctly infers headDir from
            // cells[N] - cells[N-1]. We pre-validated back is empty.
            order = [{ dx: -chosenDir.dx, dy: -chosenDir.dy }];
          } else {
            order = shuffle([
              { dx: -chosenDir.dx, dy: -chosenDir.dy },
              ...perpendicular(chosenDir),
            ], rng);
          }
          let placed = false;
          for (const cand of order) {
            const nx = ax + cand.dx, ny = ay + cand.dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const nk = `${nx},${ny}`;
            if (occupied.has(nk)) continue;
            if (isInFrontOfHead(nx, ny, hx, hy, chosenDir)) continue;
            ax = nx; ay = ny;
            cells.unshift({ x: nx, y: ny });
            occupied.add(nk);
            myCellSet.add(nk);
            bodyAdded.push(nk);
            placed = true;
            break;
          }
          if (!placed) break;
        }

        // Enforce the requested body length: cells.length >= minLen + 1
        // (head + minLen body cells). Without this, when only 1 body fits
        // we'd silently keep a 2-cell arrow even when minLen=3 was asked.
        if (cells.length < minLen + 1) {
          for (const k of bodyAdded) occupied.delete(k);
          continue;
        }
        // ── SHORT-STUB CAP ──
        // 2-cell arrows (head + 1 body) are the visual equivalent of a
        // single dot. Per spec: "短线条1格的线条不能超过5个". Reject
        // additional 2-cell placements once we hit the limit; the caller
        // has additional passes that may still find longer arrows that
        // aren't subject to this cap.
        if (cells.length === 2 && shortStubCount >= SHORT_STUB_LIMIT) {
          for (const k of bodyAdded) occupied.delete(k);
          continue;
        }
        if (cells.length === 2) shortStubCount++;
        arrows.push({ cells });
        // ── CYCLE GUARD for BLOCKED-STUB placements ──
        // When the chosen direction is blocked by another arrow, the
        // new arrow's body MAY cross that arrow's head path → mutual
        // blocking → cycle → unsolvable puzzle. The clickable case
        // (chosenPath.length > 0) cannot create a cycle because the
        // new arrow has no incoming dependencies. Cheap to verify here
        // (O(N) once per blocked placement) vs the alternative of
        // letting cycles propagate to the player.
        if (chosenPath.length === 0) {        // = blocked stub
          if (!isSolvableTopo(arrows, cols, rows)) {
            // Roll back: remove the arrow we just pushed and free its cells.
            arrows.pop();
            for (const k of bodyAdded) occupied.delete(k);
            if (cells.length === 2) shortStubCount--;
            continue;
          }
        }
        headByPosDir.add(`${hx},${hy}|${_dirKey(chosenDir)}`);
        for (const k of chosenPath) headPathCells.add(k);
        added++;
      }
      totalAdded += added;
      if (added === 0) break;            // converged — no more progress possible
    }
  }
}

function perpendicular(d) {
  if (d.dx !== 0) return [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
  return [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
}

function isInFrontOfHead(x, y, hx, hy, d) {
  if (d.dx !== 0) return y === hy && Math.sign(x - hx) === Math.sign(d.dx);
  return x === hx && Math.sign(y - hy) === Math.sign(d.dy);
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Count arrows that are CLICKABLE at the start state (head path clear
// to a grid edge with no other arrow in the way). Used by generateLevel
// to pick the best of several candidate seeds.
function countInitialClickable(arrows, cols, rows) {
  const occupied = new Map();
  for (let i = 0; i < arrows.length; i++)
    for (const c of arrows[i].cells)
      occupied.set(`${c.x},${c.y}`, i);
  let n = 0;
  for (let i = 0; i < arrows.length; i++) {
    const arr = arrows[i];
    if (arr.cells.length < 2) continue;
    const head = arr.cells[arr.cells.length - 1];
    const prev = arr.cells[arr.cells.length - 2];
    const d = { dx: head.x - prev.x, dy: head.y - prev.y };
    let blocked = false;
    let cx = head.x + d.dx, cy = head.y + d.dy;
    while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
      const o = occupied.get(`${cx},${cy}`);
      if (o != null && o !== i) { blocked = true; break; }
      cx += d.dx; cy += d.dy;
    }
    if (!blocked) n++;
  }
  return n;
}

// Endless mode: continues the difficulty curve past the curated levels.
// Multi-seed strategy: generate a small number of candidate seeds and
// keep the one with the FEWEST initial clickable arrows. This is the
// most reliable way to drive Lv 30+ toward the strict 1-clickable target
// — `enforceInitialClickable` alone can't always converge because every
// reversal in a dense maze risks creating a topology cycle, but seed
// variance gives us 4-12 clickable across seeds and picking the best
// consistently lands at 4-7 instead of the seed-dependent worst case.
export function generateLevel(index) {
  const n = index - LEVELS.length + 1;        // endless level # (1, 2, 3, ...)
  const overallLevel = index + 1;             // overall level # (13, 14, 15, ...)
  const p = levelParams(overallLevel);

  const time = TIME(overallLevel);
  const palettes = Object.values(PALETTES);
  // Color policy (matches the curated levels): colored is the default,
  // monochrome is the rare exception. Roughly 1 in 4 endless levels is
  // monochrome to keep visual variety without dominating the palette.
  const palette = p.isBoss
    ? PALETTES.sunset
    : (n % 4 === 0 ? null : palettes[(index * 7) % palettes.length]);

  // Number of seeds to try. Hard levels (Lv 30+) get more attempts since
  // the enforce step can't fully close the gap to target=1. Easy levels
  // need only 1 seed because they hit target naturally.
  // Boss is capped at 2 because each attempt is ~4 s.
  const numSeeds = p.isBoss
    ? 2
    : overallLevel >= 30 ? 4
    : overallLevel >= 20 ? 2
    : 1;

  let bestArrows = null;
  let bestClickable = Infinity;
  let bestCols = p.cols, bestRows = p.rows;
  // Fallback for the absurd case where every seed somehow returns 0
  // clickable arrows — keep the very first generation result so we
  // ALWAYS hand back a playable map, even if it's over the target.
  let firstArrows = null, firstCols = p.cols, firstRows = p.rows;
  for (let s = 0; s < numSeeds; s++) {
    const seed = index * 1337 + 7 + s * 99991;
    const arrows = makeMazeLevel(
      p.cols, p.rows, p.count, p.maxBody,
      seed, palette,
      p.longBias, p.targetTight, p.depBias,
      /* fast= */ true, p.minArrows, p.capArrows, p.targetMaxChoices ?? null,
      p.coverageCap ?? null
    );
    let actualCols = p.cols, actualRows = p.rows;
    for (const a of arrows) for (const c of a.cells) {
      if (c.x + 1 > actualCols) actualCols = c.x + 1;
      if (c.y + 1 > actualRows) actualRows = c.y + 1;
    }
    const click = countInitialClickable(arrows, actualCols, actualRows);
    // ── CRITICAL: reject seeds with broken dependency graphs ──
    // The densify acceptBlocked=true passes can create cycles where
    // arrow A blocks arrow B, B blocks A → neither ever clears, puzzle
    // gets stuck mid-game. Cycled puzzles ALSO have very few clickable
    // arrows (which is why the multi-seed selector previously preferred
    // them — score = clickable count). Run a topological-sort check on
    // every candidate and reject any that fail.
    const solvable = isSolvableTopo(arrows, actualCols, actualRows);
    if (s === 0 && solvable) {
      firstArrows = arrows; firstCols = actualCols; firstRows = actualRows;
    }
    if (!solvable) continue;        // unsolvable — try next seed
    // 0 clickable = no way to start. Reject too.
    if (click < 1) continue;
    if (click < bestClickable) {
      bestClickable = click;
      bestArrows = arrows;
      bestCols = actualCols;
      bestRows = actualRows;
      if (click <= (p.targetMaxChoices ?? 0)) break;
    }
  }
  if (!bestArrows) {
    // No seed in the budget produced a solvable + playable puzzle.
    // If we managed to capture a solvable first seed, use it.
    // Last resort: keep extending the seed search until we find one
    // (each additional attempt is cheap relative to handing back a
    // broken level — better to wait an extra second than to crash).
    if (firstArrows) {
      bestArrows = firstArrows; bestCols = firstCols; bestRows = firstRows;
    } else {
      for (let s = numSeeds; s < numSeeds + 12; s++) {
        const seed = index * 1337 + 7 + s * 99991;
        const arrows = makeMazeLevel(
          p.cols, p.rows, p.count, p.maxBody,
          seed, palette,
          p.longBias, p.targetTight, p.depBias,
          true, p.minArrows, p.capArrows, p.targetMaxChoices ?? null,
          p.coverageCap ?? null
        );
        let actualCols = p.cols, actualRows = p.rows;
        for (const a of arrows) for (const c of a.cells) {
          if (c.x + 1 > actualCols) actualCols = c.x + 1;
          if (c.y + 1 > actualRows) actualRows = c.y + 1;
        }
        if (isSolvableTopo(arrows, actualCols, actualRows) &&
            countInitialClickable(arrows, actualCols, actualRows) >= 1) {
          bestArrows = arrows;
          bestCols = actualCols;
          bestRows = actualRows;
          break;
        }
      }
    }
  }

  return {
    name: p.isBoss ? "无限轮回" : `无尽第${n}层`,
    cols: bestCols, rows: bestRows,
    timeLimit: time,
    lives: 3,
    isBoss: !!p.isBoss,
    arrows: bestArrows,
  };
}

// Memoize endless generations so re-entering the same level is instant
// and clicking "next" twice doesn't pay the cost twice.
const _endlessCache = new Map();
function _getOrGenerateEndless(index) {
  const hit = _endlessCache.get(index);
  if (hit) return hit;
  const lv = generateLevel(index);
  _endlessCache.set(index, lv);
  // Cap cache to last 8 endless levels
  if (_endlessCache.size > 8) {
    const oldestKey = _endlessCache.keys().next().value;
    _endlessCache.delete(oldestKey);
  }
  return lv;
}

export function getLevel(index) {
  if (index < LEVELS.length) return LEVELS[index];
  return _getOrGenerateEndless(index);
}

/**
 * Async variant — yields to the UI thread before doing heavy work, so
 * the loading spinner can paint. Returns a Promise<level>.
 *   - Curated levels resolve immediately (no work).
 *   - Endless levels yield once, then generate, then resolve.
 */
export function getLevelAsync(index) {
  if (index < LEVELS.length) return Promise.resolve(LEVELS[index]);
  if (_endlessCache.has(index)) return Promise.resolve(_endlessCache.get(index));
  return new Promise((resolve) => {
    // Two RAFs guarantee the loading overlay actually paints before we
    // start the heavy synchronous generator.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve(_getOrGenerateEndless(index));
    }));
  });
}

/**
 * Fire-and-forget pre-warm for an endless level. Runs during browser
 * idle time so the next "下一关" tap finds the result already in cache
 * and resolves instantly (no spinner). No-op for curated levels and for
 * already-cached endless levels.
 *
 * `_pendingPrefetch` dedupes calls — without it, every loadLevel would
 * re-schedule generation for the same index even while a previous
 * idle callback was already in flight.
 */
const _pendingPrefetch = new Set();
export function prefetchLevel(index) {
  if (index < LEVELS.length) return;
  if (_endlessCache.has(index)) return;
  if (_pendingPrefetch.has(index)) return;
  _pendingPrefetch.add(index);
  const run = () => {
    _pendingPrefetch.delete(index);
    if (_endlessCache.has(index)) return;
    try { _getOrGenerateEndless(index); } catch { /* swallow — best-effort */ }
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 1500);
  }
}

/**
 * Pre-warm a range of upcoming endless levels. Each level is scheduled
 * as its own idle callback, so they don't pile up into one giant block
 * — the browser interleaves them with user input + paint frames.
 */
export function prefetchRange(startIndex, count) {
  for (let i = 0; i < count; i++) prefetchLevel(startIndex + i);
}
