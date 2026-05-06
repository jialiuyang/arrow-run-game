// Verify all curated levels are SOLVABLE and have valid (in-bounds, non-overlapping)
// path data. Run: node verify-levels.mjs
import { LEVELS, generateLevel } from "./js/levels.js";
import { Board } from "./js/board.js";

function validate(level) {
  const issues = [];
  const occupied = new Map();
  for (let i = 0; i < level.arrows.length; i++) {
    const a = level.arrows[i];
    const cells = a.cells;
    if (!cells || cells.length === 0) {
      issues.push(`arrow ${i}: empty cells`);
      continue;
    }
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      if (c.x < 0 || c.x >= level.cols || c.y < 0 || c.y >= level.rows) {
        issues.push(`arrow ${i} cell ${j}: out of bounds (${c.x},${c.y})`);
      }
      const k = `${c.x},${c.y}`;
      if (occupied.has(k)) {
        issues.push(`overlap at (${c.x},${c.y}) between arrows ${occupied.get(k)} and ${i}`);
      }
      occupied.set(k, i);
      if (j > 0) {
        const p = cells[j - 1];
        const dx = Math.abs(c.x - p.x), dy = Math.abs(c.y - p.y);
        if (dx + dy !== 1) {
          issues.push(`arrow ${i}: cells ${j-1}->${j} not adjacent`);
        }
      }
    }
  }
  return issues;
}

console.log("=== Curated Levels ===");
let allOk = true;
for (let i = 0; i < LEVELS.length; i++) {
  const lv = LEVELS[i];
  const issues = validate(lv);
  const board = Board.fromLevel(lv);
  const solvable = board.isSolvable();
  const ok = issues.length === 0 && solvable;
  if (!ok) allOk = false;
  console.log(`${ok ? "✅" : "❌"} Level ${i+1} "${lv.name}" — ${lv.arrows.length} arrows, ${lv.cols}×${lv.rows}, solvable=${solvable}`);
  for (const issue of issues) console.log("    ⚠", issue);
}

console.log("\n=== Endless Sample ===");
for (let i = 0; i < 5; i++) {
  const lv = generateLevel(LEVELS.length + i);
  const issues = validate(lv);
  const board = Board.fromLevel(lv);
  const solvable = board.isSolvable();
  const ok = issues.length === 0 && solvable;
  if (!ok) allOk = false;
  console.log(`${ok ? "✅" : "❌"} ${lv.name} — ${lv.arrows.length} arrows, ${lv.cols}×${lv.rows}`);
}

console.log(allOk ? "\nAll levels valid & solvable! ✨" : "\nSome levels FAILED.");
process.exit(allOk ? 0 : 1);
