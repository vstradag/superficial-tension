#!/usr/bin/env node
/**
 * Reads manifest.json + frames/out/<clipId>/ and writes frames-index.json
 * with per-frame gaze (gx, gy) in [-1, 1]² (Y-up, matching js/pointer.js).
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const NODE_VEC = {
  CENTER: [0, 0],
  LEFT: [-1, 0],
  RIGHT: [1, 0],
  UP: [0, 1],
  DOWN: [0, -1],
};

function lerp2(from, to, t) {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
}

function main() {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "manifest.json"), "utf8")
  );
  const frames = [];

  for (const edge of manifest.edges) {
    const file = edge.file;
    const fileBase = file.replace(/\.mp4$/i, "");
    const variants = [
      {
        dirBase: fileBase,
        fromKey: edge.from,
        toKey: edge.to,
        clipName: fileBase,
      },
      {
        dirBase: `${fileBase}__REV`,
        fromKey: edge.to,
        toKey: edge.from,
        clipName: `${fileBase}__REV`,
      },
    ];

    for (const variant of variants) {
      const dir = join(ROOT, "frames", "out", variant.dirBase);
      let names = [];
      try {
        names = readdirSync(dir).filter((n) => /\.(jpe?g|webp|png)$/i.test(n));
      } catch {
        if (variant.dirBase.endsWith("__REV")) continue;
        console.warn(`Missing frames dir (run npm run extract): ${dir}`);
        continue;
      }
      names.sort();

      const fromKey = variant.fromKey;
      const toKey = variant.toKey;
      if (!NODE_VEC[fromKey] || !NODE_VEC[toKey]) {
        console.warn(`Unknown node in edge: ${fromKey} -> ${toKey}`);
        continue;
      }
      const v0 = NODE_VEC[fromKey];
      const v1 = NODE_VEC[toKey];
      const N = names.length;
      if (N === 0) continue;

      for (let i = 0; i < N; i++) {
        const t = N === 1 ? 0 : i / (N - 1);
        const [gx, gy] = lerp2(v0, v1, t);
        const relPath = `frames/out/${variant.dirBase}/${names[i]}`.replace(
          /\\/g,
          "/"
        );
        frames.push({
          path: relPath,
          gx,
          gy,
          clip: variant.clipName,
          frame: i + 1,
        });
      }
    }
  }

  if (frames.length === 0) {
    console.error(
      "No frames indexed. Run: npm run extract && npm run build-index"
    );
    process.exit(1);
  }

  const out = {
    version: 1,
    fps: 24,
    note: "gx,gy: gaze direction in [-1,1]²; Y-up; built from manifest edges + linear time",
    frames,
  };

  const outPath = join(ROOT, "frames-index.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${frames.length} frames -> ${outPath}`);
}

main();
