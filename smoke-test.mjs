// Headless smoke tests for the path-based Arrow model.
import { Board } from "./js/board.js";
import { STATE, path, Arrow } from "./js/arrow.js";
import { LEVELS, getLevel, generateLevel } from "./js/levels.js";

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓", msg); }
  else { failed++; console.log("  ✗ FAIL:", msg); }
}

console.log("\n[Test 1] path() builder produces correct cell sequence");
const cells = path(2, 5, "UURR");
assert(cells.length === 5, "5 cells for 4 moves");
assert(cells[0].x === 2 && cells[0].y === 5, "first cell is start");
assert(cells[4].x === 4 && cells[4].y === 3, "last cell is at (4,3)");

console.log("\n[Test 2] Arrow infers head direction from last segment");
const a = new Arrow(path(0, 5, "UURR"));
assert(a.head().x === 2 && a.head().y === 3, "head at (2,3)");
assert(a.headDir.name === "RIGHT", "head direction is RIGHT");

console.log("\n[Test 3] Single-cell arrow uses explicit head");
const single = new Arrow([{ x: 3, y: 3 }], "UP");
assert(single.headDir.name === "UP", "explicit head respected");

console.log("\n[Test 4] Build a board from a synthetic 3-arrow level");
const synthLevel = {
  cols: 5, rows: 7, timeLimit: 60, lives: 3,
  arrows: [
    { cells: path(1, 5, "UUUUU") },
    { cells: path(2, 5, "UUUUU") },
    { cells: path(3, 5, "UUUUU") },
  ],
};
const b1 = Board.fromLevel(synthLevel);
assert(b1.arrows.length === 3, "3 arrows loaded");
assert(b1.cellMap.size === 18, "18 cells in map (3 arrows × 6 cells each)");
assert(b1.getArrowAt(1, 5) !== null, "arrow at start cell");
assert(b1.getArrowAt(1, 0) !== null, "arrow at head cell");

console.log("\n[Test 5] Tap on any cell of the path picks the arrow");
const arrow0 = b1.getArrowAt(1, 5);
const arrowMid = b1.getArrowAt(1, 3);
const arrowHead = b1.getArrowAt(1, 0);
assert(arrow0 === arrowMid && arrowMid === arrowHead, "all cells of arrow point to same Arrow");

console.log("\n[Test 6] All synthetic arrows are immediately clearable");
for (const a of b1.arrows) {
  assert(b1.isPathClear(a), `arrow with head at (${a.head().x},${a.head().y}) is path-clear`);
}

console.log("\n[Test 7] Removing an arrow vacates ALL its cells");
const a0 = b1.arrows[0];
const cellsBefore = a0.cells.map(c => `${c.x},${c.y}`);
b1.startFlight(a0, performance.now());
assert(a0.state === STATE.FLYING, "state is FLYING");
for (const k of cellsBefore) {
  assert(!b1.cellMap.has(k), `cell ${k} no longer in cellMap`);
}

console.log("\n[Test 8] Restore puts all cells back");
b1.restore(a0);
for (const k of cellsBefore) {
  assert(b1.cellMap.get(k) === a0, `cell ${k} restored to arrow`);
}

console.log("\n[Test 9] Chain dependency — body of one blocks head of another");
const chainLevel = {
  cols: 7, rows: 7, timeLimit: 120, lives: 3,
  arrows: [
    { cells: path(0, 0, "RRRR") },   // top RIGHT — CLEAR
    { cells: path(0, 5, "UUU") },    // left UP — blocked by top arrow at (0,0)
  ],
};
const b4 = Board.fromLevel(chainLevel);
const top = b4.arrows[0];
const left = b4.arrows[1];
assert(b4.isPathClear(top), "top RIGHT arrow is clear");
assert(!b4.isPathClear(left), "left UP arrow is BLOCKED initially");
b4.startFlight(top, performance.now());
top.state = STATE.REMOVED;
assert(b4.isPathClear(left), "after top removed, left UP becomes clear");

console.log("\n[Test 10] All curated levels are solvable");
LEVELS.forEach((lv, i) => {
  const b = Board.fromLevel(lv);
  assert(b.isSolvable(), `Level ${i+1} "${lv.name}" is solvable`);
});

console.log("\n[Test 11] Procedural endless levels are solvable");
for (let i = 0; i < 6; i++) {
  const lv = generateLevel(LEVELS.length + i);
  const b = Board.fromLevel(lv);
  assert(b.isSolvable(), `Endless #${i+1} (${lv.arrows.length} arrows) solvable`);
}

console.log("\n[Test 12] No two arrows share a cell");
LEVELS.forEach((lv, i) => {
  const seen = new Map();
  let ok = true;
  for (let ai = 0; ai < lv.arrows.length; ai++) {
    for (const c of lv.arrows[ai].cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) ok = false;
      seen.set(k, ai);
    }
  }
  assert(ok, `Level ${i+1}: no overlapping cells`);
});

console.log(`\nTotal: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
