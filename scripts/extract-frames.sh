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
  mkdir -p "$DEST"
  # DOWN-RIGHT.mp4: only the bottom-right movement (ends at t=3s); do not use later footage.
  if [[ "$FILE" == "DOWN-RIGHT.mp4" ]]; then
    echo "Extracting $FILE -> $DEST @ ${FPS}fps (first 3 seconds only)"
    ffmpeg -y -hide_banner -loglevel error -i "$SRC" -t 3 \
      -vf "fps=${FPS}" \
      -q:v 3 \
      "$DEST/frame_%05d.jpg"
    REV_DEST="${DEST}__REV"
    mkdir -p "$REV_DEST"
    echo "Extracting $FILE -> $REV_DEST @ ${FPS}fps reversed (first 3 seconds only)"
    ffmpeg -y -hide_banner -loglevel error -i "$SRC" -t 3 \
      -vf "fps=${FPS},reverse" \
      -q:v 3 \
      "$REV_DEST/frame_%05d.jpg"
  else
    echo "Extracting $FILE -> $DEST @ ${FPS}fps"
    ffmpeg -y -hide_banner -loglevel error -i "$SRC" \
      -vf "fps=${FPS}" \
      -q:v 3 \
      "$DEST/frame_%05d.jpg"
    REV_DEST="${DEST}__REV"
    mkdir -p "$REV_DEST"
    echo "Extracting $FILE -> $REV_DEST @ ${FPS}fps reversed"
    ffmpeg -y -hide_banner -loglevel error -i "$SRC" \
      -vf "fps=${FPS},reverse" \
      -q:v 3 \
      "$REV_DEST/frame_%05d.jpg"
  fi
done <<< "$FILES_JSON"

echo "Done. Run: npm run build-index"
