# Updater

Zene includes an updater subsystem under `src/core/manager/updater` and related scripts (`npm run updater`).

## Capabilities

- Check for available updates according to configured sources
- Plan and stage updates when enabled
- Backup and rollback paths where implemented
- Integrity expectations for updated artifacts

## Configuration

Updater behavior is controlled through environment and configuration keys documented in [ENV Reference.md](ENV%20Reference.md). Distinguish:

- **Check only** versus **apply**
- Background versus interactive modes
- Automatic rollback settings when present

## Safety

- Dry-run when available before destructive applies
- Do not apply untrusted artifacts
- Ensure backups exist before replacing production files
- Restart requirements depend on what changed (Core versus plugin artifacts)

Verify flags and defaults against the current updater implementation before automating production updates.
