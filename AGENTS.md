# AGENTS.md

## Purpose
Synchronise the local `~/.pi/agent/extensions/` directory with this repository and ensure any change is safe before committing.

## Validation / Sync Command
Agents should run the repository‑provided script which:
1. Copies the current extensions from `$HOME/.pi/agent/extensions` into `extensions/`.
2. Scans the copied files for potential secrets.
3. Commits and pushes any changes.
```
./scripts/sync-extensions.sh [commit‑message]
```
If the script exits with a non‑zero code, the change must be aborted.

## Key Checks performed by the script
- Uses `rsync` with `--delete` to keep the repo in sync.
- Runs a `rg` secret‑pattern scan; aborts on matches.
- Commits only if there are staged changes.

## Agent Recommendations
- **Do not** modify files directly; always invoke the above script.
- Verify that `$PI_EXT_DIR` (default `~/.pi/agent/extensions`) exists before running.
- Ensure the repository has a clean working tree before syncing.
- After a successful sync, restart pi to load updated extensions.

## Usage Example
```bash
# After editing extensions locally
./scripts/sync-extensions.sh "chore: update my custom pi extension"
```

## Notes
- Keep the script up‑to‑date; any changes to secret patterns or rsync flags affect validation.
- The repo is a thin wrapper; the real source of truth is the user’s `~/.pi/agent/extensions` directory.
