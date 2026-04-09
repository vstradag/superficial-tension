import {
  findKNearest,
  idwWeights,
  lerpBlendMaps,
  applyDeadZone,
} from "./gazeFrames.js";
import { ImageLRU, preloadPaths } from "./imageCache.js";

/**
 * @typedef {import('./gazeFrames.js').FrameEntry} FrameEntry
 */

/**
 * Weighted additive blend (lighter) ≈ convex combination when weights sum to 1.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} lw logical width (CSS px)
 * @param {number} lh logical height (CSS px)
 * @param {{ img: HTMLImageElement, weight: number }[]} layers
 */
function drawWeightedBlend(ctx, lw, lh, layers) {
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, lw, lh);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, lw, lh);
  ctx.globalCompositeOperation = "lighter";
  for (const { img, weight } of layers) {
    if (weight <= 0) continue;
    ctx.globalAlpha = weight;
    ctx.drawImage(img, 0, 0, lw, lh);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

export class GazeCanvasRenderer {
  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   frames: FrameEntry[],
   *   resolveUrl: (path: string) => string,
   *   k?: number,
   *   deadZone?: number,
   *   blendLerp?: number,
   *   cacheSize?: number,
   * }} opts
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (
      this.canvas.getContext("2d", { alpha: false })
    );
    /** Compositing buffer so the visible canvas updates in one blit (reduces perceived flicker). */
    this._composite = document.createElement("canvas");
    this._cctx = /** @type {CanvasRenderingContext2D} */ (
      this._composite.getContext("2d", { alpha: false })
    );
    this.frames = opts.frames;
    this.resolveUrl = opts.resolveUrl;
    this.k = opts.k ?? 4;
    this.deadZone = opts.deadZone ?? 0.08;
    /** Lower = slower cross-fade between neighbor sets (less strobing when the pointer moves). */
    this.blendLerp = opts.blendLerp ?? 0.12;
    this.cache = new ImageLRU({ maxEntries: opts.cacheSize ?? 56 });

    /** @type {{ entry: FrameEntry, weight: number }[]} */
    this.blendState = [];
    this.logicalW = 1;
    this.logicalH = 1;
    this.ready = false;
  }

  /**
   * @param {FrameEntry} neutralEntry
   */
  async bootstrap(neutralEntry) {
    const near = findKNearest(
      this.frames,
      0,
      0,
      Math.min(12, this.frames.length)
    ).map((x) => x.entry.path);
    const paths = [neutralEntry.path, ...near];
    await preloadPaths(paths, this.resolveUrl, this.cache);
    this.ready = true;
  }

  /**
   * @param {number} sx smoothed pointer x
   * @param {number} sy smoothed pointer y
   */
  drawFrame(sx, sy) {
    if (!this.ready) return;
    const { x: tx, y: ty } = applyDeadZone(sx, sy, this.deadZone);
    const neigh = findKNearest(this.frames, tx, ty, this.k);
    const weighted = idwWeights(neigh);
    const target = weighted.map(({ entry, weight }) => ({ entry, weight }));
    if (this.blendState.length === 0 && target.length) {
      this.blendState = target.map((x) => ({
        entry: x.entry,
        weight: x.weight,
      }));
    } else {
      this.blendState = lerpBlendMaps(this.blendState, target, this.blendLerp);
    }

    const lw = this.logicalW;
    const lh = this.logicalH;
    const layers = [];
    let missing = false;
    for (const { entry, weight } of this.blendState) {
      if (weight < 0.002) continue;
      const img = this.cache.getLoaded(entry.path);
      if (!img) {
        this.cache.load(entry.path, this.resolveUrl(entry.path)).catch(() => {});
        missing = true;
        continue;
      }
      layers.push({ img, weight });
    }
    if (layers.length === 0) return;
    // Additive "lighter" blend: skipping a layer collapses total energy → visible flash. Keep last frame.
    if (missing) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      this._composite.width !== this.canvas.width ||
      this._composite.height !== this.canvas.height
    ) {
      this._composite.width = this.canvas.width;
      this._composite.height = this.canvas.height;
    }
    this._cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWeightedBlend(this._cctx, lw, lh, layers);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this._composite, 0, 0);
  }

  /**
   * @param {HTMLElement} container
   */
  fitToContainer(container) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = container.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(r.width));
    const cssH = Math.max(1, Math.floor(r.height));
    this.logicalW = cssW;
    this.logicalH = cssH;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this._composite.width = this.canvas.width;
    this._composite.height = this.canvas.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {FrameEntry} entry
   */
  drawSingleFrame(entry) {
    const img = this.cache.getLoaded(entry.path);
    if (!img) return;
    const lw = this.logicalW;
    const lh = this.logicalH;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.clearRect(0, 0, lw, lh);
    this.ctx.drawImage(img, 0, 0, lw, lh);
  }

  /**
   * Draw external media (e.g. ALIVE.mp4) into the gaze canvas.
   * @param {CanvasImageSource} media
   */
  drawMedia(media) {
    const lw = this.logicalW;
    const lh = this.logicalH;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.clearRect(0, 0, lw, lh);
    this.ctx.drawImage(media, 0, 0, lw, lh);
  }
}
