/**
 * Lightweight procedural audio using WebAudio API.
 * No external sound files needed — all SFX are synthesized.
 */
export class AudioFx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  _ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
  }

  setEnabled(v) { this.enabled = !!v; }

  /** Resume context (must be from a user gesture). */
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  /** A short whoosh — used when an arrow flies off. */
  whoosh(pitch = 1) {
    if (!this.enabled) return;
    this._ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 600 * pitch;
    filter.Q.value = 0.7;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** Negative blip — wrong click. */
  err() {
    if (!this.enabled) return;
    this._ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** Win fanfare. */
  win() {
    if (!this.enabled) return;
    this._ensure(); if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /** Sad descending tone. */
  lose() {
    if (!this.enabled) return;
    this._ensure(); if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    [440, 370, 311, 261].forEach((f, i) => {
      const t = t0 + i * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  /**
   * Coin pickup — Mario-style 8-bit "boop-ding".
   * Two square-wave chips with a low-pass smooth:
   *
   *   • Chip 1: B5 (≈988 Hz), 60 ms — the short upbeat "boop".
   *   • Chip 2: E6 (≈1319 Hz), 320 ms, starts 70 ms after chip 1 — the
   *            long sustained "ding" a perfect fourth above.
   *
   * The lowpass at 6 kHz takes the buzzy edge off the square so it
   * sounds retro-game cute, not harsh.
   *
   * NOTE: The iconic Mario coin is intentionally identical every time
   * it plays. We honor that by ignoring `melodyIndex` — chains of coin
   * pickups feel like classic chip-tune coin runs (5 in a row → the
   * familiar "boop-ding · boop-ding · boop-ding…" rhythm). If you ever
   * want chain variety, transpose by `melodyIndex` semitones here.
   *
   * @param {number} n            reserved (always 1 in current flow)
   * @param {number} melodyIndex  reserved — currently unused (see above)
   */
  // eslint-disable-next-line no-unused-vars
  coin(n = 1, melodyIndex = 0) {
    if (!this.enabled) return;
    this._ensure(); if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const chip = (tt, freq, dur, peak) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6000;        // tame the buzz of a raw square
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(peak, tt + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      osc.connect(lp).connect(g).connect(this.master);
      osc.start(tt);
      osc.stop(tt + dur + 0.02);
    };

    chip(t,         987.77, 0.06, 0.18);   // B5  — short upbeat
    chip(t + 0.07, 1318.51, 0.32, 0.18);   // E6  — sustained ding
  }

  /** Combo tick — rising pitch as combo grows. */
  combo(n) {
    if (!this.enabled) return;
    this._ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    const base = 660;
    osc.frequency.value = base + Math.min(n, 12) * 80;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}
