#!/usr/bin/env bash
set -euo pipefail

# Push local pi extensions to this repo
# Usage: ./scripts/sync-push-extensions.sh [commit-message]

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${PI_EXT_DIR:-$HOME/.pi/agent/extensions}"
TARGET_DIR="$REPO_DIR/extensions"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude '*.log' "$SOURCE_DIR/" "$TARGET_DIR/"

cd "$REPO_DIR"

git add extensions .gitignore README.md scripts/

if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
MSG="${1:-sync: push pi extensions to repo}"

git commit -m "$MSG"
git push origin "$BRANCH"

echo "Done: local extensions pushed to repo."
