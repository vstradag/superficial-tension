import { createPointerState, normalizeToRect } from "./pointer.js";
import { findNearestToOrigin } from "./gazeFrames.js";
import { GazeCanvasRenderer } from "./renderGazeCanvas.js";

/** Mirror X: screen-left matches subject's left gaze in frame (camera vs viewer). */
const FLIP_GAZE_X = true;
const IDLE_ALIVE_MS = 380;

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
  const aliveUrl = new URL("ALIVE.mp4", assetBase).href;

  const neutral = findNearestToOrigin(frames);

  const renderer = new GazeCanvasRenderer({
    canvas,
    frames,
    resolveUrl,
    k: options.k ?? 4,
    deadZone: options.deadZone ?? 0.08,
    blendLerp: options.blendLerp,
  });

  const fit = () => renderer.fitToContainer(root);
  fit();

  if (reduced) {
    await renderer.bootstrap(neutral);
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

  await renderer.bootstrap(neutral);

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
  const MOVE_EPS = 0.004;

  const aliveVideo = document.createElement("video");
  aliveVideo.src = aliveUrl;
  aliveVideo.autoplay = true;
  aliveVideo.defaultMuted = true;
  aliveVideo.muted = true;
  aliveVideo.loop = true;
  aliveVideo.playsInline = true;
  aliveVideo.setAttribute("muted", "");
  aliveVideo.setAttribute("playsinline", "");
  aliveVideo.setAttribute("autoplay", "");
  aliveVideo.preload = "auto";
  let aliveReady = false;
  let alivePlayRequested = false;
  let lastAliveTime = 0;
  let staleAliveMs = 0;
  let manualAliveTime = 0;
  let lastLoopTs = performance.now();
  aliveVideo.addEventListener("loadeddata", () => {
    aliveReady = true;
  });
  aliveVideo.addEventListener("canplay", () => {
    aliveReady = true;
  });
  // Force fetch/decode attempt now so idle draw has frames available.
  aliveVideo.load();

  const ensureAlivePlaying = () => {
    if (aliveVideo.paused && !alivePlayRequested) {
      alivePlayRequested = true;
      aliveVideo.play().catch(() => {}).finally(() => {
        alivePlayRequested = false;
      });
    }
  };

  const onPointerClient = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const rect = root.getBoundingClientRect();
    const { x, y } = normalizeToRect(cx, cy, rect);
    const nx = x - calX;
    const ny = y - calY;
    pointer.setRaw(nx, ny);
    const moved = Math.abs(nx - lastRawX) > MOVE_EPS || Math.abs(ny - lastRawY) > MOVE_EPS;
    if (moved) {
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
    const now = performance.now();
    const dt = Math.min(100, now - lastLoopTs);
    lastLoopTs = now;
    pointer.step();
    const idle = performance.now() - lastMoveAt > IDLE_ALIVE_MS;
    if (idle) {
      ensureAlivePlaying();
    }
    if (idle && aliveReady) {
      const t = aliveVideo.currentTime || 0;
      if (Math.abs(t - lastAliveTime) < 0.0005) {
        staleAliveMs += dt;
      } else {
        staleAliveMs = 0;
      }
      lastAliveTime = t;
      // Fallback for autoplay-blocked contexts: scrub time manually while idle.
      if (staleAliveMs > 250 && aliveVideo.duration > 0) {
        manualAliveTime = (manualAliveTime + dt / 1000) % aliveVideo.duration;
        aliveVideo.currentTime = manualAliveTime;
      }
      renderer.drawMedia(aliveVideo);
      return;
    }
    if (!aliveVideo.paused) {
      aliveVideo.pause();
    }
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
    aliveVideo.pause();
    aliveVideo.removeAttribute("src");
    aliveVideo.load();
    ro.disconnect();
  };
}

const autoRoot = document.getElementById("eyeGazeRoot");
if (autoRoot instanceof HTMLElement) {
  mountEyeGaze(autoRoot).catch((err) => {
    console.error(err);
  });
}
