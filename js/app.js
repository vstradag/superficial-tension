import { createPointerState, normalizeToRect } from "./pointer.js";
import { findNearestToOrigin } from "./gazeFrames.js";
import { GazeCanvasRenderer } from "./renderGazeCanvas.js";

/** Mirror X: screen-left matches subject's left gaze in frame (camera vs viewer). */
const FLIP_GAZE_X = true;

/**
 * @param {HTMLElement} root
 * @param {Partial<{
 *   framesIndexUrl: string,
 *   assetBase: string,
 *   canvasSelector: string,
 *   introSelector: string,
 *   introMs: number,
 *   touchRoot: HTMLElement | null,
 *   deadZone: number,
 *   k: number,
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

  const renderer = new GazeCanvasRenderer({
    canvas,
    frames,
    resolveUrl,
    k: options.k ?? 4,
    deadZone: options.deadZone ?? 0.08,
  });

  const fit = () => renderer.fitToContainer(root);
  fit();

  const introEl = root.querySelector(
    options.introSelector ?? "[data-eye-gaze-intro]"
  );
  const introMs = options.introMs ?? 3000;
  const introHideMs = 560;

  if (reduced) {
    await renderer.bootstrap(neutral);
    fit();
    renderer.drawSingleFrame(neutral);
    if (introEl instanceof HTMLElement) {
      introEl.classList.add("is-hidden");
    }
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

  /** Nose calibration: gaze (0,0) when pointer was at intro sample. */
  let calX = 0;
  let calY = 0;

  const rectCenterClient = () => {
    const r = root.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  let lastClient = rectCenterClient();

  const trackMouse = (/** @type {MouseEvent} */ e) => {
    lastClient = { x: e.clientX, y: e.clientY };
  };
  const trackTouch = (/** @type {TouchEvent} */ e) => {
    const t = e.touches[0];
    if (t) lastClient = { x: t.clientX, y: t.clientY };
  };

  window.addEventListener("mousemove", trackMouse, { passive: true });
  window.addEventListener("touchstart", trackTouch, { passive: true });
  window.addEventListener("touchmove", trackTouch, { passive: true });

  if (introEl instanceof HTMLElement) {
    await new Promise((resolve) => setTimeout(resolve, introMs));
    const r = root.getBoundingClientRect();
    const n = normalizeToRect(lastClient.x, lastClient.y, r);
    calX = n.x;
    calY = n.y;
    introEl.classList.add("is-hidden");
    await new Promise((resolve) => setTimeout(resolve, introHideMs));
  } else {
    calX = 0;
    calY = 0;
  }

  window.removeEventListener("mousemove", trackMouse);
  window.removeEventListener("touchstart", trackTouch);
  window.removeEventListener("touchmove", trackTouch);

  const ro = new ResizeObserver(() => fit());
  ro.observe(root);

  const pointer = createPointerState();

  const onPointerClient = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const rect = root.getBoundingClientRect();
    const { x, y } = normalizeToRect(cx, cy, rect);
    pointer.setRaw(x - calX, y - calY);
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
