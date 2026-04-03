# AGENTS.md

## Purpose
Synchronise the local `~/.pi/agent/extensions/` directory with this repository and ensure any change is safe before committing.

## Sync Scripts

Two clear, directional scripts handle synchronization:

### Push Extensions to Repo
After editing extensions in `~/.pi/agent/extensions`, push them to this repo:
```bash
./scripts/sync-push-extensions.sh "chore: update my custom pi extension"
```
This:
1. Copies extensions from `$HOME/.pi/agent/extensions` → `extensions/`
2. Commits changes with your message
3. Pushes to remote

### Pull Extensions from Repo
To install this repo's extensions into your local pi config:
```bash
./scripts/sync-pull-extensions.sh
```
This:
1. Copies extensions from `extensions/` → `$HOME/.pi/agent/extensions`
2. Uses `--delete` to keep directories in sync
3. Requires pi restart to load new extensions

## Key Principles
- **Local pi is source of truth**: Edit in `~/.pi/agent/extensions/` first
- **Repo is distribution**: Push-sync sends changes to repo for sharing
- **Pull-sync for installation**: New users run pull-sync to install this config

## Agent Recommendations
- **Do not** modify files directly in the repo; always edit locally then push-sync
- Verify that `$PI_EXT_DIR` (default `~/.pi/agent/extensions`) exists before running
- Ensure the repository has a clean working tree before syncing
- After pull-sync or any extension change, restart pi to load updates
- Use push-sync to share changes with the repo
- Use pull-sync to install from this repo to your pi config

## Notes
- Keep the script up‑to‑date; any changes to secret patterns or rsync flags affect validation.
- The repo is a thin wrapper; the real source of truth is the user’s `~/.pi/agent/extensions` directory.

## Commit and Push Instructions
If manual commit is required:
```bash
# Stage changes
sudo -u $USER git add extensions .
# Commit with a descriptive message
sudo -u $USER git commit -m "<commit-message>"
# Push to upstream
sudo -u $USER git push origin main
```
Make sure to use a clear commit message and keep the working tree clean.
