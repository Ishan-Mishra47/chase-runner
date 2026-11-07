import { Game } from "./core/Game";

const app = document.getElementById("app")!;
const hud = document.getElementById("hud")!;
const loading = document.getElementById("loading")!;
const pauseOverlay = document.getElementById("pause-overlay");
const lockBtn = document.getElementById("lock-btn");

const game = new Game(app, hud);

let unlockTime = 0;

document.addEventListener("pointerlockchange", () => {
  const isLocked = document.pointerLockElement === game.canvas;
  pauseOverlay?.classList.toggle("locked", isLocked);
  if (!isLocked) {
    unlockTime = performance.now();
  }
});

lockBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  game.requestPointerLock();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    // If currently locked, browser natively handles release
    if (document.pointerLockElement) return;

    // Debounce to prevent immediate re-lock on the same keypress that released it
    if (performance.now() - unlockTime < 250) return;

    e.preventDefault();
    game.requestPointerLock();
  }
});

game
  .load((label, f) => {
    loading.textContent = `loading ${label} ${Math.round(f * 100)}%`;
  })
  .then(() => {
    loading.classList.add("done");
    game.start();
    (window as any).__ready = true;
    // Handle for the headless smoke test (scripts/shot.mjs) and the console.
    (window as any).__game = game;
  })
  .catch((err) => {
    console.error(err);
    loading.textContent = `failed: ${err?.message ?? err}`;
    (window as any).__error = String(err?.stack ?? err);
  });
