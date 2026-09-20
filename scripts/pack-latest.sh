#!/usr/bin/env bash
# Build a downloadable export of the current tree for push-to-github.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPORT="$(mktemp -d)/waterflow"
OUT_PUBLIC="${ROOT}/public/waterflow-latest.tar.gz"
OUT_ARTIFACTS="/opt/cursor/artifacts/waterflow-latest.tar.gz"

mkdir -p "$EXPORT" "$(dirname "$OUT_PUBLIC")"

tar -C "$ROOT" -cf - \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.git \
  --exclude=tsconfig.tsbuildinfo \
  --exclude=.env.local \
  --exclude='public/marimo' \
  --exclude='public/waterflow-latest.tar.gz' \
  --exclude='public/HopHacksHackathon-latest.tar.gz' \
  --exclude='*.log' \
  . | tar -xf - -C "$EXPORT"

cd "$EXPORT"
git init -b main >/dev/null
git add -A
git -c user.email="hamza.icloud.elashry@gmail.com" -c user.name="Hamza Elashry" \
  commit -m "Water Flow - latest from Cloud Agent" >/dev/null
git remote add origin https://github.com/mfelashry/waterflow.git

tar -C "$(dirname "$EXPORT")" -czf "$OUT_PUBLIC" "$(basename "$EXPORT")"
mkdir -p "$(dirname "$OUT_ARTIFACTS")" 2>/dev/null || true
cp -f "$OUT_PUBLIC" "$OUT_ARTIFACTS" 2>/dev/null || true

echo "Packed $(wc -c < "$OUT_PUBLIC") bytes → $OUT_PUBLIC"
rm -rf "$(dirname "$EXPORT")"
