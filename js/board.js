import { Arrow, STATE, path } from "./arrow.js";

/**
 * Board — owns the grid + arrows + blocking detection.
 * The cellMap keeps a fast lookup of which on-board arrow occupies a cell.
 *
 * KEY RULE: an arrow can be removed iff the straight line from its HEAD in the
 * head-pointing direction (until the edge of the board) does NOT contain ANY
 * cell belonging to ANOTHER on-board arrow.
 */
export class Board {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    /** @type {Arrow[]} */
    this.arrows = [];
    /** @type {Map<string, Arrow>} */
    this.cellMap = new Map();
    /** Coins placed on cells (random in-game events). key → coin count.
     *  Cells with coins are EMPTY of arrows by construction (we only put
     *  coins on cells the head will fly through). Collected when an
     *  arrow's head traverses the cell during its flight animation. */
    /** @type {Map<string, number>} */
    this.coinMap = new Map();
  }

  static key(x, y) { return `${x},${y}`; }

  /**
   * @param {{cols:number, rows:number, arrows:Array}} level
   * Each arrow def: `{ cells: [{x,y},...] }` OR `{ start:{x,y}, moves:"UULR", head?:"UP" }`
   */
  static fromLevel(level) {
    const b = new Board(level.cols, level.rows);
    for (const def of level.arrows) {
      let cells = def.cells;
      if (!cells && def.start && def.moves != null) {
        cells = path(def.start.x, def.start.y, def.moves);
      }
      const arrow = new Arrow(cells, def.head, def.color);
      // Validate: in-bounds + no overlap
      for (const c of arrow.cells) {
        if (!b.inBounds(c.x, c.y)) {
          console.warn("Arrow cell out of bounds:", c, "in level");
        }
        const k = Board.key(c.x, c.y);
        if (b.cellMap.has(k)) {
          console.warn("Cell overlap at", c, "between arrows; second arrow ignored at this cell");
          continue;
        }
        b.cellMap.set(k, arrow);
      }
      b.arrows.push(arrow);
    }
    return b;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  /** Returns the on-board arrow occupying (x,y), or null. */
  getArrowAt(x, y) {
    const a = this.cellMap.get(Board.key(x, y));
    return a && a.isOnBoard() ? a : null;
  }

  /**
   * Path-clear check: from the head, in the head's direction, walk to the edge.
   * If any cell along the way is occupied by another on-board arrow, blocked.
   */
  isPathClear(arrow) {
    if (!arrow.isOnBoard()) return false;
    const head = arrow.head();
    const dir = arrow.headDir;
    let x = head.x + dir.dx;
    let y = head.y + dir.dy;
    while (this.inBounds(x, y)) {
      const other = this.cellMap.get(Board.key(x, y));
      if (other && other !== arrow && other.isOnBoard()) return false;
      x += dir.dx;
      y += dir.dy;
    }
    return true;
  }

  /** Returns the list of distinct OTHER arrows currently blocking the head's path. */
  blockers(arrow) {
    const list = [];
    if (!arrow.isOnBoard()) return list;
    const head = arrow.head();
    const dir = arrow.headDir;
    let x = head.x + dir.dx, y = head.y + dir.dy;
    while (this.inBounds(x, y)) {
      const other = this.cellMap.get(Board.key(x, y));
      if (other && other !== arrow && other.isOnBoard() && !list.includes(other)) {
        list.push(other);
      }
      x += dir.dx;
      y += dir.dy;
    }
    return list;
  }

  /** Mark arrow flying — vacate its cells immediately so chains can fire. */
  startFlight(arrow, now) {
    if (!arrow.isOnBoard()) return false;
    arrow.state = STATE.FLYING;
    arrow.flyStartT = now;
    // Snake-out duration scales with path length so longer arrows fully thread out.
    const N = arrow.cells.length - 1;
    const totalSlide = N + Math.max(this.cols, this.rows) + 2;
    arrow.flyTotalSlide = totalSlide;          // exposed for animated coin pickup
    arrow.flyDuration = Math.max(380, 70 * totalSlide);
    for (const c of arrow.cells) {
      const k = Board.key(c.x, c.y);
      if (this.cellMap.get(k) === arrow) this.cellMap.delete(k);
    }
    return true;
  }

  /** Restore a previously-flown arrow back into the board (for undo). */
  restore(arrow) {
    arrow.state = STATE.IDLE;
    arrow.alpha = 1;
    arrow.flyOffset = { x: 0, y: 0 };
    for (const c of arrow.cells) {
      this.cellMap.set(Board.key(c.x, c.y), arrow);
    }
  }

  liveArrows() { return this.arrows.filter(a => a.isOnBoard()); }
  isCleared() { return this.arrows.every(a => a.state === STATE.REMOVED); }

  // ── Coin random-event helpers ────────────────────────────────────────
  // Coins ride on EMPTY cells that an arrow's head will traverse when the
  // line is clicked. Once the line flies, the head walks through these
  // cells and we collect them. See COIN_EVENT_CONFIG in config.js.

  /**
   * Returns the cells along an arrow's head-flight path that are
   * currently EMPTY (not occupied by any on-board arrow). These are the
   * candidate cells for coin placement: when the arrow is eventually
   * clicked, its head MUST pass through them on the way off the board.
   * @returns {Array<{x:number,y:number}>}
   */
  emptyHeadPathCells(arrow) {
    const list = [];
    if (!arrow.isOnBoard()) return list;
    const head = arrow.head();
    const dir = arrow.headDir;
    let x = head.x + dir.dx, y = head.y + dir.dy;
    while (this.inBounds(x, y)) {
      const k = Board.key(x, y);
      const occ = this.cellMap.get(k);
      if (!occ || !occ.isOnBoard()) list.push({ x, y });
      x += dir.dx; y += dir.dy;
    }
    return list;
  }

  /** Place exactly 1 coin on each of the given cells (no stacking). */
  placeCoinsAt(cells) {
    for (const c of cells) this.coinMap.set(Board.key(c.x, c.y), 1);
  }

  /** True if (x,y) currently holds an uncollected coin. */
  hasCoinAt(x, y) {
    return this.coinMap.has(Board.key(x, y));
  }

  /**
   * Collect every coin on the cells the given arrow's head will sweep
   * across as it flies off (head + dir, head + 2·dir, ...). Returns the
   * total coin count collected. Cells are removed from coinMap as they
   * are picked up.
   * @returns {{count:number, cells:Array<{x:number,y:number}>}}
   */
  collectCoinsOnHeadPath(arrow) {
    const collected = [];
    if (this.coinMap.size === 0) return { count: 0, cells: collected };
    const head = arrow.head();
    const dir = arrow.headDir;
    let x = head.x + dir.dx, y = head.y + dir.dy;
    while (this.inBounds(x, y)) {
      const k = Board.key(x, y);
      const n = this.coinMap.get(k);
      if (n) {
        collected.push({ x, y, n });
        this.coinMap.delete(k);
      }
      x += dir.dx; y += dir.dy;
    }
    const total = collected.reduce((s, c) => s + c.n, 0);
    return { count: total, cells: collected };
  }

  findClearable() {
    for (const a of this.arrows) {
      if (a.isOnBoard() && this.isPathClear(a)) return a;
    }
    return null;
  }

  /** Greedy solvability simulation. */
  isSolvable() {
    const remaining = new Set();
    const cellMap = new Map();
    for (const a of this.arrows) {
      if (!a.isOnBoard()) continue;
      remaining.add(a.id);
      for (const c of a.cells) cellMap.set(Board.key(c.x, c.y), a);
    }
    const arrowById = new Map(this.arrows.map(a => [a.id, a]));
    let progressed = true;
    while (progressed && remaining.size > 0) {
      progressed = false;
      for (const id of remaining) {
        const a = arrowById.get(id);
        const head = a.head(), dir = a.headDir;
        let x = head.x + dir.dx, y = head.y + dir.dy;
        let clear = true;
        while (this.inBounds(x, y)) {
          const other = cellMap.get(Board.key(x, y));
          if (other && other !== a && remaining.has(other.id)) { clear = false; break; }
          x += dir.dx; y += dir.dy;
        }
        if (clear) {
          remaining.delete(id);
          for (const c of a.cells) {
            if (cellMap.get(Board.key(c.x, c.y)) === a) cellMap.delete(Board.key(c.x, c.y));
          }
          progressed = true;
          break;
        }
      }
    }
    return remaining.size === 0;
  }
}
