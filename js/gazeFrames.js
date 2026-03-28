import { lerp } from "./math.js";

/**
 * @typedef {{ path: string, gx: number, gy: number, clip?: string, frame?: number }} FrameEntry
 */

/**
 * @param {FrameEntry[]} frames
 * @param {number} tx
 * @param {number} ty
 * @param {number} k
 * @returns {{ entry: FrameEntry, d2: number }[]}
 */
export function findKNearest(frames, tx, ty, k) {
  const scored = frames.map((entry, index) => {
    const dx = entry.gx - tx;
    const dy = entry.gy - ty;
    return { entry, index, d2: dx * dx + dy * dy };
  });
  scored.sort((a, b) => a.d2 - b.d2);
  return scored.slice(0, k).map(({ entry, d2 }) => ({ entry, d2 }));
}

const EPS = 1e-5;

/**
 * Inverse-distance weights (normalized). Closer frames get more weight.
 * @param {{ entry: FrameEntry, d2: number }[]} neighbors
 */
export function idwWeights(neighbors) {
  const w = neighbors.map(({ d2 }) => 1 / (Math.sqrt(d2) + EPS));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return neighbors.map((n, i) => ({
    entry: n.entry,
    weight: w[i] / sum,
  }));
}

/**
 * @param {{ entry: FrameEntry, weight: number }[]} current
 * @param {{ entry: FrameEntry, weight: number }[]} target
 * @param {number} t
 */
export function lerpBlendMaps(current, target, t) {
  const key = (e) => e.path;
  const map = new Map();
  for (const x of current) {
    map.set(key(x.entry), x.weight);
  }
  const out = [];
  const keys = new Set([...map.keys(), ...target.map((x) => key(x.entry))]);
  for (const k of keys) {
    const a = map.get(k) ?? 0;
    const tb = target.find((x) => key(x.entry) === k);
    const b = tb?.weight ?? 0;
    const w = lerp(a, b, t);
    if (w < 1e-6) continue;
    const entry = tb?.entry ?? current.find((x) => key(x.entry) === k)?.entry;
    if (entry) out.push({ entry, weight: w });
  }
  const s = out.reduce((acc, x) => acc + x.weight, 0) || 1;
  for (const x of out) x.weight /= s;
  return out;
}

/**
 * @param {FrameEntry[]} frames
 */
export function findNearestToOrigin(frames) {
  let best = frames[0];
  let bestD = Infinity;
  for (const f of frames) {
    const d = f.gx * f.gx + f.gy * f.gy;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/**
 * Apply center dead zone: if pointer is inside radius, snap gaze to origin.
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 */
export function applyDeadZone(x, y, radius) {
  const d = Math.hypot(x, y);
  if (d < radius) return { x: 0, y: 0 };
  return { x, y };
}
