# Zene environment and configuration reference

This is a source-oriented reference for configuration keys read by Zene Core and its first-party runtime subsystems at the documentation baseline `c510bbf8fde1fedffd05efe2779ee71e90d5597d`. It distinguishes framework defaults, runtime inputs, sensitive values, plugin-defined settings, and one-shot script inputs. It deliberately does not list test-harness variables as production configuration.

## 1. How values are resolved

### Startup loading

The normal entrypoint imports `dotenv/config` before running Core initialization. On boot, `src/core/defaults.ts` defines framework defaults and `materializeBootEnv()` materializes only `NODE_ENV` and `PublicKey` when those keys are empty/unset. The boot pipeline then assimilates environment settings, expands placeholders, locks SecretManager behavior and runs shared startup preparation.

`SecretManager` in `src/core/helpers/secretManager.ts` stores values in `process.env`. Its accessors are:

- `get(key)`: returns a non-empty string; throws `VaultMissingKeyError` if missing/empty.
- `getOptional(key, fallback?)`: returns the non-empty environment value, otherwise the explicit fallback when passed, otherwise the registered default string when one exists, otherwise `undefined`.
- `getBoolean(key, fallback?)`: parses non-empty `true`, `1`, or `yes` (case-insensitive/trimmed) as true; other non-empty values are false. When empty/unset, uses a registered boolean/string default where available, then the caller fallback.
- `has(key)` / `keys()`: inspect current non-empty process environment keys.
- `set` / `replaceExpanded`: writes to `process.env` and blocks overwriting an already sealed key after lock.
- `applyEnvReload(mutations, allowSet)`: updates only allowlisted keys and never mutates identity keys `DiscordToken` or `DiscordIntents` through that path.

The vault does **not** encrypt all values in process memory or scrub sensitive settings from `process.env`. In-process code may read those values directly. Treat all in-process plugins as trusted with respect to parent-process secrets.

### Configuration precedence

The non-secret resolver in `src/core/config/precedence.ts` documents this order: runtime override → non-empty `process.env` → supplied `common.json` value → framework default → absent. It does not read secret values through the SecretManager and should not be used to bypass secret-specific access policy.

Plugin config (`configuration/*.json5`), language files and some subsystem configuration sections are separate file-based inputs. They are not all environment variables and should not be placed into `.env` unless a specific parser says so.

### Restart and reload

Treat changing an environment variable as a restart-required operation unless the specific subsystem implements an approved reload path. Config/language/emoji reloads do not make every process environment key hot-reloadable. The updater also excludes `.env`, `.env.local` and other operational config files from ordinary code replacement.

## 2. Types and safety markers

- **String:** environment values arrive as strings, even where parsers later interpret numbers.
- **Boolean:** usually parsed using `SecretManager.getBoolean`; many ad hoc script flags instead compare strings such as `'1'`.
- **JSON string:** must be valid JSON on one line unless the dotenv parser is explicitly configured for multiline values.
- **Secret:** credential or private material. Store in secret management; never commit or log it.
- **Runtime-managed:** an isolated host or launcher may set it. Do not set it manually unless operating that runtime directly.
- **Script-only:** only consumed by a maintenance/migration command, not ordinary bot boot.

A dash (`—`) below means no general default is registered for that key in `defaults.ts`, unless the description names a subsystem fallback. It does not automatically mean the key is required at startup.

## 3. Process, identity and HTTP

| Key | Default / fallback | Purpose and behavior | Sensitivity |
|---|---|---|---|
| `NODE_ENV` | `production` | Process mode. Materialized during boot when unset. Also affects production-sensitive validation/placeholder behavior and logging. | No |
| `PublicKey` | Built-in Ed25519 public key | Default plugin artifact verification key. Per-plugin `PluginPublicKeys` entries and wildcard may override it. Public verification material, not a signing secret. | Public key |
| `DiscordToken` | Required; no usable default | Discord bot token. Required for gateway login. Identity key cannot be changed through sanctioned env reload. | **Secret** |
| `DiscordIntents` | Intent builder default when absent | Optional comma-separated intent selection used by `src/index.ts`; validate against the installed Discord intent builder. Treat identity changes as restart-only. | Not usually secret, but operationally sensitive |
| `BotOwnerIds` | Empty string | Comma-separated Discord user IDs consulted by owner-sensitive permission paths. Only place trusted operator IDs here. | Personal/admin identity data |
| `DefaultLocale` | `en` | Master/default locale used in language lookups and fallback selection. | No |
| `GuildID` | — | Optional primary guild ID used by some command-sync/feature paths. Guild-specific behavior may differ from global mode. | No |
| `APIPort` | `3000` | Main HTTP API listen port. Parsed as a number by callers; invalid strings can cause startup/config issues. | No |
| `APIHost` | `0.0.0.0` | Main HTTP server bind host. Binding all interfaces exposes the service on all available interfaces unless firewalled. | No |
| `DashboardMode` | `auto` | Separate dashboard process lifecycle: `auto` (start Vite/prod host when apps/web is available), `true` (require dashboard or fail Core startup), `false` (never start dashboard). Invalid values fail configuration. Core API remains on `APIPort`. | No |
| `DashboardPort` | `5173` | TCP port for the Vite dev server or production `dashboard-host` process. Independent of `APIPort`. | No |
| `ApiPublicUrl` | derived | Optional absolute Core API origin advertised to the dashboard host (defaults to http://127.0.0.1:$APIPort when APIHost is a wildcard bind). | No |
| `DashboardPublicUrl` | derived | Optional public dashboard origin (defaults to http://127.0.0.1:$DashboardPort). | No |
| `GatewayMasterKey` | (required when configured) | Bearer master key for the api plugin when `auth.masterKeySource=env`. Distinct from the rotating dashboard-service runtime key. | Yes |
| `hotReloadEnabled` | `false` | Enables supported config/language/emoji hot-reload behavior. Does not make arbitrary env updates safe. | No |
| `isSharded` | `false` | Indicates classic shard deployment to mode/requirements logic. It is not by itself proof that a shard manager is actually running. | No |
| `SHARD_LIST` | Runtime-dependent | Used by classic sharding/worker detection. Should be set by the sharding launcher, not used as a casual user preference. | Runtime-managed |
| `UPDATER_ONLY` | Unset | If string equals `1`, starts updater-only mode. | No |
| `UpdaterOnly` | Unset | Alternate-casing updater-only flag; if string equals `1`, starts updater-only mode. | No |

## 4. Plugin trust and packaging

| Key | Default / fallback | Purpose and behavior | Sensitivity |
|---|---|---|---|
| `allowUnCertifiedPlugins` | `false` | Allows the explicit uncertified/bypass trust path when the implementation permits it. Enabling increases risk; keep false for normal production. | Security-sensitive toggle |
| `whitelistedPlugins` | — | Comma-separated plugin directory/folder names used by the trust gate's allowlist path. It is not an arbitrary plugin ID capability grant. | No, but security-sensitive |
| `PluginPublicKeys` | — | JSON object mapping plugin IDs or `*` to public verification keys. Invalid JSON is ignored with a warning by the key parser. | Public key material |
| `PrivateKey` | — | Legacy/alternate signing private key source consulted by the manifest packer. | **Secret** |
| `PLUGIN_SIGNING_KEY` | — | Signing private key material consulted by the manifest packer; prefer a protected secret source. | **Secret** |
| `PluginAssetsOrigin` | — | Origin allowlist/selection for plugin dashboard assets when the relevant subsystem uses it. Validate exact origin semantics before deploying. | No |
| `ZENE_DEFAULT_RUNTIME` | `process` in runtime policy | Default plugin runtime selector. Recognized levels are `in-process`, `worker`, `process`, `container`, `external`; invalid values normalize to `process` in the current resolver. | Security-sensitive choice |
| `ZENE_PLUGIN_RUNTIME_<PLUGIN_ID>` | Falls through to `ZENE_DEFAULT_RUNTIME` / `process` | Per-plugin runtime preference. The plugin ID is normalized by replacing non-alphanumeric characters with `_` and uppercasing. Runtime policy/authenticated floors can still reject a choice. | Security-sensitive choice |
| `ZENE_PLUGIN_ID` | Required by isolated host bootstrap | Runtime-managed plugin ID passed to the process host. Missing value makes `processMain` exit with a startup error. | Runtime-managed |
| `ZENE_RUNTIME_ID` | Required by isolated host bootstrap | Runtime-managed instance identifier. Missing value makes `processMain` exit with a startup error. | Runtime-managed |

## 5. Logging, audit and error coalescing

| Key | Default / fallback | Purpose and behavior | Sensitivity |
|---|---|---|---|
| `LogLevel` | Logger default | Preferred log-level setting read by the logger/default system. | No |
| `LOG_LEVEL` | No registered default | Alternate logging-level spelling used by some code paths. Confirm precedence before setting both keys. | No |
| `LogTZ` | `TZ`, then `UTC` in logger path | Time zone for rendered log timestamps where supported. Examples include `Asia/Kolkata` or `UTC`. | No |
| `TZ` | OS/runtime default; logger fallback is UTC | Process timezone, also a fallback for log timestamps. Not every timestamp stored in data is rendered in this zone. | No |
| `AuditFailClosed` | `false` | When true, `audit.record()` rethrows a persistence failure; when false, audit recording returns null after logging failure. Choose deliberately for privileged actions. | Security-policy toggle |
| `ErrorCoalesceWindowSec` | `60` | Error occurrence coalescing window in seconds. Invalid/too-small values normalize to 60; current store clamps valid values to 1–3600 seconds. | No |
| `GatewayMasterKey` | — | Master key consulted by the metrics authorization path when configured. | **Secret** |

## 6. Database, storage and subsystem aliases

| Key | Default / fallback | Purpose and behavior | Sensitivity |
|---|---|---|---|
| `Database` | `{}` if absent | JSON object mapping alias to `{uri, engine?, poolSize?, maxRetries?, namespace?, database?, username?, password?, token?}`. Invalid JSON is logged and configured aliases may not initialize. | **Potentially secret**: URI/password/token |
| `DisableDefaultSqlite` | `false` | Prevents default local SQLite `main` provisioning. Core features that depend on SQLite can be unavailable without a replacement backend. | No |
| `DisableDefaultSurrealDB` | `false` | Prevents default embedded SurrealDB `main` provisioning. | No |
| `CoreDataEngine` | Auto-select when unset | Explicit Core data adapter engine: SQLite/Postgres/Mongo/Surreal/Redis aliases accepted by `backendSelector.ts`. Unknown explicit names fail closed. | No |
| `CoreDataAlias` | `main` | Alias constraint for Core data backend selection. Alias must be connected; it is not a database name. | No |
| `PermissionsEngine` | Auto-select/config | Explicit permission subsystem engine input used by backend resolution. | No |
| `PermissionsDbAlias` | `main` | Permission backend alias. | No |
| `TokenEngine` | Auto-select/config | Explicit token persistence engine. | No |
| `TokenDbAlias` | `main` | Token persistence alias. | No |
| `DashboardEngine` | Auto-select/config | Dashboard persistence engine input where the adapter uses environment-based backend selection. | No |
| `DashboardDbAlias` | `main` | Dashboard persistence alias. | No |
| `GuildGateEngine` | Core/backend resolution fallback | Backend selector input for guild-gate persistence. | No |
| `GuildGateDbAlias` | `main` / resolved Core alias | Guild-gate persistence alias. Inspect resolver path if Core data backend is Surreal/Redis, because gate backend support is narrower. | No |
| `REDIS_URL` | Subsystem-specific fallback, commonly local Redis | Convenience Redis URL read by the relevant first-party subsystem when no explicit source takes precedence. It does not replace the alias map used by Cross-Host's `resolveCrossHostRedis()`. | **Potentially secret** |

### `Database` example

```dotenv
Database={"main":{"uri":"rocksdb://local","engine":"surrealdb","namespace":"main","database":"main"}}
```

That example requests embedded SurrealDB for the `main` alias. In Cross-Host mode embedded/file-local engines are prohibited. For remote SurrealDB, use the appropriate remote protocol URI and authentication settings. A separate Redis alias is normally used for Cross-Host coordination.

## 7. Token subsystem

| Key | Default / fallback | Purpose and behavior | Sensitivity |
|---|---|---|---|
| `TokenMasterSecret` | No secure default; token plugin requires at least 32 characters | Master secret for token signing/verification. The token handler fails initialization if absent/too short. Use high-entropy random material and plan key rotation. | **Secret** |
| `TokenTTL` | `900` seconds | Default token lifetime used by token-manager construction. | No |
| `TokenMaxTTL` | `86400` seconds | Maximum token lifetime used by the subsystem where applied. | No |
| `TokenIssuer` | `zene` | Token issuer claim (`iss`). | No |
| `TokenAudience` | `dashboard` | Token audience claim (`aud`). | No |

These numeric values are stored as strings and parsed by token subsystem code. Verify how invalid values are handled before deploying unusual formats.

## 8. Updater controls

| Key | Default / fallback | Purpose and behavior | Sensitivity |
|---|---|---|---|
| `AutoUpdater` | `true` | Enables the pre-boot update check path unless disabled. | High-impact operational toggle |
| `DevBuilds` | `false` | Allows development builds under updater policy where supported. | High-impact operational toggle |
| `SafeUpdate` | `true` | Selects the updater's safe-update baseline policy. | No |
| `UpdaterKeepExtra` | `true` | Controls keeping extra files according to updater planning. | No |
| `UpdaterAllowForce` | `false` | Allows forced updater operations. Keep disabled except for deliberate recovery. | High-impact operational toggle |
| `UpdaterDryRun` | `false` | Plans without applying the update. Useful for review. | No |
| `UpdaterBackgroundApply` | `false` | Enables background apply behavior where supported. Applying updates and exiting/restarting a process is higher impact than notification/check. | High-impact operational toggle |
| `UpdaterAutoRollback` | `true` | Enables automatic rollback path for failed update application where supported. | No |
| `UpdaterDefaultRepo` | `lunedusk/Zene` | Default GitHub repository identifier. | No |
| `UpdaterBranch` | `main` | Default branch for resolution. | No |
| `UpdaterMaxBackups` | `3` | Maximum backups retained by updater configuration. Parsed as integer. | No |
| `UpdaterTimeoutMs` | `300000` | Updater operation timeout in milliseconds. | No |
| `UpdaterPluginManifest` | `manifest.json` | Plugin manifest path/name used by updater operations. | No |
| `UpdaterMode` | `standalone` | Updater mode (`standalone` or `background` in the declared config type); unexpected strings should be avoided. | No |
| `UpdaterIntervalMs` | `21600000` (6 hours) | Background update/check interval in milliseconds where the mode uses it. | No |
| `UpdaterHealthGraceMs` | `900000` (15 minutes) | Time allowed for post-update health confirmation. | No |
| `UpdaterNotifyChannel` | — | Optional Discord channel ID for updater notifications. | No |
| `UpdaterPostUpdateCmd` | — | Shell command invoked after a successful update in supported flow. Treat as arbitrary-code execution authority. | **High risk** |
| `GithubPat` | — | GitHub personal access token used for update/repository access. | **Secret** |
| `GH_TOKEN` | — | Alternate GitHub token source when `GithubPat` is absent. | **Secret** |
| `RepositoryUrl` | — | Repository URL override used by updater configuration. | No |

For commands/flags such as dry-run, force, baseline-only, target tags, install-plugin, plugin-tag and restore-backup, see [Updater](UPDATER.md). Environment keys are not the only updater inputs; CLI flags and update-state files matter.

## 9. Cross-Host cluster configuration

Cross-Host is optional. `CROSS_HOST=true` enables mode selection and shared-storage validation. The orchestrator requires a cluster secret. Workers need a reachable orchestrator and a Redis control-plane alias. Numeric settings are strings in the environment and are parsed/validated by `src/core/crosshost/env.ts`.

| Key | Default / parser behavior | Purpose | Sensitivity |
|---|---|---|---|
| `CROSS_HOST` | `false` | Enables multi-machine deployment logic and mode detection. | Security-sensitive toggle |
| `CROSS_HOST_ROLE` | — | Expected `orchestrator` or `worker`; anything else resolves to no recognized role. | No |
| `CROSS_HOST_CLUSTER_SECRET` | Empty; required by orchestrator | Shared cluster authentication secret. | **Secret** |
| `CROSS_HOST_MACHINE_ID` | May resolve to null | Stable machine identifier; ensure uniqueness. | No |
| `CROSS_HOST_ORCHESTRATOR_URL` | May resolve to null | Orchestrator base URL used by workers. | Internal topology information |
| `CROSS_HOST_HTTP_HOST` | `0.0.0.0` | Orchestrator control-plane bind host. | No |
| `CROSS_HOST_HTTP_PORT` | `8020`; must be integer 1–65535 | Orchestrator control-plane port. Invalid values throw. | No |
| `CROSS_HOST_COMPAT_MODE` | `strict` unless exactly `range` | Compatibility mode for Core/plugin version comparisons. | No |
| `CROSS_HOST_TOKEN_TTL_SEC` | `3600`; positive integer | Machine-token lifetime in seconds. | No |
| `CROSS_HOST_MTLS_ENABLED` | `false` | Turns on mutual TLS-related configuration path. | Security-sensitive toggle |
| `CROSS_HOST_MTLS_CA_PATH` | null | CA certificate path. | Path/security material |
| `CROSS_HOST_MTLS_CERT_PATH` | null | Certificate path. | Path/security material |
| `CROSS_HOST_MTLS_KEY_PATH` | null | Private key path. | **Secret/private key** |
| `CROSS_HOST_HEARTBEAT_MS` | `5000`; positive integer | Worker heartbeat interval in milliseconds. | No |
| `CROSS_HOST_SUSPECT_AFTER` | `3`; positive integer | Missed-heartbeat multiplier before suspicion. | No |
| `CROSS_HOST_DEAD_GRACE_MS` | `15000`; positive integer | Additional grace interval before a worker is treated as dead. | No |
| `CROSS_HOST_TOTAL_SHARDS` | unset/null or positive integer | Overrides gateway-reported total shards. | No |
| `CROSS_HOST_MANUAL_SHARDS` | `{}` when empty; JSON object machine ID → number array | Manual shard assignment mapping. Must be valid JSON with non-negative integer shard IDs. | No |
| `CROSS_HOST_ASSIGNMENT_STRATEGY` | `least_loaded` fallback | `least_loaded`, `sticky`, `manual`, or `region_aware`; unknown values fall back to `least_loaded`. | No |
| `CROSS_HOST_LOAD_WEIGHT_GUILD` | `1`; non-negative number | Guild contribution to worker load score. | No |
| `CROSS_HOST_LOAD_WEIGHT_MEMBER` | `0.001`; non-negative number | Member contribution to load score. | No |
| `CROSS_HOST_LOAD_WEIGHT_EVENT` | `10`; non-negative number | Event-rate contribution to load score. | No |
| `CROSS_HOST_LOAD_WEIGHT_COMMAND` | `20`; non-negative number | Command-rate contribution to load score. | No |
| `CROSS_HOST_LOAD_WEIGHT_SHARD` | `0.5`; non-negative number | Shard-count contribution to load score. | No |
| `CROSS_HOST_STATS_INTERVAL_MS` | `900000`; positive integer | Worker stats publishing interval. | No |
| `CROSS_HOST_REBALANCE_COOLDOWN_MS` | `60000`; positive integer | Minimum rebalance interval. | No |
| `CROSS_HOST_LOAD_IMBALANCE_THRESHOLD` | `0.25`; non-negative number | Load imbalance threshold below which rebalance may stop. | No |
| `CROSS_HOST_REBALANCE_MAX_MOVES` | `32`; positive integer | Upper move count per rebalance. | No |
| `CROSS_HOST_REBALANCE_MIN_IMPROVEMENT` | `0.05`; non-negative number | Minimum score improvement required for moves. | No |
| `CROSS_HOST_MAX_CONCURRENT_UPDATES` | `1`; positive integer | Concurrent update operations allowed. | No |
| `CROSS_HOST_REGION_LABEL_KEY` | `region` | Worker label key used by the region-aware strategy. | No |
| `CROSS_HOST_INDEX_ENABLED` | `false` | Enables optional secondary audit/error index. | No |
| `CROSS_HOST_INDEX_RETENTION_DAYS` | `14`; positive integer | Retention for the optional index. | No |
| `CROSS_HOST_API_GATEWAY_ENABLED` | `true` | Enables Cross-Host API gateway feature. | No |
| `CROSS_HOST_API_PROXY_TIMEOUT_MS` | `30000`; positive integer | API proxy request timeout. | No |
| `CROSS_HOST_WORKER_API_HOST` | `0.0.0.0` | Worker API bind host. | No |
| `CROSS_HOST_WORKER_API_PORT` | `APIPort` if set, else `3000`; positive integer | Worker API bind port. | No |
| `CROSS_HOST_WORKER_API_ADVERTISE_HOST` | null | Optional externally advertised worker API host. | Internal topology information |
| `CROSS_HOST_QUERY_TIMEOUT_MS` | `5000`; positive integer | Distributed query timeout. | No |
| `CROSS_HOST_QUERY_CONCURRENCY` | `16`; positive integer | Distributed query concurrency bound. | No |

Redis resolution reads `Database`, prefers an alias named `crosshost` with `redis://`/`rediss://` protocol or `engine: redis`, and falls back to `main` if it is Redis. It does not infer a shared Redis from an arbitrary other alias. See [Cross-Host](CROSS_HOST.md).

## 10. Dashboard and other subsystem settings

| Key | Default / fallback | Purpose | Sensitivity |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | — | Secret for the dashboard Better Auth path when the relevant adapter is enabled. | **Secret** |
| `DASH_PREVIEW_SECRET` | — | Secret used by dashboard preview functionality. | **Secret** |
| `EnableGlobalRatelimit` | `true` | Global rate-limit enforcement flag consumed by the relevant subsystem. | No |

## 11. Script-only inputs (not ordinary bot configuration)

The one-shot script `src/scripts/migrate-nova-to-surreal.ts` accepts the following environment values:

| Key | Purpose | Security note |
|---|---|---|
| `NOVA_EXPORT_JSON` | Path to the exported JSON file consumed by the migration script. | The file can contain production data; protect it. |
| `SURREAL_URI` | Migration target URI; source fallback is `rocksdb://local`. | May carry credentials; do not log complete URI. |
| `SURREAL_NAMESPACE` | Migration target namespace. | Usually not secret. |
| `SURREAL_DATABASE` | Migration target database. | Usually not secret. |
| `SURREAL_USERNAME` | Migration target login name. | May reveal infrastructure metadata. |
| `SURREAL_PASSWORD` | Migration target password. | **Secret** |
| `SURREAL_TOKEN` | Alternative migration target token authentication. | **Secret** |

These are specific to the script and should not be copied into the ordinary production `.env` template unless the migration command is actually being run.

## 12. Runtime and tooling inputs

Some environment values are injected by a launcher, consumed by local web tooling, or read by generic plugin requirement logic rather than being a fixed user-facing Core configuration contract. Examples include `PATH`, `NODE_OPTIONS` (restricted in the runtime environment constructor), `VITE_API_PROXY`, Node test-runner settings, runtime IDs, and plugin-specific keys. They are not a reason to document every arbitrary key as a Zene configuration variable.

`RegisterRequirements.env` and `envTruthy` can inspect additional named environment keys at runtime; the set is determined by the plugin author. These dynamic names are not a finite built-in environment inventory.

## 13. Boolean, numeric and JSON parsing gotchas

- Boolean accessors treat `true`, `1` and `yes` as true; a non-empty `false`, `no`, or misspelled value becomes false. Some scripts compare exactly to `1` instead.
- Numeric values are often strings. Invalid integer/number input may trigger a thrown validation error, use a subsystem-specific fallback, or produce a `NaN` if the caller does not validate. Read the named parser's implementation.
- `Database`, `PluginPublicKeys`, and `CROSS_HOST_MANUAL_SHARDS` are JSON contracts. Quote/escape them correctly in `.env`.
- `PluginPublicKeys` should be a JSON object, not an array. Invalid content is ignored by the public-key parser after a warning rather than accepted as a key map.
- Paths are interpreted by the current process/container filesystem. A valid path on one host may not exist on another.

## 14. Secret-handling baseline

Never commit actual values for `DiscordToken`, `TokenMasterSecret`, `CROSS_HOST_CLUSTER_SECRET`, `PLUGIN_SIGNING_KEY`, `PrivateKey`, GitHub tokens, dashboard auth secrets, DB passwords/tokens or TLS private key material. Do not include a credential-bearing `Database` URI in a screenshot/issue. Logs should name aliases and safe error categories rather than complete URIs.

## 15. Inventory scope and verification

This document covers fixed Core/subsystem settings found in `src/core/defaults.ts`, direct `process.env` reads, `SecretManager` accessors, backend selection, runtime policy, updater, Cross-Host, dashboard and maintenance-script configuration visible at the baseline commit. Environment keys declared dynamically by plugins and generic requirement predicates cannot be enumerated as a finite built-in list. Test-only harness flags are intentionally excluded.
