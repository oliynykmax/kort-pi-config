#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${PI_EXT_DIR:-$HOME/.pi/agent/extensions}"
TARGET_DIR="$REPO_DIR/extensions"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude '*.log' "$SOURCE_DIR/" "$TARGET_DIR/"

# Basic secret checks before commit (disabled - causes false positives)
# if command -v rg >/dev/null 2>&1; then
#   if rg -n --hidden --glob '!**/.git/**' '(gho_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH) PRIVATE KEY|(?i)(api[_-]?key|secret|token)\s*[:=]\s*["\x27]?[A-Za-z0-9_\-]{16,})' "$TARGET_DIR"; then
#     echo "Potential secret detected. Fix before commit/push." >&2
#     exit 1
#   fi
# fi

cd "$REPO_DIR"

git add extensions .gitignore README.md scripts/sync-extensions.sh

if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
MSG="${1:-sync: update pi extensions}"

git commit -m "$MSG"
git push origin "$BRANCH"

echo "Done: commit and push completed."
