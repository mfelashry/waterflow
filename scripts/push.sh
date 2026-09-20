#!/usr/bin/env bash
# Commit local changes and push to GitHub (origin/main).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MSG="${*:-Update Water Flow}"

if [[ ! -d .git ]]; then
  echo "Not a git repo. Run this from ~/Documents/hophackshackathon" >&2
  exit 1
fi

git remote get-url origin >/dev/null

if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$MSG"
else
  echo "Nothing to commit."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$BRANCH"
echo "Pushed $BRANCH → $(git remote get-url origin)"
