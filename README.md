# Superficial Tension — eye gaze (static)

Interactive gaze piece: static HTML/CSS/JS, `frames-index.json`, and raster frames under `frames/out/`.

## Local preview

```bash
npm run extract && npm run build-index   # after changing manifest or source .mp4 clips
python3 -m http.server 8080
```

Open http://localhost:8080/

**Idle vs. interaction:** When the pointer is still for a short moment, the canvas shows **`CENTER.png`** (static). While you move the pointer, the app blends **JPG frames** extracted from your source clips — that motion can look “video-like” but it is **not** the old `ALIVE.mp4` loop. If you still see old behavior, hard-refresh or bump the `?v=` on the script tag in `index.html` (browsers cache ES modules aggressively). After deploying or syncing to another site, load the new `index.html` + `js/app.js`.

## Deploy on Vercel (static)

1. Push this repo to GitHub (include `frames/out/` — required at runtime).
2. Vercel → **Import** the repo.
3. **Framework:** Other. **Build command:** leave empty. **Output directory:** `.` (root, where `index.html` lives).
4. Deploy and open the production URL.

If any single file exceeds GitHub’s 100 MB limit, use [Git LFS](https://git-lfs.com) for that asset or split the pipeline.

## Pipeline (developers)

- Source clips and `manifest.json` → `npm run extract` → `npm run build-index` → updates `frames/out/` and `frames-index.json`.
