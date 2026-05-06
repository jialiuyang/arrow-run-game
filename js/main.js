import { Game } from "./game.js";
import { LEVELS, MAX_LEVEL } from "./levels.js";

window.addEventListener("DOMContentLoaded", () => {
  const game = new Game();

  // ── Anti-cheat: don't expose the Game instance globally by default.
  //    Earlier versions did `window.__game = game` unconditionally
  //    "for dev hooks", but that turns the inspector console into a
  //    one-liner cheat panel: `__game.state.coins = 99999;
  //    __game._endWin();`. We keep the hook available for debugging
  //    via an explicit opt-in URL flag (?dev=1). _endWin() is also
  //    independently gated by a session-token check, so even with the
  //    hook exposed, a console-fabricated win still earns 0 coins. ──
  if (new URLSearchParams(location.search).get("dev") === "1") {
    window.__game = game;
  }

  // Drop the boot splash once the home screen is layouted. We wait for
  // a single RAF so the home-screen background gradient + logo are
  // already painted underneath — avoids a flash of empty page.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.remove("booting");
  }));

  // Background-warm the first 3 endless levels right after boot so the
  // first "下一关" past curated mode is instant. Wrapped in a setTimeout
  // so it doesn't compete with first-paint.
  setTimeout(() => game.warmEndlessHorizon(), 800);

  // Fade in the hero illustration once it finishes decoding. The image
  // is `loading="eager" fetchpriority="low"` — it starts downloading
  // alongside the page but with priority below CSS/JS, so it never
  // blocks first paint or interactivity. We just toggle `.loaded`
  // when ready so it slides up + fades in instead of popping in.
  const heroImg = document.querySelector(".home-hero-img");
  if (heroImg) {
    if (heroImg.complete && heroImg.naturalWidth > 0) {
      heroImg.classList.add("loaded");
    } else {
      heroImg.addEventListener("load",  () => heroImg.classList.add("loaded"), { once: true });
      heroImg.addEventListener("error", () => heroImg.classList.add("loaded"), { once: true });
    }
  }

  // =====================================================================
  // HOME SCREEN — entry point to the game.
  // Game initializes paused on the current level. Clicking 开始游戏 hides
  // the home screen and starts play. The 主页 button in the HUD pauses
  // and brings the home screen back.
  // =====================================================================
  const $ = (id) => document.getElementById(id);
  const homeScreen = $("homeScreen");

  // Pause-guard loop: while the home screen is visible, the game MUST
  // stay paused regardless of what other code paths do (settingsClose,
  // _closeOverlays, etc all set paused=false on their own). This single
  // RAF tick re-asserts the invariant cheaply.
  function pauseGuard() {
    if (!homeScreen.classList.contains("hidden")) game.paused = true;
    requestAnimationFrame(pauseGuard);
  }
  requestAnimationFrame(pauseGuard);

  // Initial state: game is loaded but paused behind the home overlay.
  showHome();

  function showHome() {
    // Pause game so timer doesn't tick while user is on the menu.
    game.paused = true;
    // Refresh dynamic content (level number, stars, wand count).
    refreshHomeStats();
    homeScreen.classList.remove("hidden");
  }

  function hideHomeAndPlay({ restart = false } = {}) {
    homeScreen.classList.add("hidden");
    // If the level finished (win/lose), restart it. Otherwise just resume.
    if (restart || game.gameOver) {
      game.restartLevel();
      // restartLevel is async — paused gets reset inside loadLevel
    } else {
      game.paused = false;
      // Reset the wall-clock anchor so time-on-menu doesn't count against
      // the player's clear time. Their remaining timeLeft is preserved.
      game.startedAt = performance.now() - (game.timeLimit - game.timeLeft) * 1000;
    }
  }

  function refreshHomeStats() {
    const idx = game.currentLevel;
    const coins = (typeof game.state.coins === "number") ? game.state.coins : 0;
    $("homeCoinsTotal").textContent = String(coins);
    $("homeWandCount").textContent = String(game.wandUses ?? 1);
    $("homeLevelNum").textContent = String(idx + 1);
    const isBoss = idx === MAX_LEVEL - 1;
    const isEndless = idx >= LEVELS.length;
    let name;
    if (isBoss) name = "无限轮回";
    else if (isEndless) name = `无尽第${idx - LEVELS.length + 1}层`;
    else name = LEVELS[idx]?.name || "";
    $("homeLevelName").textContent = name;
  }

  function flashToast(msg) {
    let el = document.querySelector(".home-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "home-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => el.classList.remove("show"), 1400);
  }

  // ---------- Buttons on the home screen ----------
  // Single mode now: 开始游戏 = continue the endless progression from
  // wherever the player left off (currentLevel). No mode picker.
  $("homeStartBtn").addEventListener("click", () => {
    hideHomeAndPlay();
  });

  // Side buttons — open existing modals on top of the home screen.
  $("homeRankSideBtn").addEventListener("click", () => game._openLeaderboard());
  $("homeLevelsSideBtn").addEventListener("click", () => {
    // Quick-jump grid (still shows curated levels — useful as level checkpoints).
    game.paused = true;
    const progress = {
      currentLevel: game.currentLevel,
      maxUnlocked: game.state.maxUnlocked,
      stars: game.state.stars,
    };
    game.ui.showLevelSelect(progress, MAX_LEVEL - 1, (i) => {
      game._closeOverlays();
      game.loadLevel(i);
      hideHomeAndPlay({ restart: false });
    });
  });
  $("homeDecorSideBtn").addEventListener("click", () => flashToast("家园装扮即将推出 🏡"));
  $("homeThemeSideBtn").addEventListener("click", () => flashToast("主题功能即将推出 ✨"));
  $("homeSettingsBtn").addEventListener("click", () => {
    game.ui.dom.sfxToggle.checked = game.state.settings.sfx;
    game.ui.dom.vibrateToggle.checked = game.state.settings.vibrate;
    game.ui.showSettings();
  });
  $("homeHelpBtn").addEventListener("click", () => game.ui.showHelp());

  // 玩法说明 close button
  $("helpClose").addEventListener("click", () => {
    game.ui.hideAll();
    // If we're behind the home screen, the pauseGuard keeps the game paused.
    // Otherwise, restore play.
    if (homeScreen.classList.contains("hidden")) game.paused = false;
  });

  // ---------- 主页 button INSIDE the game (HUD top-left) ----------
  $("backHomeBtn").addEventListener("click", () => {
    showHome();
  });
});
