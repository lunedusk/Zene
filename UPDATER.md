# Update planning, application and recovery

## 1. Components

Updater implementation lives under `src/core/manager/updater/`; CLI startup and updater-only behavior are in `src/index.ts`. The updater has configuration, GitHub/source resolution, planning, baseline/state persistence, apply engine, plugin layout and plugin-source parsers, backup/rollback health state and receipt generation.

The updater can assess Core files and plugin decisions separately. A successful plan does not mean the application stage has already happened. Background behavior is not identical to an explicit CLI invocation, and update application can require a clean process restart.

## 2. Configuration

Important settings:

- `AutoUpdater=true`: enables the pre-boot updater check path by default.
- `DevBuilds=false`: development build inclusion is disabled by default.
- `SafeUpdate=true`: safe-update planning policy.
- `UpdaterKeepExtra=true`: controls how extra files are handled.
- `UpdaterAllowForce=false`: force mode is disabled by default.
- `UpdaterDryRun=false`: planner is not globally forced into dry-run by default; command-line dry-run is also available.
- `UpdaterBackgroundApply=false`: background apply is opt-in.
- `UpdaterAutoRollback=true`: automatic rollback is enabled where the apply path supports it.
- `UpdaterDefaultRepo=lunedusk/Zene`, `UpdaterBranch=main`: default repository/branch.
- `UpdaterMaxBackups=3`: retained backup count.
- `UpdaterTimeoutMs=300000`: timeout bound.
- `UpdaterIntervalMs=21600000`: default six-hour interval.
- `UpdaterHealthGraceMs=900000`: 15-minute health grace window.
- `UpdaterPluginManifest=manifest.json`: default plugin manifest filename used by updater paths.
- `UpdaterMode=standalone`: declared updater mode.
- `UpdaterNotifyChannel`: optional Discord channel for notifications.
- `UpdaterPostUpdateCmd`: optional post-update shell command; treat as high authority.
- `GithubPat` or `GH_TOKEN`: optional GitHub API token source.
- `RepositoryUrl`: optional repository URL override.

The updater also consults `PublicKey` and `PluginPublicKeys` for plugin trust context. Secrets should never be embedded in an updater log or receipt.

## 3. CLI inputs

The entrypoint recognizes updater-only mode with `--updater`, `UpdaterOnly=1`, or `UPDATER_ONLY=1`. Updater execution can parse flags including `--force`, `--dry-run` / `--dryRun`, `--baseline-only` / `--baselineOnly`, `--downgrade`, `--list-backups` / `--listBackups`, `--install-plugin`, `--target`, `--plugin-tag` / `--pluginTag`, and `--restore-backup` / `--restoreBackup`.

Confirm the exact arguments supported by `runUpdater()` for your checked-out version; not every flag is meaningful in every mode. Prefer a dry-run plan before any production mutation.

## 4. Planning model

The `UpdatePlan` shape includes source/target tags and commits, `allowed` and `reason`, dirty file list, plugin decisions, files to overwrite/add/keep, dry-run/baseline-only flags, install-plugin selection and optional target/downgrade data. `PluginDecision` distinguishes `update`, `leave`, `add`, `skip`, and `remove`, with paths, reasons and optional source/layout metadata.

A plan should be reviewed for:

- blocked local edits (`DirtyFile` records and reasons);
- unexpected remove/overwrite actions;
- target release/tag and commit identity;
- plugin source/repository/tag compatibility;
- backup preconditions;
- dependency rebuild/install behavior;
- health check and rollback plan.

`safeUpdate` does not mean arbitrary content is safe, and `UpdaterAllowForce` should not be enabled merely to bypass an unexplained rejection.

## 5. State, backups and rollback

Updater types include baseline metadata with per-file hashes/sizes, pending-health state, apply phases, update receipts and backup metadata. A receipt includes an ID/time/duration, mode, decision/allowance, dry-run, source/target details, aggregate Core file operations, plugin actions and optional backup/dependency-install result fields.

Treat backup directories, updater state and health markers as operationally important. Ensure backups live on protected storage and test restoration in a non-production copy before depending on rollback during an incident. A backup process that was never restored in a test is not proven recovery capability.

## 6. Protected paths and secrets

`HARD_EXCLUDES` includes `node_modules`, `.git`, `.github`, `.data`, logs, configuration, `.env`/environment variants, editor folders, coverage/cache directories and `common.json`. These exclusions help preserve operational state during Core updates. Review the actual constant and planner path before assuming any custom file is protected.

`UpdaterPostUpdateCmd` runs shell behavior and must be operator-controlled. PATs, signing private keys, DB files, environment files and backups must not be copied into public update artifacts.

## 7. Applying and validating an update

1. Identify the current tag/commit and local modifications.
2. Run a dry-run plan.
3. Review Core file changes and every plugin action.
4. Verify artifact integrity/key compatibility and backup availability.
5. Apply only when the plan is allowed and expected.
6. Allow the intended restart/rebuild flow to finish.
7. Verify database health, plugin boot statuses, command sync, HTTP health, metrics and updater health confirmation.
8. Preserve receipt/log details while redacting all secrets.
9. If health fails, use the tested rollback procedure rather than manually overwriting state by guesswork.

## 8. Background operation

Background check/notify and background apply should not be conflated. `UpdaterBackgroundApply` defaults false; explicit opt-in has higher impact because code may be changed and the process may exit/restart. Keep the apply decision separate from notification logic and validate behavior under failure, interrupted network and failed post-update health.
