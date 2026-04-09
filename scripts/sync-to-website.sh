#!/usr/bin/env bash
# Copy this static app into the portfolio's public/superficial-tension/ (for
# VITE_SUPERFICIAL_TENSION_URL=same-origin). Run from the superficialTension repo root:
#   npm run sync:website
# Override destination repo: WEBSITE_DESIGN=/path/to/websiteDesign bash scripts/sync-to-website.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_WEBSITE="$HOME/Library/CloudStorage/GoogleDrive-vstradag@gmail.com/My Drive/2026/websiteDesign"
WEBSITE="${WEBSITE_DESIGN:-$DEFAULT_WEBSITE}"
DEST="$WEBSITE/public/superficial-tension"

if [[ ! -d "$WEBSITE" ]]; then
  echo "Website folder not found: $WEBSITE" >&2
  echo "Set WEBSITE_DESIGN to your vicenteswebsite checkout path." >&2
  exit 1
fi

mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.git' \
  --exclude '.vercel' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  "$ROOT/" "$DEST/"

echo "Synced to $DEST"
echo "In the portfolio site, use VITE_SUPERFICIAL_TENSION_URL=same-origin in .env.local and npm run dev"
