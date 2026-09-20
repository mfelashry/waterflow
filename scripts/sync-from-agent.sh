#!/usr/bin/env bash
# Pull the latest Cloud Agent export and force-push it to GitHub.
# Requires Cursor Desktop port-forward of the agent app (default 43173).
set -euo pipefail

PORT="${AGENT_PORT:-43173}"
URL="http://127.0.0.1:${PORT}/waterflow-latest.tar.gz"
DEST="${HOME}/Documents/waterflow"
TMP="$(mktemp -d)"
TAR="${TMP}/waterflow-latest.tar.gz"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Downloading latest from Cloud Agent (${URL})…"
if ! curl -fsSL -o "$TAR" "$URL"; then
  echo "Download failed. In Cursor → this agent → Forwarded Ports, forward ${PORT}, then retry." >&2
  exit 1
fi

echo "Replacing ${DEST}…"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
tar -xzf "$TAR" -C "$TMP"
mv "$TMP/waterflow" "$DEST"
cd "$DEST"

test -f src/lib/reportDocument.ts

echo "Force-pushing to GitHub…"
git push -u origin main --force

echo "Done. Latest code is in ${DEST} and on GitHub."
echo "Repo: $(git remote get-url origin)"
