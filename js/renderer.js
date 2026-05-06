import { STATE } from "./arrow.js";

/**
 * Canvas renderer for path-style arrows.
 *
 * Visual style (matches reference screenshots):
 *  - Thick black line through cell centers, rounded joins/caps
 *  - Bold filled triangular arrowhead at the head cell
 *  - NO color hint differentiating clearable vs blocked arrows
 *  - Slide-out animation: SNAKE-style — body cells advance ALONG the path,
 *    so corners bend out one segment at a time and the snake threads through
 *    its own body before exiting straight in the head direction.
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    // Camera
    this.scale = 1;
    this.baseScale = 60;   // px per grid cell, computed on resize
    this.offsetX = 0;
    this.offsetY = 0;

    this.board = null;
    this.particles = [];
    this.viewportW = 0;
    this.viewportH = 0;
    // Cached render-order list (idle → shake → flying → removed). The
    // sort key only changes when an arrow's state transitions, which
    // happens far less than once per frame. We rebuild lazily by hashing
    // the joined state string and comparing to the previous hash.
    this._sortedArrows = null;
    this._sortKey = "";

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  setBoard(board) {
    this.board = board;
    this.particles = [];
    this._sortedArrows = null;
    this._sortKey = "";
    this._fitBoard();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.viewportW = rect.width;
    this.viewportH = rect.height;
    this.canvas.width  = Math.floor(rect.width  * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    if (this.board) this._fitBoard();
  }

  _fitBoard() {
    if (!this.board) return;
    // Tight margin — user can pinch-zoom for accuracy on tiny cells
    const margin = 8;
    const wAvail = this.viewportW - margin * 2;
    const hAvail = this.viewportH - margin * 2;
    const sx = wAvail / this.board.cols;
    const sy = hAvail / this.board.rows;
    // No artificial floor — the maze MUST fit inside the viewport at init.
    // The user can still zoom in/out manually after that.
    this.baseScale = Math.max(8, Math.min(sx, sy));
    this.scale = 1;
    const boardW = this.board.cols * this.baseScale;
    const boardH = this.board.rows * this.baseScale;
    this.offsetX = (this.viewportW - boardW) / 2;
    this.offsetY = (this.viewportH - boardH) / 2;
  }

  worldToScreen(gx, gy) {
    const s = this.baseScale * this.scale;
    return { x: this.offsetX + gx * s, y: this.offsetY + gy * s };
  }

  screenToWorld(px, py) {
    const s = this.baseScale * this.scale;
    return { x: (px - this.offsetX) / s, y: (py - this.offsetY) / s };
  }

  /**
   * Pick the nearest on-board arrow to a screen-space tap/click.
   *
   * Previous logic only snapped to occupied cells (+4-neighbour fallback),
   * so taps on the "visible line" but between cell centers could miss,
   * especially on phones. We now measure geometric distance to the WHOLE
   * arrow polyline (including the head tip) and accept if inside a hit
   * radius. Touch gets a larger radius than mouse for fingertip occlusion.
   */
  pickArrow(px, py, pointerType = "mouse") {
    if (!this.board) return null;
    const w = this.screenToWorld(px, py);
    const isTouch = pointerType === "touch" || pointerType === "pen";
    const hitRadius = isTouch ? 0.72 : 0.50; // world cell units
    let best = null;
    let bestD = hitRadius;

    for (const arrow of this.board.arrows) {
      if (!arrow.isOnBoard()) continue;
      const d = this._distanceToArrowPolyline(arrow, w.x, w.y);
      if (d < bestD) {
        bestD = d;
        best = arrow;
      }
    }
    return best;
  }

  zoomAt(px, py, factor) {
    const newScale = clamp(this.scale * factor, 0.5, 3);
    const realFactor = newScale / this.scale;
    if (realFactor === 1) return;
    this.offsetX = px - (px - this.offsetX) * realFactor;
    this.offsetY = py - (py - this.offsetY) * realFactor;
    this.scale = newScale;
    this._clampPan();
  }

  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
    this._clampPan();
  }

  _clampPan() {
    if (!this.board) return;
    const s = this.baseScale * this.scale;
    const boardW = this.board.cols * s;
    const boardH = this.board.rows * s;
    const margin = 80;
    if (boardW + margin * 2 < this.viewportW) {
      this.offsetX = (this.viewportW - boardW) / 2;
    } else {
      this.offsetX = clamp(this.offsetX, this.viewportW - boardW - margin, margin);
    }
    if (boardH + margin * 2 < this.viewportH) {
      this.offsetY = (this.viewportH - boardH) / 2;
    } else {
      this.offsetY = clamp(this.offsetY, this.viewportH - boardH - margin, margin);
    }
  }

  spawnTrail(arrow, color = "#1a1a1a") {
    const head = arrow.head();
    const dir = arrow.headDir;
    const c = this.worldToScreen(head.x + 0.5, head.y + 0.5);
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: c.x + (Math.random() - 0.5) * 12,
        y: c.y + (Math.random() - 0.5) * 12,
        vx: -dir.dx * (40 + Math.random() * 60),
        vy: -dir.dy * (40 + Math.random() * 60),
        life: 0, ttl: 380 + Math.random() * 220,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  spawnBurst(gx, gy, color = "#ffb84a", count = 8) {
    const c = this.worldToScreen(gx, gy);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 180;
      this.particles.push({
        x: c.x, y: c.y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 40,
        life: 0, ttl: 500 + Math.random() * 300,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  draw(now, dt) {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.viewportW, this.viewportH);

    if (!this.board) { ctx.restore(); return; }

    // Soft rounded panel background
    this._drawPanel();

    // Draw arrows. Render flying ones above idle ones so they appear to
    // glide over. Cached: rebuild the sorted list ONLY when an arrow's
    // state actually changes (compared via a quick joined-state hash),
    // not every single frame. Previously we paid a full slice+sort every
    // RAF which is ~125-arrow N-log-N at Lv 50.
    let stateKey = "";
    const rawArrows = this.board.arrows;
    for (let i = 0; i < rawArrows.length; i++) stateKey += rawArrows[i].state[0];
    if (stateKey !== this._sortKey || !this._sortedArrows) {
      this._sortedArrows = rawArrows.slice().sort((a, b) => {
        const order = { idle: 0, shake: 1, flying: 2, removed: 3 };
        return order[a.state] - order[b.state];
      });
      this._sortKey = stateKey;
    }
    const arrows = this._sortedArrows;
    for (let i = 0; i < arrows.length; i++) this._drawArrow(arrows[i], now, dt);

    // Coins on top of arrows so they're never hidden by a passing line.
    // Drawn before particles so the pickup burst sits on top of any
    // remaining coins.
    if (this.board.coinMap && this.board.coinMap.size > 0) this._drawCoins(now);

    this._drawParticles(dt);

    ctx.restore();
  }

  _drawCoins(now) {
    const ctx = this.ctx;
    const sCell = this.baseScale * this.scale;
    const ox = this.offsetX;
    const oy = this.offsetY;
    const r = Math.max(5, sCell * 0.32);

    // Slow halo pulse (~1Hz) and a faster sparkle pulse (~2Hz).
    const pulse  = 0.5 + 0.5 * Math.sin(now * 0.005);
    const pulse2 = 0.5 + 0.5 * Math.sin(now * 0.010);

    // Coin spin (≈ 1.6s/turn). xScale uses |cos|, FLOOR = 0.42 so the
    // coin never gets so thin you can't read the ¥. Front/back colors
    // alternate to preserve the 3D flip cue.
    const spin = now * 0.0040;

    for (const [k, _n] of this.board.coinMap) {
      const [sx, sy] = k.split(",");
      const gx = parseInt(sx, 10);
      const gy = parseInt(sy, 10);
      const cx = ox + (gx + 0.5) * sCell;
      const cy = oy + (gy + 0.5) * sCell;

      // Per-coin offset so adjacent coins don't sync.
      const seedOff = (gx * 7 + gy * 13) * 0.7;
      const cosSpin = Math.cos(spin + seedOff);
      const xScale = Math.max(0.42, Math.abs(cosSpin));     // never too thin
      const showingBack = cosSpin < 0;

      // ── 1. STAR-BURST RAYS — 8 thin radial light spikes that rotate
      //   slowly and pulse. Drawn FIRST so the coin sits on top and the
      //   rays read as light coming "from" the coin. ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(now * 0.0009 + seedOff);
      const rayLen = r * (2.4 + 0.3 * pulse);
      const rayWidth = r * 0.18;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 8; i++) {
        const phase = (i % 2 === 0) ? pulse : pulse2;
        ctx.save();
        ctx.rotate((i / 8) * Math.PI * 2);
        ctx.globalAlpha = 0.55 + 0.40 * phase;
        // Diamond-shaped ray (4 points): tip-out, fat in the middle,
        // tip-in — looks like a star spike rather than a line.
        const ln = rayLen * (i % 2 === 0 ? 1.0 : 0.65);
        const w  = rayWidth * (i % 2 === 0 ? 1.0 : 0.7);
        const grad = ctx.createLinearGradient(0, 0, ln, 0);
        grad.addColorStop(0,    "rgba(255, 245, 180, 0)");
        grad.addColorStop(0.35, "rgba(255, 230, 140, 0.95)");
        grad.addColorStop(1,    "rgba(255, 220, 110, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ln * 0.5, -w);
        ctx.lineTo(ln, 0);
        ctx.lineTo(ln * 0.5,  w);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // ── 2. RADIAL HALO — bright warm glow under the rays. ──
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.35 * pulse;
      const haloR = r * (2.2 + 0.25 * pulse);
      const halo = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, haloR);
      halo.addColorStop(0,    "rgba(255, 245, 180, 1.0)");
      halo.addColorStop(0.45, "rgba(255, 215, 90, 0.55)");
      halo.addColorStop(1,    "rgba(255, 200, 70, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── 3. COIN DISK — spinning, with crisp edge stroke for clarity ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(xScale, 1);

      // Drop shadow under the coin so it lifts off the maze background.
      ctx.shadowColor = "rgba(160, 100, 0, 0.55)";
      ctx.shadowBlur  = r * 0.8;
      ctx.shadowOffsetY = r * 0.18;

      const c0 = showingBack ? "#fff0a8" : "#fffae0";
      const c1 = showingBack ? "#f0bf3a" : "#ffd454";
      const c2 = showingBack ? "#a87010" : "#c87a14";
      const disk = ctx.createRadialGradient(
        -r * 0.35, -r * 0.45, r * 0.15,
        0, 0, r * 1.05
      );
      disk.addColorStop(0,    c0);
      disk.addColorStop(0.45, c1);
      disk.addColorStop(1,    c2);
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // Reset shadow so the stroke and glyph are crisp (not blurred).
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Outer ring — dark for high contrast against bright halo.
      ctx.strokeStyle = "rgba(95, 55, 0, 0.85)";
      ctx.lineWidth = Math.max(1.2, r * 0.11);
      ctx.stroke();

      // Inner thin ring — adds "minted coin" detail.
      ctx.strokeStyle = "rgba(255, 245, 180, 0.55)";
      ctx.lineWidth = Math.max(0.6, r * 0.06);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();

      // ¥ glyph — ALWAYS visible (dark center + light outline for
      // contrast against any background, even bright pastel paths).
      ctx.font = `900 ${Math.round(r * 1.25)}px -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // White halo behind the glyph for legibility.
      ctx.lineWidth = Math.max(1.5, r * 0.18);
      ctx.strokeStyle = "rgba(255, 250, 220, 0.92)";
      ctx.strokeText("¥", 0, r * 0.05);
      ctx.fillStyle = "rgba(70, 40, 0, 0.95)";
      ctx.fillText("¥", 0, r * 0.05);

      // Specular highlight that sweeps across the face as it spins.
      const specX = Math.sin(spin + seedOff) * r * 0.55;
      const specGrad = ctx.createRadialGradient(specX, -r * 0.25, 0, specX, -r * 0.25, r * 0.6);
      specGrad.addColorStop(0,   "rgba(255, 255, 255, 0.5)");
      specGrad.addColorStop(0.7, "rgba(255, 255, 255, 0.08)");
      specGrad.addColorStop(1,   "rgba(255, 255, 255, 0)");
      ctx.fillStyle = specGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // ── 4. ORBITING SPARKLES — 4 white dots circling the coin ──
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(255, 240, 180, 0.95)";
      ctx.shadowBlur = r * 0.7;
      for (let i = 0; i < 4; i++) {
        const ang = now * 0.0028 + (i * Math.PI / 2) + seedOff;
        const orbR = r * (1.30 + 0.10 * Math.sin(now * 0.004 + i));
        const sxp = cx + Math.cos(ang) * orbR;
        const syp = cy + Math.sin(ang) * orbR * 0.55;
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(ang * 2));
        ctx.beginPath();
        ctx.arc(sxp, syp, Math.max(1.2, r * 0.14), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawPanel() {
    const ctx = this.ctx;
    const s = this.baseScale * this.scale;
    const x0 = this.offsetX, y0 = this.offsetY;
    const w = this.board.cols * s, h = this.board.rows * s;
    const r = 22;
    roundRect(ctx, x0 - 8, y0 - 8, w + 16, h + 16, r);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  _drawArrow(arrow, now, dt) {
    if (arrow.state === STATE.REMOVED) return;

    // Snake-out animation parameter `s` — distance the snake has slid forward
    // along its own path (in cell units). 0 = at rest, N = head fully exited
    // along the path's last cell, > N = entire snake past the head.
    let s = 0;
    let alpha = 1;
    if (arrow.state === STATE.FLYING) {
      const totalSlide = arrow.flyTotalSlide
        || ((arrow.cells.length - 1) + Math.max(this.board.cols, this.board.rows) + 2);
      const duration = arrow.flyDuration;
      const t = (now - arrow.flyStartT) / duration;
      if (t >= 1) {
        arrow.state = STATE.REMOVED;
        return;
      }
      const eased = easeInQuad(t);
      s = totalSlide * eased;
      alpha = Math.max(0, 1 - Math.max(0, (t - 0.65)) * 3);
    }

    let shakeOff = 0;
    let drawColor = arrow.color;
    let strokeBoost = 1;
    if (arrow.state === STATE.SHAKE) {
      const t = (now - arrow.shakeT) / arrow.shakeDuration;
      if (t >= 1) {
        arrow.state = STATE.IDLE;
      } else {
        shakeOff = Math.sin(t * 80) * 5 * (1 - t);
        // Wrong-click visual: hold a bright red for ~70% of the shake, then
        // smoothly fade back to the base color. Also thicken the stroke a
        // little so the flash POPS against the rest of the maze.
        const fade = t < 0.65 ? 0 : (t - 0.65) / 0.35;
        drawColor = lerpHex("#ff1f3a", arrow.color, fade);
        strokeBoost = 1 + 0.7 * (1 - fade);
      }
    }

    const ctx = this.ctx;
    const sCell = this.baseScale * this.scale;
    // Slightly chunkier lines (was 0.10) — fills more of the cell width
    // so dense mazes look densely packed instead of "lots of whitespace".
    const strokeWidth = Math.max(1.4, sCell * 0.13) * strokeBoost;
    const ox = this.offsetX + shakeOff;
    const oy = this.offsetY;

    // Build polyline (in cell space) representing the snake at slide `s`.
    const polyCell = this._snakePolyline(arrow, s);
    if (polyCell.length === 0) return;

    // Head tip extends slightly past the last polyline point in head direction.
    const dir = arrow.headDir;
    const last = polyCell[polyCell.length - 1];
    const tipExt = 0.40;
    const tipCell = { x: last.x + dir.dx * tipExt, y: last.y + dir.dy * tipExt };

    const toScreen = (p) => ({ x: ox + p.x * sCell, y: oy + p.y * sCell });
    const points = polyCell.map(toScreen);
    const tip = toScreen(tipCell);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = drawColor;
    ctx.fillStyle = drawColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Hint glow — gold halo pulsing around the arrow body. Drawn FIRST so
    // the line sits on top, keeping the arrow itself crisply readable.
    // Visibility tuning: line is intentionally much thicker than the
    // arrow stroke, and the duration stretches to ~3.8s so the player
    // has time to scan the board after triggering it.
    if (arrow.hintT > 0 && arrow.state === STATE.IDLE) {
      const ht = (now - arrow.hintT) / arrow.hintDuration;
      if (ht >= 1) {
        arrow.hintT = 0;
      } else {
        // Five pulses across the longer duration — keeps the ~1.4
        // pulses/sec tempo (same feel as the original 3 pulses / 2.2s).
        const pulse = 0.5 + 0.5 * Math.sin(ht * Math.PI * 10);
        // Stay bright for the first 70% then taper, so the hint cue is
        // at full strength while the player is reading the board.
        const fadeOut = Math.max(0, Math.min(1, (1 - ht) / 0.3));
        ctx.save();
        ctx.globalAlpha = alpha * (0.45 + 0.55 * pulse) * fadeOut;
        ctx.strokeStyle = "#ffce3a";
        ctx.shadowColor = "#ffb800";
        ctx.shadowBlur = strokeWidth * (3.5 + 4.5 * pulse);
        ctx.lineWidth = strokeWidth * (4.4 + 2.2 * pulse);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Stroke the body polyline, extending into the arrow tip
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    // Arrowhead triangle at the tip — scales with the (thin) stroke
    const triLen  = strokeWidth * 2.6;
    const triHalf = strokeWidth * 1.85;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(Math.atan2(dir.dy, dir.dx));
    ctx.beginPath();
    ctx.moveTo(strokeWidth * 0.4, 0);
    ctx.lineTo(-triLen, -triHalf);
    ctx.lineTo(-triLen,  triHalf);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  /**
   * Build a snake-out polyline along the arrow's path at slide-distance `s`
   * (in cell units). Each cell of the body is parameterized by arc-length:
   *   tail = 0, ..., head = N. After sliding by `s`, the body occupies
   *   arc-lengths [s, s+N]. For arc-lengths > N, position extends in the
   *   head direction past the original head cell.
   *
   * The polyline goes through the start of the snake, then every integer
   * arc-length within the body (preserving corners), then the snake's end.
   * As s increases the corners pass through and "vanish" off the head.
   */
  _snakePolyline(arrow, s) {
    const cells = arrow.cells;
    const N = cells.length - 1;     // number of segments
    const dir = arrow.headDir;

    const pathPos = (t) => {
      if (t < 0) t = 0;
      if (t < N) {
        const i = Math.floor(t);
        const f = t - i;
        return {
          x: cells[i].x + 0.5 + (cells[i + 1].x - cells[i].x) * f,
          y: cells[i].y + 0.5 + (cells[i + 1].y - cells[i].y) * f,
        };
      }
      const extra = t - N;
      return {
        x: cells[N].x + 0.5 + dir.dx * extra,
        y: cells[N].y + 0.5 + dir.dy * extra,
      };
    };

    const tStart = s;
    const tEnd = s + N;
    const eps = 1e-6;
    const points = [pathPos(tStart)];
    const firstInt = Math.ceil(tStart);
    const lastInt = Math.floor(tEnd);
    for (let i = firstInt; i <= lastInt; i++) {
      if (i > tStart + eps && i < tEnd - eps) points.push(pathPos(i));
    }
    if (tEnd > tStart + eps) points.push(pathPos(tEnd));
    return points;
  }

  _distanceToArrowPolyline(arrow, x, y) {
    const cells = arrow.cells;
    if (!cells || cells.length === 0) return Number.POSITIVE_INFINITY;

    // Polyline through cell centers + a short extension toward head dir,
    // matching the rendered line/tip direction.
    const points = cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
    const head = points[points.length - 1];
    points.push({
      x: head.x + arrow.headDir.dx * 0.40,
      y: head.y + arrow.headDir.dy * 0.40,
    });

    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length - 1; i++) {
      const d = pointSegDist(x, y, points[i], points[i + 1]);
      if (d < best) best = d;
    }
    return best;
  }

  _drawParticles(dt) {
    const ctx = this.ctx;
    // In-place compaction: previously allocated a fresh array every
    // frame even when nothing was alive. The two-pointer sweep keeps
    // particles[0..writeIdx) live and truncates the tail at the end.
    const arr = this.particles;
    const dtSec = dt / 1000;
    let writeIdx = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      p.life += dt;
      if (p.life >= p.ttl) continue;
      p.vy += 600 * dtSec;
      p.x  += p.vx * dtSec;
      p.y  += p.vy * dtSec;
      const alpha = 1 - p.life / p.ttl;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (writeIdx !== i) arr[writeIdx] = p;
      writeIdx++;
    }
    if (writeIdx !== arr.length) arr.length = writeIdx;
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function easeInQuad(t) { return t * t; }

function lerpHex(hexA, hexB, t) {
  const a = parseHex(hexA), b = parseHex(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function parseHex(h) {
  const c = h.replace("#", "");
  return {
    r: parseInt(c.substring(0, 2), 16),
    g: parseInt(c.substring(2, 4), 16),
    b: parseInt(c.substring(4, 6), 16),
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function pointSegDist(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = px - a.x;
  const wy = py - a.y;
  const vv = vx * vx + vy * vy;
  if (vv <= 1e-8) return Math.hypot(px - a.x, py - a.y);
  const t = clamp((wx * vx + wy * vy) / vv, 0, 1);
  const cx = a.x + vx * t;
  const cy = a.y + vy * t;
  return Math.hypot(px - cx, py - cy);
}
