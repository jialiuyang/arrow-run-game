/**
 * UI manager — wraps DOM HUD and modal interactions.
 */
const HEART_SVG = `<svg class="heart" viewBox="0 0 24 24"><path fill="#ff5e7a" d="M12 21s-7.5-4.6-9.6-9.1C.7 8.1 3.5 4 7.4 4c2 0 3.6 1 4.6 2.4C13 5 14.6 4 16.6 4c3.9 0 6.7 4.1 5 7.9C19.5 16.4 12 21 12 21z"/></svg>`;

export class UI {
  constructor() {
    this.dom = {
      levelNum:   document.getElementById("levelNum"),
      levelTitle: document.getElementById("levelTitle"),
      hearts:     document.getElementById("hearts"),
      timerText:  document.getElementById("timerText"),
      timer:      document.querySelector(".timer"),
      modalMask:  document.getElementById("modalMask"),
      winModal:   document.getElementById("winModal"),
      loseModal:  document.getElementById("loseModal"),
      settingsModal: document.getElementById("settingsModal"),
      levelModal: document.getElementById("levelModal"),
      winStars:   document.getElementById("winStars"),
      winTime:    document.getElementById("winTime"),
      winHearts:  document.getElementById("winHearts"),
      winCoinsStars:  document.getElementById("winCoinsStars"),
      winCoinsCombo:  document.getElementById("winCoinsCombo"),
      winCoinsEvent:  document.getElementById("winCoinsEvent"),
      winCoinsTotal:  document.getElementById("winCoinsTotal"),
      winStarsRow:    document.getElementById("winStarsRow"),
      winComboRow:    document.getElementById("winComboRow"),
      winEventRow:    document.getElementById("winEventRow"),
      winTotalRow:    document.getElementById("winTotalRow"),
      helpModal:      document.getElementById("helpModal"),
      loseTitle:  document.getElementById("loseTitle"),
      loseSub:    document.getElementById("loseSub"),
      comboToast: document.getElementById("comboToast"),
      comboCount: document.getElementById("comboCount"),
      levelGrid:  document.getElementById("levelGrid"),
      sfxToggle:  document.getElementById("sfxToggle"),
      vibrateToggle: document.getElementById("vibrateToggle"),
      wandBadge:  document.getElementById("wandBadge"),
      wandBtn:    document.getElementById("wandBtn"),
      hintBadge:  document.getElementById("hintBadge"),
      hintBtn:    document.getElementById("hintBtn"),
      homeModal:  document.getElementById("homeModal"),
      rankModal:  document.getElementById("rankModal"),
      rankList:   document.getElementById("rankList"),
      rankSummary:document.getElementById("rankSummary"),
      confirmModal:   document.getElementById("confirmModal"),
      confirmTitle:   document.getElementById("confirmTitle"),
      confirmSub:     document.getElementById("confirmSub"),
      confirmOk:      document.getElementById("confirmOk"),
    };
    this._wandToast = null;
    this._confirmHandler = null;
    this.dom.confirmOk.addEventListener("click", () => {
      const fn = this._confirmHandler;
      this._confirmHandler = null;
      if (fn) fn();
    });
  }

  setLevel(n, isBoss = false) {
    this.dom.levelNum.textContent = String(n);
    if (this.dom.levelTitle) {
      this.dom.levelTitle.classList.toggle("boss", !!isBoss);
      if (isBoss) {
        this.dom.levelTitle.innerHTML = `<span class="boss-tag">BOSS</span> 无限轮回`;
      } else {
        this.dom.levelTitle.innerHTML = `第 <span id="levelNum">${n}</span> 关`;
        this.dom.levelNum = document.getElementById("levelNum");
      }
    }
  }

  setHearts(current, max) {
    this.dom.hearts.innerHTML = "";
    for (let i = 0; i < max; i++) {
      const span = document.createElement("span");
      span.className = "heart" + (i >= current ? " lost" : "");
      span.innerHTML = HEART_SVG;
      this.dom.hearts.appendChild(span);
    }
  }

  pulseLastHeart() {
    const all = this.dom.hearts.querySelectorAll(".heart:not(.lost)");
    const last = all[all.length - 1];
    if (last) {
      last.classList.add("pulse");
      setTimeout(() => last.classList.remove("pulse"), 400);
    }
  }

  setTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this.dom.timerText.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    this.dom.timer.classList.toggle("warn", seconds <= 10);
  }

  flashTimerPenalty(seconds) {
    // Pop a "-20s" badge below the timer to make the deduction obvious.
    let badge = document.getElementById("timerPenalty");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "timerPenalty";
      badge.className = "timer-penalty";
      // Position relative to the .timer pill so it always lines up
      this.dom.timer.style.position = "relative";
      this.dom.timer.appendChild(badge);
    }
    badge.textContent = `−${seconds}s`;
    badge.classList.remove("show");
    void badge.offsetWidth;
    badge.classList.add("show");
    this.dom.timer.classList.add("penalty-flash");
    setTimeout(() => this.dom.timer.classList.remove("penalty-flash"), 600);
  }

  showCombo(n) {
    if (n < 2) return;
    this.dom.comboCount.textContent = n;
    this.dom.comboToast.classList.remove("show");
    void this.dom.comboToast.offsetWidth;
    this.dom.comboToast.classList.add("show");
  }

  setWandCount(n) {
    this.dom.wandBadge.textContent = String(n);
    this.dom.wandBadge.classList.toggle("zero", n <= 0);
    // Keep the button clickable at 0 so Game can trigger coin exchange.
    this.dom.wandBtn.disabled = false;
    // "ready" pulse only animates while there's at least one charge left
    this.dom.wandBtn.classList.toggle("ready", n > 0);
    if (n <= 0) this.dom.wandBtn.classList.remove("armed");
  }

  setHintCount(n) {
    if (!this.dom.hintBadge) return;
    this.dom.hintBadge.textContent = String(n);
    this.dom.hintBadge.classList.toggle("zero", n <= 0);
    // Keep the button clickable at 0 so Game can trigger coin exchange.
    this.dom.hintBtn.disabled = false;
    this.dom.hintBtn.classList.toggle("ready", n > 0);
  }

  toggleWandToast(show) {
    if (!this._wandToast) {
      const div = document.createElement("div");
      div.className = "wand-toast";
      div.textContent = "✨ 选一个箭头消除（任意一个）";
      document.querySelector(".stage").appendChild(div);
      this._wandToast = div;
    }
    this._wandToast.classList.toggle("show", !!show);
    // Visually mark the wand button as armed (warm orange) while active
    this.dom.wandBtn.classList.toggle("armed", !!show);
  }

  // ----- Modals -----
  _showMask() { this.dom.modalMask.classList.remove("hidden"); }
  _hideMask() { this.dom.modalMask.classList.add("hidden"); }
  _hideAllModals() {
    [
      this.dom.winModal, this.dom.loseModal, this.dom.settingsModal,
      this.dom.levelModal, this.dom.homeModal, this.dom.rankModal,
      this.dom.confirmModal, this.dom.helpModal,
    ].forEach(m => m && m.classList.add("hidden"));
  }

  showWin({ stars, timeStr, heartsLeft, coinsFromStars = 0, comboBonus = 0, eventCoins = 0, totalCoinsEarned = 0, isBoss = false }) {
    this._hideAllModals();
    const stStars = this.dom.winStars.querySelectorAll(".star");
    stStars.forEach((s, i) => s.classList.toggle("lit", i < stars));
    this.dom.winTime.textContent = timeStr;
    this.dom.winHearts.textContent = heartsLeft;
    if (this.dom.winCoinsStars) this.dom.winCoinsStars.textContent = String(coinsFromStars);
    if (this.dom.winCoinsCombo) this.dom.winCoinsCombo.textContent = String(comboBonus);
    if (this.dom.winCoinsEvent) this.dom.winCoinsEvent.textContent = String(eventCoins);
    if (this.dom.winCoinsTotal) this.dom.winCoinsTotal.textContent = String(totalCoinsEarned);
    // Hide rows that paid 0 (CSS rule `.coin-row.zero { display: none }`).
    if (this.dom.winStarsRow) this.dom.winStarsRow.classList.toggle("zero", coinsFromStars <= 0);
    if (this.dom.winComboRow) this.dom.winComboRow.classList.toggle("zero", comboBonus    <= 0);
    if (this.dom.winEventRow) this.dom.winEventRow.classList.toggle("zero", eventCoins    <= 0);
    if (this.dom.winTotalRow) this.dom.winTotalRow.classList.toggle("zero", totalCoinsEarned <= 0);

    // BOSS gets a special title; otherwise the normal "完成！". The game
    // is infinite — even after BOSS the player continues into endless
    // levels, so "下一关" is always shown.
    const titleEl = this.dom.winModal.querySelector("h2");
    const nextBtn = document.getElementById("winNext");
    this.dom.winModal.classList.toggle("final", !!isBoss);
    if (titleEl) titleEl.textContent = isBoss ? "击败 BOSS！" : "关卡完成！";
    if (nextBtn) nextBtn.style.display = "";
    this.dom.winModal.classList.remove("hidden");
    this._showMask();
  }

  showHelp() {
    this._hideAllModals();
    this.dom.helpModal.classList.remove("hidden");
    this._showMask();
  }

  showLose({ reason }) {
    this._hideAllModals();
    if (reason === "time") {
      this.dom.loseTitle.textContent = "时间到！";
      this.dom.loseSub.textContent = "再快一点试试看～";
    } else if (reason === "stuck") {
      this.dom.loseTitle.textContent = "陷入困局";
      this.dom.loseSub.textContent = "没有可消除的箭头了";
    } else {
      this.dom.loseTitle.textContent = "挑战失败";
      this.dom.loseSub.textContent = "心碎光啦，再来一次！";
    }
    this.dom.loseModal.classList.remove("hidden");
    this._showMask();
  }

  showSettings() {
    this._hideAllModals();
    this.dom.settingsModal.classList.remove("hidden");
    this._showMask();
  }

  /**
   * @param {{currentLevel:number, maxUnlocked:number, stars:object}} progress
   * @param {number} bossIdx  index of the BOSS milestone level (0-based,
   *                          e.g. 50 for Lv 51). The grid grows past
   *                          this index naturally as endless levels
   *                          unlock — the game is no longer finite.
   * @param {(i:number)=>void} onPick
   */
  showLevelSelect(progress, bossIdx, onPick) {
    this._hideAllModals();
    this.dom.levelGrid.innerHTML = "";
    // Show all unlocked levels + 3 locked placeholders ahead. After the
    // BOSS, this keeps growing — no upper cap.
    const LOCKED_AHEAD = 3;
    const maxToShow = progress.maxUnlocked + 1 + LOCKED_AHEAD;
    for (let i = 0; i < maxToShow; i++) {
      const btn = document.createElement("button");
      const stars = progress.stars[i] || 0;
      const isUnlocked = i <= progress.maxUnlocked;
      const isCurrent = i === progress.currentLevel;
      const isBoss = (i === bossIdx);
      const cls = ["level-cell"];
      if (!isUnlocked) cls.push("locked");
      else if (stars > 0) cls.push("completed");
      else cls.push("unlocked");
      if (isCurrent) cls.push("current");
      if (isBoss) cls.push("boss");
      btn.className = cls.join(" ");
      btn.textContent = isBoss ? "BOSS" : String(i + 1);
      if (stars > 0) {
        const s = document.createElement("div");
        s.className = "mini-stars";
        s.textContent = "★".repeat(stars);
        btn.appendChild(s);
      }
      if (isUnlocked) {
        btn.addEventListener("click", () => onPick(i));
      }
      this.dom.levelGrid.appendChild(btn);
    }
    this.dom.levelModal.classList.remove("hidden");
    this._showMask();
  }

  // ----- New: home / leaderboard / confirm dialogs -----
  showHome() {
    this._hideAllModals();
    this.dom.homeModal.classList.remove("hidden");
    this._showMask();
  }

  showLeaderboard({ rows, summary }) {
    this._hideAllModals();
    this.dom.rankSummary.textContent = summary;
    this.dom.rankList.innerHTML = "";
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "rank-row" + (r.stars > 0 ? " cleared" : "");
      const num = document.createElement("div");
      num.className = "rank-num"; num.textContent = String(r.idx + 1);
      const name = document.createElement("div");
      name.className = "rank-name"; name.textContent = r.name;
      const time = document.createElement("div");
      time.className = "rank-time";
      if (r.best) {
        const m = Math.floor(r.best / 60), s = Math.floor(r.best % 60);
        time.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
      } else {
        time.textContent = "—";
      }
      const stars = document.createElement("div");
      stars.className = "rank-stars";
      for (let i = 0; i < 3; i++) {
        const s = document.createElement("span");
        s.textContent = "★";
        if (i >= r.stars) s.className = "empty";
        stars.appendChild(s);
      }
      row.append(num, name, time, stars);
      this.dom.rankList.appendChild(row);
    }
    this.dom.rankModal.classList.remove("hidden");
    this._showMask();
  }

  showConfirm(title, sub, onYes) {
    this._hideAllModals();
    this.dom.confirmTitle.textContent = title;
    this.dom.confirmSub.textContent = sub;
    this._confirmHandler = onYes;
    this.dom.confirmModal.classList.remove("hidden");
    this._showMask();
  }

  hideAll() {
    this._hideAllModals();
    this._hideMask();
  }

  // Lightweight loading overlay for endless-level generation.
  showLoading(text = "Loading…") {
    if (!this._loadingEl) {
      const div = document.createElement("div");
      div.className = "loading-overlay";
      div.innerHTML = `
        <div class="loading-card">
          <div class="loading-spinner"></div>
          <div class="loading-text"></div>
        </div>
      `;
      document.body.appendChild(div);
      this._loadingEl = div;
      this._loadingTextEl = div.querySelector(".loading-text");
    }
    this._loadingTextEl.textContent = text;
    this._loadingEl.classList.add("show");
  }

  hideLoading() {
    if (this._loadingEl) this._loadingEl.classList.remove("show");
  }
}
