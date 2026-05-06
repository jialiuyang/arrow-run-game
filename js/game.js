import { Board } from "./board.js";
import { STATE } from "./arrow.js";
import { Renderer } from "./renderer.js";
import { InputManager } from "./input.js";
import { UI } from "./ui.js";
import { AudioFx } from "./audio.js";
import { Storage } from "./storage.js";
import { LEVELS, getLevel, getLevelAsync, prefetchLevel, prefetchRange, MAX_LEVEL } from "./levels.js";
import { GAME_CONFIG, COIN_EVENT_CONFIG, ITEM_SHOP_CONFIG } from "./config.js";

/**
 * Main Game controller — orchestrates everything.
 * NO hint system: arrows have a single uniform appearance, players must reason
 * about which arrow's head has a clear path themselves.
 */
export class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.renderer = new Renderer(this.canvas);
    this.ui = new UI();
    this.audio = new AudioFx();
    this.state = Storage.load();
    this.audio.setEnabled(this.state.settings.sfx);

    this.board = null;
    this.currentLevel = this.state.currentLevel;
    this.lives = GAME_CONFIG.DEFAULT_LIVES;
    this.maxLives = GAME_CONFIG.DEFAULT_LIVES;
    this.timeLeft = 0;
    this.timeLimit = 0;
    this.startedAt = 0;
    this.gameOver = false;
    this.paused = false;

    this.comboCount = 0;
    this.lastClearAt = 0;
    this.COMBO_WINDOW = GAME_CONFIG.COMBO_WINDOW_MS;

    // Combo coin economy: 5-combo = +1 coin, 6+ combo = +2 coins per step,
    // capped at MAX_COMBO_COINS_PER_LEVEL per level. Settled at win time.
    this.MAX_COMBO_COINS_PER_LEVEL = GAME_CONFIG.MAX_COMBO_COINS_PER_LEVEL;
    this.comboBonusCoins = 0;
    if (typeof this.state.coins !== "number") this.state.coins = 0;

    // ── Anti-cheat: per-level session token ─────────────────────────
    // Generated fresh in loadLevel(), mandatory at _endWin(). Defeats
    // the "open devtools, type __game._endWin() to claim coins" attack
    // because there's no live session unless a level was actually
    // loaded through the legitimate flow.
    //
    // Hard caps applied at award time even if every other check is
    // somehow bypassed (all tunable via GAME_CONFIG in config.js):
    //   • coinsFromStars   ≤ MAX_STAR_COINS         (= 15)
    //   • comboBonusCoins  ≤ MAX_COMBO_COINS_PER_LEVEL (= 5)
    //   • totalCoinsEarned ≤ HARD_COIN_GRANT_CAP    (= 25, with slack)
    this._session = null;
    this.HARD_COIN_GRANT_CAP = GAME_CONFIG.HARD_COIN_GRANT_CAP;
    this.MIN_LEVEL_PLAY_SEC  = GAME_CONFIG.MIN_LEVEL_PLAY_SEC;

    // Magic-wand item: each level starts with 1, used to instantly remove ANY
    // single arrow regardless of whether its head path is clear.
    this.wandUsesPerLevel = 1;
    this.wandUses = this.wandUsesPerLevel;
    this.wandActive = false;

    // Hint item: each level starts with 1. Briefly highlights one
    // currently-clearable arrow so the player can spot a legal move.
    this.hintUsesPerLevel = 1;
    this.hintUses = this.hintUsesPerLevel;
    this.wandCostCoins = ITEM_SHOP_CONFIG.WAND_COST_COINS;
    this.hintCostCoins = ITEM_SHOP_CONFIG.HINT_COST_COINS;

    this.input = new InputManager(this.canvas, {
      onTap:   (p)         => this._onTap(p),
      onPan:   (dx, dy)    => this.renderer.pan(dx, dy),
      onPinch: (c, factor) => this.renderer.zoomAt(c.x, c.y, factor),
      onWheel: (p, factor) => this.renderer.zoomAt(p.x, p.y, factor),
    });

    this._bindUI();
    this._startLoop();
    this.loadLevel(this.currentLevel);
  }

  /**
   * Switch to a level. Curated levels (1-12) load instantly. Endless
   * levels need a few hundred ms to generate — for those we paint a
   * loading overlay first, then run the generator on the next frame so
   * the UI doesn't appear frozen.
   */
  async loadLevel(idx) {
    if (this._loading) return;        // ignore re-entrant clicks
    // Game is INFINITE — Lv 51 BOSS is a milestone, not the end. After
    // BOSS the level number keeps incrementing and `levelParams` keeps
    // scaling difficulty by the natural formula. We cap at a very large
    // index purely as defensive sanity (matches storage's MAX_LEVEL_INDEX).
    if (idx > 9999) idx = 9999;
    if (idx < 0) idx = 0;
    this.currentLevel = idx;
    this.state.currentLevel = idx;
    Storage.save(this.state);

    // Curated → already in memory, no spinner.
    // Endless → show overlay; getLevelAsync yields one frame so it paints.
    const isEndless = idx >= LEVELS.length;
    let level;
    if (isEndless) {
      this._loading = true;
      this.ui.showLoading("正在生成关卡…");
      try {
        level = await getLevelAsync(idx);
      } finally {
        this.ui.hideLoading();
        this._loading = false;
      }
    } else {
      level = getLevel(idx);
    }

    this.board = Board.fromLevel({
      cols: level.cols, rows: level.rows, arrows: level.arrows,
    });
    this.renderer.setBoard(this.board);

    this.isBossLevel = !!level.isBoss;
    this.lives = level.lives ?? GAME_CONFIG.DEFAULT_LIVES;
    this.maxLives = this.lives;
    this.timeLimit = level.timeLimit ?? GAME_CONFIG.DEFAULT_TIME_LIMIT;
    this.timeLeft = this.timeLimit;
    this.startedAt = performance.now();
    this.gameOver = false;
    this.paused = false;
    this.comboCount = 0;
    this.comboBonusCoins = 0;
    this.wrongCount = 0;
    this.wandUses = this.wandUsesPerLevel;
    this.hintUses = this.hintUsesPerLevel;
    this._setWandActive(false);

    // ── Anti-farming: detect replay so we can suppress one-shot rewards.
    // A "replay" is any run of a level that already has ≥ 1 star recorded
    // (i.e. the player previously cleared it). On replay, we still pay
    // the star-rating UPGRADE delta (so chasing 3★ is meaningful) but we
    // skip combo coins and don't fire random coin events at all.
    // Without this, infinite-replaying an easy level would farm coins.
    this._prevStars = (this.state.stars && this.state.stars[idx]) | 0;
    this._isReplay  = this._prevStars > 0;

    // ── Random coin event setup (colored levels only by default) ────────
    // We pre-roll how many events this level will fire (1 or 2) and how
    // many clears must happen before each. Actual placement is deferred
    // until trigger time so we know which arrows are still on the board.
    this._eventCoinsCollected = 0;
    this._initCoinEvents(level);

    // Anti-cheat session token. Bound to (levelIdx, startTime, random
    // nonce) so coin awards in _endWin can verify they're tied to a
    // legitimately-loaded level, not a console-fabricated game state.
    this._session = {
      levelIdx: idx,
      startedAt: this.startedAt,
      nonce: ((Math.random() * 0x1_0000_0000) >>> 0).toString(36)
           + ((Math.random() * 0x1_0000_0000) >>> 0).toString(36),
      coinsAwarded: false,
    };

    this.ui.setLevel(idx + 1, this.isBossLevel);
    this.ui.setHearts(this.lives, this.maxLives);
    this.ui.setTimer(this.timeLeft);
    this.ui.setWandCount(this.wandUses);
    this.ui.setHintCount(this.hintUses);
    this.ui.hideAll();

    // Pre-warm the next two endless levels during browser idle so "下一关"
    // pops up instantly instead of showing a spinner. Two-deep covers the
    // case where the user blasts through a level quickly.
    prefetchRange(idx + 1, 2);
  }

  /** Boot-time pre-warm: queue the first few endless levels so the
   *  jump from Lv 12 (curated) → Lv 13 (endless) is instant. */
  warmEndlessHorizon() {
    prefetchRange(LEVELS.length, 3);   // idx 12, 13, 14
  }

  restartLevel() { this.loadLevel(this.currentLevel); }
  nextLevel() {
    // Game is infinite — BOSS at Lv 51 is just a milestone. After BOSS
    // we keep advancing into procedurally-generated endless levels
    // (Lv 52, 53, … with steadily climbing difficulty per the formula).
    this.loadLevel(this.currentLevel + 1);
  }

  _startLoop() {
    let last = performance.now();
    let didFirstDraw = false;
    const tick = (now) => {
      const dt = Math.min(48, now - last);
      last = now;
      if (!this.paused && !this.gameOver && this.board) {
        this.timeLeft -= dt / 1000;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this._endLose("time");
        }
        this.ui.setTimer(this.timeLeft);

        if (this.comboCount > 0 && now - this.lastClearAt > this.COMBO_WINDOW) {
          this.comboCount = 0;
        }

        // Animated coin pickups — collect coins as the head's flight
        // animation actually reaches each coin cell.
        this._processCoinPickups(now);

        // Stuck check — no clearable arrow, no animations, no wand left.
        if (!this._anyAnimating() && !this.board.isCleared()) {
          if (!this.board.findClearable() && this.wandUses <= 0) {
            this._endLose("stuck");
          }
        }

        if (this.board.isCleared() && !this._anyAnimating()) {
          this._endWin();
        }
      }
      // Draw skip optimization: when paused (home screen / modal is on top
      // covering the canvas), don't repaint. The draw runs N-log-N over
      // every arrow each frame (~125 arrows on Lv 50) and is pure waste
      // while invisible. We still draw at least ONCE so the canvas isn't
      // blank during the home-screen → game fade-out, and we always draw
      // when an arrow is mid-animation so fly-out frames keep playing
      // even when paused mid-flight.
      const hasAnim = this.board && this._anyAnimating();
      const hasParticles = this.renderer.particles.length > 0;
      const needDraw = !this.paused || !didFirstDraw || hasAnim || hasParticles;
      if (needDraw) {
        this.renderer.draw(now, dt);
        didFirstDraw = true;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _anyAnimating() {
    return this.board.arrows.some(a => a.state === STATE.FLYING || a.state === STATE.SHAKE);
  }

  _onTap(p) {
    if (this.gameOver || this.paused || !this.board) return;
    this.audio.resume();
    const arrow = this.renderer.pickArrow(p.x, p.y, p.pointerType);
    if (!arrow || !arrow.isOnBoard()) return;

    // Wand mode: next tap nukes ANY arrow, no penalty for "wrong" choice.
    if (this.wandActive) {
      this._wandRemove(arrow);
      return;
    }

    if (this.board.isPathClear(arrow)) {
      this._removeArrow(arrow);
    } else {
      this._badClick(arrow);
    }
  }

  _wandRemove(arrow) {
    if (this.wandUses <= 0) return;
    this.wandUses -= 1;
    this.ui.setWandCount(this.wandUses);
    this._setWandActive(false);
    // Treat as a normal removal so the snake-out animation + chain reactions
    // all fire. Spawn an extra magical purple burst for the wand effect.
    const head = arrow.head();
    this.renderer.spawnBurst(head.x + 0.5, head.y + 0.5, "#c89dff", 18);
    const mid = arrow.cells[Math.floor(arrow.cells.length / 2)];
    this.renderer.spawnBurst(mid.x + 0.5, mid.y + 0.5, "#7a3dff", 12);
    this._removeArrow(arrow);
  }

  _setWandActive(active) {
    if (active && this.wandUses <= 0) return;
    this.wandActive = active;
    this.canvas.classList.toggle("wand-mode", active);
    this.ui.toggleWandToast(active);
  }

  /**
   * Hint item: pulse-highlight one currently-clearable arrow for ~2s
   * so the player can spot a legal move. Consumes one hint charge.
   * No-op when no charges left or no clearable arrow exists (which
   * means the level is unsolvable from the current state — wand it).
   */
  _useHint() {
    if (this.gameOver || this.paused) return;
    if (this.hintUses <= 0) { this.audio.err(); return; }
    const arrow = this.board.findClearable();
    if (!arrow) {
      // Nothing legal — refund the charge and play the error tone so
      // the player knows the hint did NOTHING (instead of silently
      // burning a use).
      this.audio.err();
      return;
    }
    this.hintUses -= 1;
    this.ui.setHintCount(this.hintUses);
    arrow.hintT = performance.now();
    this.audio.combo(2);                  // soft chime
    // Tiny gold sparkle at the head to draw the eye.
    const h = arrow.head();
    this.renderer.spawnBurst(h.x + 0.5, h.y + 0.5, "#ffce3a", 12);
  }

  _removeArrow(arrow) {
    const now = performance.now();

    // ── Plan coin pickups BEFORE startFlight ────────────────────────────
    // Coins remain visible on the board; they will be collected one by
    // one as the head's flight animation actually reaches each cell
    // (see `_processCoinPickups` in the main loop). This avoids the
    // "coin vanished the instant I clicked" feel.
    arrow._coinPickups = this._planCoinPickups(arrow);

    this.board.startFlight(arrow, now);
    this.renderer.spawnTrail(arrow, "#1a1a1a");
    const head = arrow.head();
    this.renderer.spawnBurst(head.x + 0.5, head.y + 0.5, "#ffd166", 8);
    this.audio.whoosh(0.85 + Math.random() * 0.3);

    if (now - this.lastClearAt < this.COMBO_WINDOW) this.comboCount += 1;
    else this.comboCount = 1;
    this.lastClearAt = now;
    if (this.comboCount >= 2) {
      this.ui.showCombo(this.comboCount);
      this.audio.combo(this.comboCount);
    }

    // Combo bonus coins (deferred reward, settled in _endWin).
    // Anti-farming: combo coins are a first-clear bonus only. On
    // replay we still show the "N 连击!" toast and play the combo
    // sound for engagement, just don't accumulate any payout.
    if (!this._isReplay) {
      let bonus = 0;
      if (this.comboCount === 5) bonus = 1;
      else if (this.comboCount >= 6) bonus = 2;
      if (bonus > 0) {
        const remaining = this.MAX_COMBO_COINS_PER_LEVEL - this.comboBonusCoins;
        bonus = Math.min(bonus, Math.max(0, remaining));
        if (bonus > 0) {
          this.comboBonusCoins += bonus;
          // Tiny gold burst near the head as a hint that combo coins were earned.
          const h = arrow.head();
          this.renderer.spawnBurst(h.x + 0.5, h.y + 0.5, "#ffd24a", 6 * bonus);
        }
      }
    }

    // After every successful clear, see if a scheduled coin event is
    // due to fire on the board's NEW state.
    this._maybeFireCoinEvent();
  }

  // ── Random coin events ────────────────────────────────────────────────

  /**
   * Pick the right per-event probability schedule for this level.
   * Endless levels (Lv 52+, past the BOSS milestone) use a longer,
   * more generous schedule to compensate for their extra difficulty +
   * runtime. Curated and BOSS use the standard 2-event schedule.
   */
  _coinEventProbs() {
    const isEndless = this.currentLevel >= MAX_LEVEL;     // idx 51 = Lv 52
    const arr = isEndless
      ? COIN_EVENT_CONFIG.EVENT_PROBABILITIES_ENDLESS
      : COIN_EVENT_CONFIG.EVENT_PROBABILITIES;
    return Array.isArray(arr) ? arr : [];
  }

  /** Decide whether this level gets coin events and pre-roll the schedule. */
  _initCoinEvents(level) {
    this._coinEventsRemaining = 0;
    this._clearsCount = 0;
    this._lastEventClearIdx = -Infinity;
    if (!COIN_EVENT_CONFIG.ENABLED) return;
    // Anti-farming: random coin events are a first-clear bonus only.
    // On replay we don't even schedule them — keeps the UX honest
    // (no "coins appeared but the modal said + 0" surprise).
    if (this._isReplay) return;
    const isColored = level.arrows && level.arrows.some(a => a && a.color);
    if (COIN_EVENT_CONFIG.COLORED_LEVELS_ONLY && !isColored) return;

    // Per-event conditional roll. Each entry is the probability the Nth
    // event fires given the (N-1)th did. First failed roll terminates
    // the chain so event counts stay sequential (no "got 3 but not 2").
    const probs = this._coinEventProbs();
    let n = 0;
    for (const raw of probs) {
      const p = Math.min(1, Math.max(0, +raw || 0));
      if (Math.random() < p) n += 1;
      else break;
    }
    this._coinEventsRemaining = n;
  }

  /** Try to fire one pending coin event after a successful clear. */
  _maybeFireCoinEvent() {
    this._clearsCount += 1;
    if (this._coinEventsRemaining <= 0) return;
    const cfg = COIN_EVENT_CONFIG;
    if (this._clearsCount < cfg.MIN_CLEARS_BEFORE_FIRST) return;
    if (this._clearsCount - this._lastEventClearIdx < cfg.MIN_CLEARS_BETWEEN) return;

    // Pick a candidate arrow with at least 1 empty cell on its head's
    // flight path. Prefer arrows that are CURRENTLY BLOCKED (so the
    // coin sits there for a while and the player has to "earn" it by
    // clearing the blockers first).
    const candidates = [];
    const blockedCandidates = [];
    for (const a of this.board.arrows) {
      if (!a.isOnBoard()) continue;
      const empties = this.board.emptyHeadPathCells(a);
      if (empties.length === 0) continue;
      // Skip if any of the empty cells already hold a coin (avoid stack).
      const free = empties.filter(c => !this.board.hasCoinAt(c.x, c.y));
      if (free.length === 0) continue;
      const entry = { arrow: a, free };
      candidates.push(entry);
      if (!this.board.isPathClear(a)) blockedCandidates.push(entry);
    }
    const pool = (cfg.PREFER_BLOCKED_ARROWS && blockedCandidates.length > 0)
      ? blockedCandidates
      : candidates;
    if (pool.length === 0) return;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const minN = Math.max(1, cfg.MIN_COINS_PER_EVENT | 0);
    const maxN = Math.max(minN, cfg.MAX_COINS_PER_EVENT | 0);
    const wantN = Math.min(
      pick.free.length,
      minN + Math.floor(Math.random() * (maxN - minN + 1))
    );

    // Place coins on `wantN` random empty cells from the free list.
    // Use a partial Fisher-Yates shuffle so cells don't cluster at the
    // start of the array.
    const arr = pick.free.slice();
    for (let i = 0; i < wantN; i++) {
      const j = i + Math.floor(Math.random() * (arr.length - i));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.board.placeCoinsAt(arr.slice(0, wantN));

    this._coinEventsRemaining -= 1;
    this._lastEventClearIdx = this._clearsCount;
    // Subtle audio cue so the player notices new coins appearing even if
    // they're scrolled to a different region of the maze.
    this.audio.combo(3);
  }

  /**
   * Snapshot the coins currently on this arrow's head-flight path and
   * compute the slide distance `k` at which the head will reach each
   * coin. Coins are NOT removed from the board here — see
   * `_processCoinPickups` for the actual pickup as the animation plays.
   */
  _planCoinPickups(arrow) {
    if (!this.board || this.board.coinMap.size === 0) return [];
    const head = arrow.head();
    const dir = arrow.headDir;
    const out = [];
    let k = 1;
    let x = head.x + dir.dx, y = head.y + dir.dy;
    while (this.board.inBounds(x, y)) {
      if (this.board.hasCoinAt(x, y)) {
        out.push({ x, y, k, picked: false });
      }
      x += dir.dx; y += dir.dy;
      k += 1;
    }
    return out;
  }

  /**
   * Per-frame check: for each FLYING arrow with a coin pickup plan,
   * compute the head's current slide distance and trigger pickups whose
   * slide threshold has been reached. Each pickup plays the coin chime,
   * spawns a particle burst, removes the coin from the board (so the
   * renderer stops drawing it), and adds 1 to the session coin count.
   */
  _processCoinPickups(now) {
    const arrows = this.board.arrows;
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i];
      if (a.state !== STATE.FLYING) continue;
      const plan = a._coinPickups;
      if (!plan || plan.length === 0) continue;
      const totalSlide = a.flyTotalSlide
        || ((a.cells.length - 1) + Math.max(this.board.cols, this.board.rows) + 2);
      const t = (now - a.flyStartT) / a.flyDuration;
      if (t <= 0) continue;
      // Same easing as the renderer (easeInQuad: t * t).
      const s = totalSlide * t * t;
      for (let j = 0; j < plan.length; j++) {
        const p = plan[j];
        if (p.picked) continue;
        if (s + 1e-3 < p.k) continue;       // head hasn't reached this cell yet
        // Pop it. Even if the player closes the level mid-animation,
        // the coin counter has already been added — that's fine because
        // _endWin's hard caps still clamp the total.
        p.picked = true;
        this.board.coinMap.delete(`${p.x},${p.y}`);
        this._eventCoinsCollected += 1;
        // Pass `j` as the melody index so consecutive pickups arpeggiate
        // up the pentatonic scale (ding-ding-ding rising).
        this.audio.coin(1, j);
        this.renderer.spawnBurst(p.x + 0.5, p.y + 0.5, "#ffd24a", 16);
      }
    }
  }

  _badClick(arrow) {
    arrow.state = STATE.SHAKE;
    arrow.shakeT = performance.now();
    this.audio.err();
    // Red burst at the head and along the body for clear "blocked!" feedback
    const head = arrow.head();
    this.renderer.spawnBurst(head.x + 0.5, head.y + 0.5, "#ff2d3d", 14);
    const mid = arrow.cells[Math.floor(arrow.cells.length / 2)];
    this.renderer.spawnBurst(mid.x + 0.5, mid.y + 0.5, "#ff5063", 8);
    this.lives = Math.max(0, this.lives - 1);
    this.ui.setHearts(this.lives, this.maxLives);
    this.ui.pulseLastHeart();

    // Wrong-click time penalty.
    //   • Lv 1–51 (curated + BOSS): 1st wrong = max(20s, timeLeft/2);
    //                                2nd+    = flat 20s
    //   • Lv 52+ (endless):          NO time penalty — player only loses
    //                                a heart. The endless ramp already
    //                                punishes hard via raw difficulty;
    //                                doubling that with time penalties
    //                                made deep runs feel unwinnable.
    this.wrongCount = (this.wrongCount || 0) + 1;
    const isEndless = this.currentLevel >= MAX_LEVEL;
    if (!isEndless) {
      const penalty = this.wrongCount === 1
        ? Math.max(20, Math.floor(this.timeLeft / 2))
        : 20;
      this.timeLeft = Math.max(0, this.timeLeft - penalty);
      this.ui.setTimer(this.timeLeft);
      this.ui.flashTimerPenalty(penalty);
    }

    if (this.state.settings.vibrate && navigator.vibrate) navigator.vibrate(60);

    if (this.lives <= 0) {
      setTimeout(() => this._endLose("hearts"), 400);
    } else if (this.timeLeft <= 0) {
      setTimeout(() => this._endLose("time"), 200);
    }
  }

  /**
   * Validate the win-event preconditions. Returns true iff this is a
   * legitimate clear that earns coins. Used to slam the door on:
   *   • `__game._endWin()` typed into devtools without an actual win
   *   • _endWin called twice for the same session (double-grant)
   *   • Wins claimed in <1s of play (timer/clock tampering)
   *   • Wins claimed while the board still has un-cleared arrows
   *   • Wins claimed while arrows are still in mid-flight animation
   */
  _validWinSession() {
    if (!this._session) return false;
    if (this._session.coinsAwarded) return false;
    if (this._session.levelIdx !== this.currentLevel) return false;
    if (!this.board || !this.board.isCleared()) return false;
    if (this._anyAnimating()) return false;
    const playElapsed = this.timeLimit - this.timeLeft;
    if (!Number.isFinite(playElapsed)) return false;
    if (playElapsed < this.MIN_LEVEL_PLAY_SEC) return false;
    if (this.timeLeft < 0) return false;
    return true;
  }

  _endWin() {
    if (this.gameOver) return;

    // Anti-cheat gate. Refuse to advance state at all if the session
    // doesn't pass validation — this keeps the level replayable for a
    // legit player whose board really IS cleared, but neutralizes
    // direct console invocations that lack a real session.
    if (!this._validWinSession()) return;

    this.gameOver = true;
    this._session.coinsAwarded = true;            // single-grant lock

    const elapsed = (performance.now() - this.startedAt) / 1000;
    // Star rating — hearts-based only (time already serves as a hard
    // fail condition; no need to also penalize a slow win).
    //   3★ = no mistakes  (lives === maxLives)
    //   2★ = ≤ 1 mistake  (lives === maxLives - 1)
    //   1★ = ≥ 2 mistakes (anything below; you still won)
    // For boss / single-life modes (maxLives = 1) only 3★ is reachable
    // since surviving means perfect.
    let stars = 1;
    if (this.lives === this.maxLives) stars = 3;
    else if (this.lives >= this.maxLives - 1) stars = 2;
    stars = Math.max(1, Math.min(3, stars | 0));
    const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
    const timeStr = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;

    const prev = this.state.stars[this.currentLevel] || 0;
    this.state.stars[this.currentLevel] = Math.max(prev, stars);
    this.state.maxUnlocked = Math.max(this.state.maxUnlocked, this.currentLevel + 1);
    if (!this.state.bestTimes) this.state.bestTimes = {};
    const prevBest = this.state.bestTimes[this.currentLevel];
    if (!prevBest || elapsed < prevBest) this.state.bestTimes[this.currentLevel] = elapsed;

    // ── Coin reward ──────────────────────────────────────────────────
    // Anti-farming policy:
    //   • Star coins  = ONLY the upgrade delta over the previous best.
    //                   First clear at 2★ → 10. Replay at 3★ → +5 more.
    //                   Replay that doesn't beat your best → 0.
    //   • Combo coins = first clear ONLY. Replays show toasts but
    //                   accumulate no payout (enforced in _handleClear,
    //                   double-checked here as defense in depth).
    //   • Event coins = first clear ONLY. Replays don't even trigger
    //                   the events (enforced in _initCoinEvents,
    //                   double-checked here).
    //
    // Without these rules, repeatedly clicking "重玩" on an easy level
    // would farm coins indefinitely.
    const starGain = Math.max(0, stars - prev);   // 0 if already at or above
    const coinsFromStars = Math.max(0, Math.min(
      GAME_CONFIG.MAX_STAR_COINS,
      starGain * GAME_CONFIG.COINS_PER_STAR
    ));
    const comboBonus = this._isReplay ? 0
      : Math.max(0, Math.min(this.MAX_COMBO_COINS_PER_LEVEL, this.comboBonusCoins | 0));
    // Use the SAME schedule the level was initialized with (curated vs
    // endless), so the event-coin clamp matches the actual ceiling.
    const maxEvents = this._coinEventProbs().length;
    const maxEventCoins = (COIN_EVENT_CONFIG.MAX_COINS_PER_EVENT | 0) * maxEvents;
    const eventCoins = this._isReplay ? 0
      : Math.max(0, Math.min(maxEventCoins, this._eventCoinsCollected | 0));
    let totalCoinsEarned = coinsFromStars + comboBonus + eventCoins;
    if (totalCoinsEarned > this.HARD_COIN_GRANT_CAP) totalCoinsEarned = this.HARD_COIN_GRANT_CAP;
    if (totalCoinsEarned < 0) totalCoinsEarned = 0;

    if (typeof this.state.coins !== "number") this.state.coins = 0;
    this.state.coins += totalCoinsEarned;
    Storage.save(this.state);                     // sanitizes + signs

    this.audio.win();
    setTimeout(() => this.ui.showWin({
      stars, timeStr, heartsLeft: this.lives,
      coinsFromStars, comboBonus, eventCoins, totalCoinsEarned,
      coinsTotal: this.state.coins,
      isBoss: this.isBossLevel,
    }), 600);
  }

  _endLose(reason) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.audio.lose();
    setTimeout(() => this.ui.showLose({ reason }), 400);
  }

  _bindUI() {
    document.getElementById("settingsBtn").addEventListener("click", () => {
      this.paused = true;
      this.ui.dom.sfxToggle.checked = this.state.settings.sfx;
      this.ui.dom.vibrateToggle.checked = this.state.settings.vibrate;
      this.ui.showSettings();
    });
    document.getElementById("settingsClose").addEventListener("click", () => {
      this.state.settings.sfx = this.ui.dom.sfxToggle.checked;
      this.state.settings.vibrate = this.ui.dom.vibrateToggle.checked;
      this.audio.setEnabled(this.state.settings.sfx);
      Storage.save(this.state);
      this.ui.hideAll();
      this.paused = false;
    });

    document.getElementById("hintBtn").addEventListener("click", () => {
      if (this.gameOver || this.paused) return;
      if (!this._ensureHintCharge()) return;
      this._useHint();
    });
    document.getElementById("levelSelectBtn").addEventListener("click", () => this._openLevelSelect());
    document.getElementById("wandBtn").addEventListener("click", () => {
      if (this.gameOver || this.paused) return;
      if (!this._ensureWandCharge()) return;
      this._setWandActive(!this.wandActive);
    });

    document.getElementById("winReplay").addEventListener("click", () => this.restartLevel());
    document.getElementById("winNext").addEventListener("click", () => this.nextLevel());

    document.getElementById("loseRetry").addEventListener("click", () => this.restartLevel());
    document.getElementById("loseHome").addEventListener("click", () => this._openLevelSelect());

    document.getElementById("levelClose").addEventListener("click", () => this._closeOverlays());

    document.getElementById("homeClose").addEventListener("click", () => this._closeOverlays());
    document.getElementById("homeRankBtn").addEventListener("click", () => this._openLeaderboard());
    // 排行榜的"返回"统一回到主页/上一层（直接关闭遮罩即可）。
    // 主页屏可见时 pauseGuard 会自动把 paused 拉回 true，不会误恢复游戏。
    document.getElementById("rankClose").addEventListener("click", () => this._closeOverlays());

    document.getElementById("confirmCancel").addEventListener("click", () => this._closeOverlays());
  }

  _closeOverlays() {
    this.ui.hideAll();
    this.paused = false;
  }

  _openLevelSelect() {
    this.paused = true;
    const progress = {
      currentLevel: this.currentLevel,
      maxUnlocked: this.state.maxUnlocked,
      stars: this.state.stars,
    };
    // bossIdx = 50  →  level 51 (BOSS milestone). The grid grows past
    // BOSS automatically as the player unlocks endless levels.
    this.ui.showLevelSelect(progress, MAX_LEVEL - 1, (i) => {
      if (i === this.currentLevel && !this.gameOver) {
        this.ui.showConfirm("重玩本关？", "本关进度将重置，已通关的星星不会丢失", () => {
          this._closeOverlays();
          this.restartLevel();
        });
      } else {
        this._closeOverlays();
        this.loadLevel(i);
      }
    });
  }

  _openHome() {
    this.paused = true;
    this.ui.showHome();
  }

  _openLeaderboard() {
    this.paused = true;
    // Show all levels up to (and including) wherever the player has been.
    // Always show at least up to the BOSS row even for early players.
    const rowCount = Math.max(MAX_LEVEL, (this.state.maxUnlocked | 0) + 1);
    const rows = [];
    for (let i = 0; i < rowCount; i++) {
      const stars = this.state.stars[i] || 0;
      const best = (this.state.bestTimes && this.state.bestTimes[i]) || null;
      let name;
      if (i < LEVELS.length) name = LEVELS[i].name;
      else if (i === MAX_LEVEL - 1) name = "无限轮回";
      else name = `无尽第${i - LEVELS.length + 1}层`;
      rows.push({ idx: i, name, stars, best, isBoss: i === MAX_LEVEL - 1 });
    }
    const totalStars = rows.reduce((s, r) => s + r.stars, 0);
    const cleared = rows.filter(r => r.stars > 0).length;
    // Cleared count out of "current frontier" (not infinity) so the
    // ratio reads sensibly. After BOSS the denominator keeps growing.
    this.ui.showLeaderboard({
      rows,
      summary: `已通关 ${cleared} / ${rowCount} 关，共 ${totalStars} 颗星`,
    });
  }

  _spendCoins(amount) {
    const cost = Math.max(0, Math.floor(amount || 0));
    if (cost <= 0) return true;
    if (typeof this.state.coins !== "number") this.state.coins = 0;
    if (this.state.coins < cost) return false;
    this.state.coins -= cost;
    Storage.save(this.state);
    return true;
  }

  _ensureWandCharge() {
    if (this.wandUses > 0) return true;
    if (!this._spendCoins(this.wandCostCoins)) {
      this.audio.err();
      return false;
    }
    this.wandUses += 1;
    this.ui.setWandCount(this.wandUses);
    this.audio.coin(1, 0);
    return true;
  }

  _ensureHintCharge() {
    if (this.hintUses > 0) return true;
    if (!this._spendCoins(this.hintCostCoins)) {
      this.audio.err();
      return false;
    }
    this.hintUses += 1;
    this.ui.setHintCount(this.hintUses);
    this.audio.coin(1, 0);
    return true;
  }
}
