# Superficial Tension — eye gaze (static)

Interactive gaze piece: static HTML/CSS/JS, `frames-index.json`, and raster frames under `frames/out/`.

## Local preview

```bash
npm run extract && npm run build-index   # after changing manifest or source .mp4 clips
python3 -m http.server 8080
```

Open http://localhost:8080/

## Deploy on Vercel (static)

1. Push this repo to GitHub (include `frames/out/` — required at runtime).
2. Vercel → **Import** the repo.
3. **Framework:** Other. **Build command:** leave empty. **Output directory:** `.` (root, where `index.html` lives).
4. Deploy and open the production URL.

If any single file exceeds GitHub’s 100 MB limit, use [Git LFS](https://git-lfs.com) for that asset or split the pipeline.

## Pipeline (developers)

- Source clips and `manifest.json` → `npm run extract` → `npm run build-index` → updates `frames/out/` and `frames-index.json`.
