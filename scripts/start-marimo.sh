#!/usr/bin/env bash
# Start the Marimo companion notebook for Water Flow charts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MARIMO_PORT:-2718}"
HOST="${MARIMO_HOST:-127.0.0.1}"
export WATERFLOW_ORIGIN="${WATERFLOW_ORIGIN:-http://127.0.0.1:43173}"
export PATH="${HOME}/.local/bin:${PATH}"

cd "$ROOT"

if ! command -v marimo >/dev/null 2>&1; then
  echo "Installing Marimo + chart deps…"
  python3 -m pip install --user -r requirements-marimo.txt
fi

echo "Marimo charts → http://${HOST}:${PORT}"
echo "Expects Waterflow at ${WATERFLOW_ORIGIN}"
exec marimo run marimo/site_charts.py --host "$HOST" --port "$PORT" --no-token
