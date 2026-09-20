#!/usr/bin/env bash
# Pull the latest Cloud Agent build onto your Mac and force-push to GitHub.
#
# On Mac (Cursor Desktop must forward port 43173 first):
#   curl -fsSL http://127.0.0.1:43173/push-to-github.sh | bash
set -euo pipefail

PORT="${AGENT_PORT:-43173}"
BASE="http://127.0.0.1:${PORT}"
TAR_URL="${BASE}/waterflow-latest.tar.gz"
DEST="${HOME}/Documents/waterflow"
REPO="https://github.com/mfelashry/waterflow.git"
TMP="$(mktemp -d)"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo ""
echo "Water Flow -> GitHub sync"
echo "  from: ${TAR_URL}"
echo "  to:   ${REPO}"
echo ""

echo "[1/4] Checking Cloud Agent on port ${PORT}..."
if ! curl -fsS -o /dev/null --connect-timeout 3 "${BASE}/"; then
  cat >&2 <<EOF
Could not reach http://127.0.0.1:${PORT}

In Cursor Desktop:
  1. Open this Cloud Agent chat
  2. Open Forwarded Ports (plug icon)
  3. Forward port ${PORT}
  4. Run again:

     curl -fsSL http://127.0.0.1:${PORT}/push-to-github.sh | bash
EOF
  exit 1
fi

echo "[2/4] Downloading latest export..."
if ! curl -fsSL -o "${TMP}/latest.tar.gz" "$TAR_URL"; then
  echo "Download failed: ${TAR_URL}" >&2
  echo "Ask the agent to run: npm run pack:latest" >&2
  exit 1
fi

SIZE="$(wc -c < "${TMP}/latest.tar.gz" | tr -d ' ')"
if [[ "$SIZE" -lt 10000 ]]; then
  echo "Download looks empty (${SIZE} bytes). Aborting." >&2
  exit 1
fi
echo "      got ${SIZE} bytes"

echo "[3/4] Installing to ${DEST}..."
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
tar -xzf "${TMP}/latest.tar.gz" -C "$TMP"
mv "${TMP}/waterflow" "$DEST"
cd "$DEST"

if [[ ! -f src/lib/reportDocument.ts || ! -f src/lib/ground.ts ]]; then
  echo "ERROR: export is missing expected Water Flow files." >&2
  exit 1
fi

git remote set-url origin "$REPO" 2>/dev/null || git remote add origin "$REPO"

echo "[4/4] Force-pushing main to GitHub..."
git push -u origin main --force

echo ""
echo "Done."
echo "  Mac folder: ${DEST}"
echo "  GitHub:     ${REPO}"
echo "  Commit:     $(git rev-parse --short HEAD) - $(git log -1 --pretty=%s)"
echo ""
