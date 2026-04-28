import { createPointerState, normalizeToRect } from "./pointer.js";
import { findKNearest, findNearestToOrigin } from "./gazeFrames.js";
import { GazeCanvasRenderer } from "./renderGazeCanvas.js";

/** Mirror X: screen-left matches subject's left gaze in frame (camera vs viewer). */
const FLIP_GAZE_X = true;
/** Short delay before freezing the last rendered gaze frame. */
const IDLE_HOLD_MS = 220;
const INTRO_MIN_LOAD_MS = 1400;
const INTRO_PROGRESS_LOAD_SHARE = 0.92;

function animateValue(from, to, duration, onUpdate) {
  const safeDuration = Math.max(1, duration);
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / safeDuration);
      onUpdate(from + (to - from) * t);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function createIntroController(root) {
  const introEl = root.querySelector("[data-eye-gaze-intro]");
  const startBtn = root.querySelector("[data-eye-gaze-start]");
  if (!(introEl instanceof HTMLElement) || !(startBtn instanceof HTMLButtonElement)) {
    return null;
  }
  const hintEl = introEl.querySelector("[data-eye-gaze-hint]");
  const progressEl = introEl.querySelector("[data-eye-gaze-progress]");
  const progressBarEl = introEl.querySelector("[data-eye-gaze-progress-bar]");
  const progressCopyEl = introEl.querySelector("[data-eye-gaze-progress-copy]");
  const markStateEl = introEl.querySelector("[data-eye-gaze-mark-state]");

  let currentProgress = 0;
  const setProgress = (nextProgress, label = "Loading gaze frames") => {
    currentProgress = Math.max(0, Math.min(1, nextProgress));
    const percent = Math.round(currentProgress * 100);
    if (progressBarEl instanceof HTMLElement) {
      progressBarEl.style.width = `${percent}%`;
    }
    if (progressEl instanceof HTMLElement) {
      progressEl.setAttribute("aria-valuenow", String(percent));
    }
    if (progressCopyEl instanceof HTMLElement) {
      progressCopyEl.textContent = `${label}... ${percent}%`;
    }
  };

  startBtn.disabled = true;
  introEl.classList.remove("is-ready");
  setProgress(0);

  return {
    introEl,
    startBtn,
    get progress() {
      return currentProgress;
    },
    setLoading() {
      if (hintEl instanceof HTMLElement) {
        hintEl.textContent =
          "Loading interaction. The tickling point unlocks at 100%.";
      }
      if (markStateEl instanceof HTMLElement) {
        markStateEl.textContent = "Loading";
      }
      startBtn.disabled = true;
      introEl.classList.remove("is-ready");
    },
    setProgress,
    async finishLoading(minDurationMs) {
      if (minDurationMs > 0) {
        await animateValue(
          currentProgress,
          1,
          minDurationMs,
          (value) => setProgress(value)
        );
      } else {
        setProgress(1);
      }
      if (hintEl instanceof HTMLElement) {
        hintEl.textContent = "Loaded. Click the tickling point to start.";
      }
      if (progressCopyEl instanceof HTMLElement) {
        progressCopyEl.textContent = "Loading complete. Interaction unlocked.";
      }
      if (markStateEl instanceof HTMLElement) {
        markStateEl.textContent = "Ready";
      }
      startBtn.disabled = false;
      introEl.classList.add("is-ready");
    },
  };
}

function buildWarmupPaths(frames, neutralEntry) {
  const targets = [
    { x: 0, y: 0, k: 28 },
    { x: 0.22, y: 0, k: 18 },
    { x: -0.22, y: 0, k: 18 },
    { x: 0, y: 0.2, k: 18 },
    { x: 0, y: -0.2, k: 18 },
    { x: 0.45, y: 0.12, k: 14 },
    { x: -0.45, y: 0.12, k: 14 },
    { x: 0.45, y: -0.12, k: 14 },
    { x: -0.45, y: -0.12, k: 14 },
    { x: 0.68, y: 0, k: 12 },
    { x: -0.68, y: 0, k: 12 },
    { x: 0, y: 0.5, k: 12 },
    { x: 0, y: -0.5, k: 12 },
  ];
  const paths = new Set([neutralEntry.path]);
  for (const target of targets) {
    const nearest = findKNearest(frames, target.x, target.y, Math.min(target.k, frames.length));
    for (const { entry } of nearest) {
      paths.add(entry.path);
    }
  }
  return [...paths];
}

async function warmupIntroAssets(renderer, frames, neutralEntry, resolveUrl, introUi) {
  const warmupPaths = buildWarmupPaths(frames, neutralEntry);
  const startedAt = performance.now();
  introUi?.setLoading();

  let completed = 0;
  const total = Math.max(1, warmupPaths.length);
  await Promise.all(
    warmupPaths.map((path) =>
      renderer.cache
        .load(path, resolveUrl(path))
        .catch(() => null)
        .finally(() => {
          completed += 1;
          introUi?.setProgress((completed / total) * INTRO_PROGRESS_LOAD_SHARE);
        })
    )
  );

  renderer.ready = true;
  const remaining = INTRO_MIN_LOAD_MS - (performance.now() - startedAt);
  await introUi?.finishLoading(Math.max(0, remaining));
}

/**
 * Browsers require a user gesture; call from click only.
 * @returns {Promise<void>}
 */
function requestFullscreenBestEffort() {
  const el = document.documentElement;
  const req =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.msRequestFullscreen;
  if (!req) return Promise.resolve();
  try {
    const p = req.call(el);
    return p && typeof p.then === "function"
      ? p.then(() => {}).catch(() => {})
      : Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

/**
 * @param {HTMLElement} root
 * @param {() => void} fit
 * @param {Partial<{ introSelector: string, introHideMs: number }>} [options]
 * @returns {Promise<{ calX: number, calY: number }>}
 */
function waitForIntroDismiss(root, fit, options = {}) {
  const introEl = root.querySelector(
    options.introSelector ?? "[data-eye-gaze-intro]"
  );
  const introHideMs = options.introHideMs ?? 560;
  const startBtn = root.querySelector("[data-eye-gaze-start]");

  if (!(introEl instanceof HTMLElement)) {
    return Promise.resolve({ calX: 0, calY: 0 });
  }
  if (!(startBtn instanceof HTMLButtonElement)) {
    introEl.classList.add("is-dismissing", "is-hidden");
    return Promise.resolve({ calX: 0, calY: 0 });
  }

  return new Promise((resolve) => {
    const onStart = async (e) => {
      e.preventDefault();
      startBtn.removeEventListener("click", onStart);
      startBtn.disabled = true;
      introEl.classList.add("is-dismissing");

      await requestFullscreenBestEffort();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      fit();

      const r = root.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const n = normalizeToRect(cx, cy, r);

      introEl.classList.add("is-hidden");
      await new Promise((res) => setTimeout(res, introHideMs));
      resolve({ calX: n.x, calY: n.y });
    };
    startBtn.addEventListener("click", onStart);
  });
}

/**
 * @param {HTMLElement} root
 * @param {Partial<{
 *   framesIndexUrl: string,
 *   assetBase: string,
 *   canvasSelector: string,
 *   introSelector: string,
 *   introHideMs: number,
 *   touchRoot: HTMLElement | null,
 *   deadZone: number,
 *   k: number,
 *   blendLerp: number,
 *   interpolationX: number,
 *   interpolationY: number,
 * }>} [options]
 */
export async function mountEyeGaze(root, options = {}) {
  const canvas = root.querySelector(
    options.canvasSelector ?? "[data-eye-gaze-canvas]"
  );
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Eye gaze: expected canvas[data-eye-gaze-canvas]");
  }

  const framesIndexUrl =
    options.framesIndexUrl ??
    new URL("../frames-index.json", import.meta.url).href;
  const assetBase =
    options.assetBase ?? new URL("../", import.meta.url).href;

  const res = await fetch(framesIndexUrl);
  if (!res.ok) throw new Error(`frames-index.json failed: ${res.status}`);
  const data = await res.json();
  const frames = data.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error(
      "frames-index.json has no frames. Run npm run extract && npm run build-index"
    );
  }

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const resolveUrl = (path) => new URL(path, assetBase).href;

  const neutral = findNearestToOrigin(frames);
  const introUi = createIntroController(root);

  const renderer = new GazeCanvasRenderer({
    canvas,
    frames,
    resolveUrl,
    k: options.k ?? 1,
    deadZone: options.deadZone ?? 0.08,
    blendLerp: options.blendLerp,
  });

  const fit = () => renderer.fitToContainer(root);
  fit();

  if (reduced) {
    await warmupIntroAssets(renderer, frames, neutral, resolveUrl, introUi);
    fit();
    await waitForIntroDismiss(root, fit, options);
    renderer.drawSingleFrame(neutral);
    const ro = new ResizeObserver(() => {
      fit();
      renderer.drawSingleFrame(neutral);
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
    };
  }

  await warmupIntroAssets(renderer, frames, neutral, resolveUrl, introUi);

  /** Nose calibration: gaze (0,0) at screen center after start click + fullscreen. */
  const { calX, calY } = await waitForIntroDismiss(root, fit, options);

  const ro = new ResizeObserver(() => fit());
  ro.observe(root);

  const pointer = createPointerState({
    interpolationX: options.interpolationX,
    interpolationY: options.interpolationY,
  });
  let lastMoveAt = performance.now();
  let lastRawX = 0;
  let lastRawY = 0;
  /** Ignore tiny mouse jitter so idle can reliably engage. */
  const MOVE_EPS = 0.003;
  /** Let smoothing finish before treating the scene as fully idle. */
  const SETTLE_EPS = 0.0025;

  const onPointerClient = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const rect = root.getBoundingClientRect();
    const { x, y } = normalizeToRect(cx, cy, rect);
    const nx = x - calX;
    const ny = y - calY;
    const moved = Math.abs(nx - lastRawX) > MOVE_EPS || Math.abs(ny - lastRawY) > MOVE_EPS;
    if (moved) {
      pointer.setRaw(nx, ny);
      lastRawX = nx;
      lastRawY = ny;
      lastMoveAt = performance.now();
    }
  };

  const onMouseMove = (/** @type {MouseEvent} */ e) => {
    onPointerClient(e.clientX, e.clientY);
  };

  /** @param {TouchEvent} e */
  const onTouchMove = (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) onPointerClient(t.clientX, t.clientY);
  };

  let debounceRef = /** @type {number | null} */ (null);

  const touchSurface =
    options.touchRoot !== undefined ? options.touchRoot : root;

  const onTouchStart = () => {
    if (!touchSurface) return;
    if (debounceRef !== null) {
      window.clearTimeout(debounceRef);
      debounceRef = null;
    }
    debounceRef = window.setTimeout(() => {
      debounceRef = null;
      touchSurface.addEventListener("touchmove", onTouchMove, {
        passive: false,
      });
    }, 200);
  };

  const onTouchEnd = () => {
    if (!touchSurface) return;
    if (debounceRef !== null) {
      window.clearTimeout(debounceRef);
      debounceRef = null;
    }
    touchSurface.removeEventListener("touchmove", onTouchMove);
    pointer.scheduleTouchEndReset();
  };

  window.addEventListener("mousemove", onMouseMove);
  if (touchSurface) {
    touchSurface.addEventListener("touchstart", onTouchStart, { passive: true });
    touchSurface.addEventListener("touchend", onTouchEnd);
  }

  let rafId = 0;
  const loop = () => {
    rafId = window.requestAnimationFrame(loop);
    const idle = performance.now() - lastMoveAt > IDLE_HOLD_MS;
    const settled =
      Math.abs(pointer.smoothed.x - pointer.raw.x) < SETTLE_EPS &&
      Math.abs(pointer.smoothed.y - pointer.raw.y) < SETTLE_EPS;
    if (idle && settled) {
      // Hold the exact frame that was last rendered when movement stopped.
      return;
    }
    pointer.step();
    const sx = pointer.smoothed.x;
    const sy = pointer.smoothed.y;
    const gx = FLIP_GAZE_X ? -sx : sx;
    renderer.drawFrame(gx, sy);
  };
  rafId = window.requestAnimationFrame(loop);

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener("mousemove", onMouseMove);
    if (touchSurface) {
      touchSurface.removeEventListener("touchstart", onTouchStart);
      touchSurface.removeEventListener("touchend", onTouchEnd);
      touchSurface.removeEventListener("touchmove", onTouchMove);
    }
    ro.disconnect();
  };
}

const autoRoot = document.getElementById("eyeGazeRoot");
if (autoRoot instanceof HTMLElement) {
  mountEyeGaze(autoRoot).catch((err) => {
    console.error(err);
  });
}
