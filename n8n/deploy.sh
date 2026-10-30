#!/usr/bin/env bash
# Build lalu import ketiga workflow ke n8n lokal (container docker "n8n").
# Setelah import, workflow perlu di-publish/aktifkan ulang dari editor n8n.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT_ID="${PROJECT_ID:-kh7u82ADuATgdfpb}"
TARGET=local python3 build.py
for f in dist/local/*.json; do
  docker cp "$f" "n8n:/tmp/$(basename "$f")"
  docker exec n8n n8n import:workflow --input="/tmp/$(basename "$f")" --projectId="$PROJECT_ID"
done
