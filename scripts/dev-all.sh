#!/usr/bin/env bash
# Run Next.js Waterflow + Marimo charts together.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${PATH}"
export WATERFLOW_ORIGIN="${WATERFLOW_ORIGIN:-http://127.0.0.1:43173}"
APP_PORT="${APP_PORT:-43173}"
MARIMO_PORT="${MARIMO_PORT:-2718}"

cd "$ROOT"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Waterflow on ${APP_PORT}…"
npm run dev -- --hostname 127.0.0.1 --port "$APP_PORT" &
APP_PID=$!

echo "Starting Marimo on ${MARIMO_PORT}…"
bash "$ROOT/scripts/start-marimo.sh" &
MARIMO_PID=$!

echo ""
echo "Waterflow  http://127.0.0.1:${APP_PORT}"
echo "Marimo     http://127.0.0.1:${MARIMO_PORT}"
echo ""

wait "$APP_PID" "$MARIMO_PID"
