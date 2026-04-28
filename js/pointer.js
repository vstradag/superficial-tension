import { lerp } from "./math.js";

/**
 * Normalized pointer in [-1, 1]² (portfolio-style: y up is positive).
 * @param {number} clientX
 * @param {number} clientY
 * @param {DOMRectReadOnly} rect
 */
export function normalizeToRect(clientX, clientY, rect) {
  const w = rect.width || 1;
  const h = rect.height || 1;
  const x = ((clientX - rect.left) / w) * 2 - 1;
  const y = -((clientY - rect.top) / h) * 2 + 1;
  return { x, y };
}

/**
 * @param {MouseEvent} event
 * @param {DOMRectReadOnly} rect
 */
export function handleMouseMove(event, rect) {
  return normalizeToRect(event.clientX, event.clientY, rect);
}

/**
 * @param {TouchEvent} event
 * @param {DOMRectReadOnly} rect
 */
export function handleTouchMove(event, rect) {
  const t = event.touches[0];
  if (!t) return { x: 0, y: 0 };
  return normalizeToRect(t.clientX, t.clientY, rect);
}

/**
 * Mutable pointer + smoothing (Scene.tsx pattern, without Three.js).
 * @param {{ interpolationX?: number, interpolationY?: number }} [opts]
 */
export function createPointerState(opts = {}) {
  const raw = { x: 0, y: 0 };
  const smoothed = { x: 0, y: 0 };
  const defaultInterpolation = {
    x: opts.interpolationX ?? 0.2,
    y: opts.interpolationY ?? 0.22,
  };
  let interpolation = {
    x: defaultInterpolation.x,
    y: defaultInterpolation.y,
  };

  return {
    raw,
    smoothed,
    get interpolation() {
      return interpolation;
    },
    /** @param {{ x: number, y: number }} next */
    setInterpolation(next) {
      interpolation = { x: next.x, y: next.y };
    },
    /** @param {number} x @param {number} y */
    setRaw(x, y) {
      raw.x = x;
      raw.y = y;
    },
    /** Freeze both targets at one position immediately. */
    snap(x, y) {
      raw.x = x;
      raw.y = y;
      smoothed.x = x;
      smoothed.y = y;
    },
    /** Portfolio-style soft settle after touch ends (handleTouchEnd). */
    scheduleTouchEndReset() {
      window.setTimeout(() => {
        raw.x = 0;
        raw.y = 0;
        interpolation = { x: 0.08, y: 0.08 };
        window.setTimeout(() => {
          interpolation = {
            x: defaultInterpolation.x,
            y: defaultInterpolation.y,
          };
        }, 1000);
      }, 2000);
    },
    /** One frame: ease smoothed toward raw. */
    step() {
      smoothed.x = lerp(smoothed.x, raw.x, interpolation.x);
      smoothed.y = lerp(smoothed.y, raw.y, interpolation.y);
    },
  };
}
