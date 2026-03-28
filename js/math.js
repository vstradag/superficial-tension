/** @param {number} a @param {number} b @param {number} t */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** @param {number} v @param {number} min @param {number} max */
export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
