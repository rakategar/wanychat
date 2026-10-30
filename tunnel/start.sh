#!/usr/bin/env bash
# Jalankan panel (build produksi) + tunnel autoreply.remot.in. Ctrl+C untuk berhenti.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! curl -s -o /dev/null http://localhost:5180; then
  npm --prefix web run build
  npm --prefix web run preview &
  trap 'kill %1 2>/dev/null' EXIT
fi
cloudflared tunnel --config ~/.cloudflared/igar-autoreply.yml run
