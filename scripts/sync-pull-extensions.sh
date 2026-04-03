#!/usr/bin/env bash
set -euo pipefail

# Pull extensions from repo to local pi config
# Usage: ./scripts/sync-pull-extensions.sh

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${PI_EXT_DIR:-$HOME/.pi/agent/extensions}"
SOURCE_DIR="$REPO_DIR/extensions"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Extensions not found in repo: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude '*.log' "$SOURCE_DIR/" "$TARGET_DIR/"

echo "Done: extensions synced from repo to $TARGET_DIR"
echo "Restart pi to load updated extensions."
