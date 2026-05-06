/**
 * Unified input manager — supports both touch and mouse.
 *
 * Gesture disambiguation (per requirements doc):
 *   - 1 finger, moved < TAP_DIST and held < TAP_TIME  → "tap"
 *   - 1 finger, moved >= TAP_DIST                      → "pan"
 *   - 2 fingers                                        → "pinch" (zoom + pan)
 *
 * Emits high-level events via callbacks.
 */
import { INPUT_CONFIG } from "./config.js";

const TAP_DIST = INPUT_CONFIG.TAP_DIST_PX;     // px
const TAP_TIME = INPUT_CONFIG.TAP_TIME_MS;     // ms

export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onTap:(p)=>void, onPan:(dx,dy)=>void, onPinch:(center,factor)=>void, onWheel:(p,factor)=>void}} handlers
   */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.handlers = handlers;

    this.activePointers = new Map(); // pointerId -> { x, y, startX, startY, startT }
    this.mode = "idle"; // 'idle' | 'tap' | 'pan' | 'pinch'
    this.lastPinchDist = 0;
    this.lastPinchCenter = null;

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    // Use Pointer Events (handles touch + mouse + pen uniformly)
    c.addEventListener("pointerdown", (e) => this._down(e));
    c.addEventListener("pointermove", (e) => this._move(e));
    c.addEventListener("pointerup",   (e) => this._up(e));
    c.addEventListener("pointercancel", (e) => this._up(e));
    c.addEventListener("pointerleave", (e) => this._up(e));

    // Mouse wheel zoom on desktop
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this._screenPos(e);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.handlers.onWheel?.(p, factor);
    }, { passive: false });

    // Prevent native scroll/zoom on mobile
    c.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    c.addEventListener("touchmove",  (e) => e.preventDefault(), { passive: false });
  }

  _screenPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this._screenPos(e);
    this.activePointers.set(e.pointerId, {
      x: p.x, y: p.y,
      startX: p.x, startY: p.y,
      startT: performance.now(),
      pointerType: e.pointerType || "mouse",
    });

    if (this.activePointers.size === 1) {
      this.mode = "tap";
    } else if (this.activePointers.size === 2) {
      this.mode = "pinch";
      const [a, b] = [...this.activePointers.values()];
      this.lastPinchDist = dist(a, b);
      this.lastPinchCenter = midpoint(a, b);
    }
  }

  _move(e) {
    if (!this.activePointers.has(e.pointerId)) return;
    const p = this._screenPos(e);
    const ptr = this.activePointers.get(e.pointerId);
    const prev = { x: ptr.x, y: ptr.y };
    ptr.x = p.x; ptr.y = p.y;

    if (this.mode === "tap" && this.activePointers.size === 1) {
      const moved = Math.hypot(p.x - ptr.startX, p.y - ptr.startY);
      if (moved >= TAP_DIST) {
        this.mode = "pan";
        // Emit any accumulated delta
        this.handlers.onPan?.(p.x - prev.x, p.y - prev.y);
      }
    } else if (this.mode === "pan" && this.activePointers.size === 1) {
      this.handlers.onPan?.(p.x - prev.x, p.y - prev.y);
    } else if (this.mode === "pinch" && this.activePointers.size >= 2) {
      const [a, b] = [...this.activePointers.values()];
      const newDist = dist(a, b);
      const newCenter = midpoint(a, b);
      if (this.lastPinchDist > 0) {
        const factor = newDist / this.lastPinchDist;
        this.handlers.onPinch?.(newCenter, factor);
        // Two-finger pan = also drag the center
        if (this.lastPinchCenter) {
          const dx = newCenter.x - this.lastPinchCenter.x;
          const dy = newCenter.y - this.lastPinchCenter.y;
          this.handlers.onPan?.(dx, dy);
        }
      }
      this.lastPinchDist = newDist;
      this.lastPinchCenter = newCenter;
    }
  }

  _up(e) {
    if (!this.activePointers.has(e.pointerId)) return;
    const ptr = this.activePointers.get(e.pointerId);
    const dt = performance.now() - ptr.startT;
    const moved = Math.hypot(ptr.x - ptr.startX, ptr.y - ptr.startY);

    this.activePointers.delete(e.pointerId);

    if (this.mode === "tap" && moved < TAP_DIST && dt < TAP_TIME) {
      this.handlers.onTap?.({
        x: ptr.x,
        y: ptr.y,
        pointerType: ptr.pointerType || "mouse",
      });
    }

    if (this.activePointers.size === 0) {
      this.mode = "idle";
      this.lastPinchDist = 0;
      this.lastPinchCenter = null;
    } else if (this.activePointers.size === 1) {
      // Demote pinch back to pan with the remaining finger
      this.mode = "pan";
      this.lastPinchDist = 0;
      this.lastPinchCenter = null;
    }
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
