// Arrow data model — an Arrow is a CHAIN of grid cells (a snake-like path).
// The LAST cell in `cells` is the HEAD; the head's direction is inferred from
// the last segment (or specified explicitly for single-cell arrows).
//
// To remove an arrow, the straight line from the HEAD in the head's direction
// to the edge of the board must contain no OTHER on-board arrow's cells.

export const DIR = Object.freeze({
  UP:    { dx:  0, dy: -1, name: "UP",    angle: -Math.PI / 2 },
  DOWN:  { dx:  0, dy:  1, name: "DOWN",  angle:  Math.PI / 2 },
  LEFT:  { dx: -1, dy:  0, name: "LEFT",  angle:  Math.PI },
  RIGHT: { dx:  1, dy:  0, name: "RIGHT", angle:  0 },
});

export const DIR_BY_NAME = {
  UP: DIR.UP, DOWN: DIR.DOWN, LEFT: DIR.LEFT, RIGHT: DIR.RIGHT,
  U: DIR.UP, D: DIR.DOWN, L: DIR.LEFT, R: DIR.RIGHT,
};

function dirFromDelta(dx, dy) {
  if (dx === 1  && dy === 0) return DIR.RIGHT;
  if (dx === -1 && dy === 0) return DIR.LEFT;
  if (dx === 0  && dy === 1) return DIR.DOWN;
  if (dx === 0  && dy === -1) return DIR.UP;
  return null;
}

export const STATE = Object.freeze({
  IDLE:    "idle",
  FLYING:  "flying",
  REMOVED: "removed",
  SHAKE:   "shake",
});

let __nextId = 1;

export class Arrow {
  /**
   * @param {Array<{x:number, y:number}>} cells - ordered tail→head; head is cells[length-1]
   * @param {string|object} [explicitHead] - direction string/obj if 1-cell arrow
   * @param {string} [color]
   */
  constructor(cells, explicitHead = null, color = "#1a1a1a") {
    if (!Array.isArray(cells) || cells.length === 0) {
      throw new Error("Arrow requires at least 1 cell");
    }
    this.id = __nextId++;
    this.cells = cells.map(c => ({ x: c.x, y: c.y }));
    this.color = color;
    this.state = STATE.IDLE;

    if (cells.length >= 2) {
      const last = cells[cells.length - 1];
      const prev = cells[cells.length - 2];
      this.headDir = dirFromDelta(last.x - prev.x, last.y - prev.y) || DIR.UP;
    } else if (explicitHead) {
      this.headDir = typeof explicitHead === "string"
        ? DIR_BY_NAME[explicitHead.toUpperCase()] || DIR.UP
        : explicitHead;
    } else {
      this.headDir = DIR.UP;
    }

    // Animation state
    this.flyOffset = { x: 0, y: 0 };
    this.flyStartT = 0;
    this.flyDuration = 460;
    this.shakeT = 0;
    this.shakeDuration = 320;
    // Hint glow — set to performance.now() to start a pulse, 0 = inactive.
    this.hintT = 0;
    this.hintDuration = 3800;
    this.alpha = 1;
  }

  isOnBoard() {
    return this.state === STATE.IDLE || this.state === STATE.SHAKE;
  }
  isAlive() { return this.state !== STATE.REMOVED; }
  head()    { return this.cells[this.cells.length - 1]; }
  tail()    { return this.cells[0]; }
  length()  { return this.cells.length; }
}

/**
 * Convenience builder: build a chain of cells from a start point and a string of moves.
 *   moves uses U/D/L/R characters (case insensitive).
 *   path(2, 5, "UUR") → [(2,5),(2,4),(2,3),(3,3)]   // head at (3,3) pointing RIGHT
 */
export function path(startX, startY, moves) {
  const cells = [{ x: startX, y: startY }];
  let x = startX, y = startY;
  for (const m of moves) {
    const u = m.toUpperCase();
    if      (u === "U") y--;
    else if (u === "D") y++;
    else if (u === "L") x--;
    else if (u === "R") x++;
    else continue;
    cells.push({ x, y });
  }
  return cells;
}
