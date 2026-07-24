#!/usr/bin/env bash
# Extract a WireGuard conf for a meshflare node token (local Docker).
# Usage:
#   ./scripts/extract-wg.sh <connector-token>
#   MESHFLARE_TOKEN=... ./scripts/extract-wg.sh
set -euo pipefail

TOKEN="${1:-${MESHFLARE_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Usage: $0 <connector-token>" >&2
  exit 1
fi

OUT_DIR="${OUT_DIR:-$(pwd)/wg-out}"
mkdir -p "$OUT_DIR"

# Prefer local meshflare extractor image if present; else upstream wgcf-connector.
if docker image inspect meshflare-wgextractor:local >/dev/null 2>&1; then
  docker run --rm --platform linux/amd64 \
    -e CONNECTOR_TOKEN="$TOKEN" \
    meshflare-wgextractor:local
else
  docker run --rm --platform linux/amd64 \
    -v "$OUT_DIR:/app/output" \
    ghcr.io/animmouse/wgcf-connector:latest \
    "$TOKEN"
  echo "Wrote conf(s) to $OUT_DIR" >&2
  ls -la "$OUT_DIR"
fi
