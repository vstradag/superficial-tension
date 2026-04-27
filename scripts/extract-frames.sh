#!/usr/bin/env bash
# Extract frames from all clips listed in manifest.json at a fixed rate (24 fps).
# Output:
#   frames/out/<clipId>/frame_%05d.jpg
#   frames/out/<clipId>__REV/frame_%05d.jpg   (same clip reversed in time)
#
# Requires: ffmpeg
# Usage: from repo root — bash scripts/extract-frames.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/manifest.json"
OUT_ROOT="$ROOT/frames/out"
FPS="${FPS:-24}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install ffmpeg and retry." >&2
  exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing manifest: $MANIFEST" >&2
  exit 1
fi

detect_crop_filter() {
  local src="$1"
  local source_size
  source_size="$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=p=0:s=x "$src" | tr -d '\r')"
  local src_w="${source_size%x*}"
  local src_h="${source_size#*x}"

  local crop
  crop="$(
    python3 - "$src" "$src_w" "$src_h" <<'PY'
import re
import subprocess
import sys

src, src_w, src_h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
cmd = [
    "ffmpeg", "-hide_banner", "-loglevel", "info", "-i", src,
    "-vf", "cropdetect=limit=0.02:round=2:reset=0",
    "-frames:v", "45", "-f", "null", "-"
]
proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
matches = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", proc.stderr)
if not matches:
    print("")
    raise SystemExit
w, h, x, y = map(int, matches[-1])
# Ignore trivial changes / false positives.
if w >= src_w - 4 and h >= src_h - 4:
    print("")
elif w <= 0 or h <= 0:
    print("")
else:
    print(f"crop={w}:{h}:{x}:{y},scale={src_w}:{src_h}")
PY
  )"

  printf '%s' "$crop"
}

# macOS ships python3; parse manifest edges for unique .mp4 basenames
FILES_JSON="$(python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
seen = []
for e in m.get("edges", []):
    f = e.get("file", "")
    if f and f not in seen:
        seen.append(f)
print("\n".join(seen))
PY
)"

while IFS= read -r FILE; do
  [[ -z "$FILE" ]] && continue
  SRC="$ROOT/$FILE"
  if [[ ! -f "$SRC" ]]; then
    echo "Skip (missing): $SRC" >&2
    continue
  fi
  CLIP_ID="${FILE%.mp4}"
  DEST="$OUT_ROOT/$CLIP_ID"
  VF="fps=${FPS}"
  case "$FILE" in
    UP.mp4)
      # UP sources have arrived with different dimensions over time. Detect any
      # baked-in pillarbox/letterbox bars dynamically instead of hardcoding one crop.
      CROP_FILTER="$(detect_crop_filter "$SRC")"
      if [[ -n "$CROP_FILTER" ]]; then
        VF="${CROP_FILTER},fps=${FPS}"
      fi
      ;;
  esac
  mkdir -p "$DEST"
  echo "Extracting $FILE -> $DEST @ ${FPS}fps"
  ffmpeg -y -hide_banner -loglevel error -i "$SRC" \
    -vf "$VF" \
    -q:v 3 \
    "$DEST/frame_%05d.jpg"
  REV_DEST="${DEST}__REV"
  mkdir -p "$REV_DEST"
  echo "Extracting $FILE -> $REV_DEST @ ${FPS}fps reversed"
  ffmpeg -y -hide_banner -loglevel error -i "$SRC" \
    -vf "${VF},reverse" \
    -q:v 3 \
    "$REV_DEST/frame_%05d.jpg"
done <<< "$FILES_JSON"

echo "Done. Run: npm run build-index"
