/**
 * LRU cache for HTMLImageElement keyed by URL path.
 */
export class ImageLRU {
  /**
   * @param {{ maxEntries?: number }} [opts]
   */
  constructor(opts = {}) {
    this.maxEntries = opts.maxEntries ?? 56;
    /** @type {Map<string, HTMLImageElement>} */
    this.map = new Map();
    /** @type {Map<string, Promise<HTMLImageElement>>} */
    this.pending = new Map();
  }

  /**
   * @param {string} path
   * @param {string} resolvedUrl
   * @returns {Promise<HTMLImageElement>}
   */
  load(path, resolvedUrl) {
    const hit = this.map.get(path);
    if (hit && hit.complete && hit.naturalWidth) {
      this.map.delete(path);
      this.map.set(path, hit);
      return Promise.resolve(hit);
    }
    const inflight = this.pending.get(path);
    if (inflight) {
      return inflight;
    }

    const request = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.pending.delete(path);
        this._insert(path, img);
        resolve(img);
      };
      img.onerror = () => {
        this.pending.delete(path);
        reject(new Error(`Failed to load image: ${resolvedUrl}`));
      };
      img.src = resolvedUrl;
    });
    this.pending.set(path, request);
    return request;
  }

  /**
   * @param {string} path
   * @param {HTMLImageElement} img
   */
  _insert(path, img) {
    if (this.map.has(path)) this.map.delete(path);
    this.map.set(path, img);
    while (this.map.size > this.maxEntries) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }

  /**
   * @param {string} path
   */
  has(path) {
    return this.map.has(path);
  }

  /**
   * @param {string} path
   * @returns {HTMLImageElement | null}
   */
  getLoaded(path) {
    const img = this.map.get(path);
    if (img && img.complete && img.naturalWidth) return img;
    return null;
  }
}

/**
 * @param {string[]} paths
 * @param {(p: string) => string} resolveUrl
 * @param {ImageLRU} cache
 */
export function preloadPaths(paths, resolveUrl, cache) {
  const unique = [...new Set(paths)];
  return Promise.all(unique.map((p) => cache.load(p, resolveUrl(p))));
}
