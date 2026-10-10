# Environment and configuration reference

This document is the production inventory of environment and configuration inputs for Zene.
It is generated from Core defaults (`src/core/defaults.ts`), `SecretManager` accessors, and direct `process.env` reads under `src/`.

## How configuration is read

1. Values are stored in `process.env` (including values loaded from `.env` by the process launcher).
2. `SecretManager` (`src/core/helpers/secretManager.ts`) reads keys via `get`, `getOptional`, `getBoolean`, and related helpers, applying defaults from `src/core/defaults.ts` when present.
3. Structured JSON may be supplied as a single environment value (notably `Database`).
4. Boot materializes only `NODE_ENV` and `PublicKey` onto `process.env` when unset (`materializeBootEnv`).

**Restart** is required for almost all keys after change. Do not assume live reload unless a subsystem documents it.

**Secrets:** any key marked sensitive must never be committed or logged.

Test-only harness variables (`ZENE_DATA_INTEGRATION`, `ZENE_TEST_*`, temporary migration helpers used only in local tests) are **not** part of the production contract and are omitted here.

## Production environment variables

| Variable | Type | Default | Required | Secret | Purpose |
|----------|------|---------|----------|--------|----------|
| `NODE_ENV` | string | `production` | no | no | Process environment mode |
| `PublicKey` | string | `builtin Ed25519 public key` | no | no | Default plugin verification public key |
| `DiscordToken` | string | `—` | yes | yes | Discord bot token |
| `BotOwnerIds` | string | `empty` | no | no | Comma-separated Discord user IDs treated as bot owners |
| `DefaultLocale` | string | `en` | no | no | Default locale code |
| `GuildID` | string | `—` | no | no | Optional primary guild id for some features |
| `APIPort` | string | `3000` | no | no | HTTP API listen port |
| `APIHost` | string | `0.0.0.0` | no | no | HTTP API bind host |
| `hotReloadEnabled` | boolean | `false` | no | no | Enable plugin hot-reload behavior when supported |
| `isSharded` | boolean | `false` | no | no | Classic sharding mode indicator |
| `CROSS_HOST` | boolean | `false` | no | no | Enable Cross-Host multi-machine mode |
| `EnableGlobalRatelimit` | boolean | `true` | no | no | Global rate-limit enforcement |
| `AuditFailClosed` | boolean | `false` | no | no | Fail closed on audit write failures when true |
| `allowUnCertifiedPlugins` | boolean | `false` | no | no | Allow loading uncertified/unsigned plugins (security risk) |
| `DisableDefaultSqlite` | boolean | `false` | no | no | Do not auto-provision default SQLite |
| `DisableDefaultSurrealDB` | boolean | `false` | no | no | Do not auto-provision default Surreal main |
| `AutoUpdater` | boolean | `true` | no | no | Enable automatic updater checks |
| `DevBuilds` | boolean | `false` | no | no | Allow development builds in updater policy |
| `SafeUpdate` | boolean | `true` | no | no | Prefer safe-update baseline policy |
| `UpdaterKeepExtra` | boolean | `true` | no | no | Keep extra files according to updater policy |
| `UpdaterAllowForce` | boolean | `false` | no | no | Allow forced updater operations |
| `UpdaterDryRun` | boolean | `false` | no | no | Plan updates without applying |
| `UpdaterBackgroundApply` | boolean | `false` | no | no | Apply updates in background when supported |
| `UpdaterAutoRollback` | boolean | `true` | no | no | Automatic rollback on failed apply |
| `UpdaterDefaultRepo` | string | `lunedusk/Zene` | no | no | Default GitHub repository for updates |
| `UpdaterBranch` | string | `main` | no | no | Default branch for update resolution |
| `UpdaterMaxBackups` | string | `3` | no | no | Maximum retained backups |
| `UpdaterTimeoutMs` | string | `300000` | no | no | Updater operation timeout in ms |
| `UpdaterPluginManifest` | string | `manifest.json` | no | no | Plugin manifest filename for updater |
| `UpdaterMode` | string | `standalone` | no | no | Updater operating mode |
| `UpdaterIntervalMs` | string | `21600000` | no | no | Background check interval ms |
| `UpdaterHealthGraceMs` | string | `900000` | no | no | Post-update health grace period ms |
| `UpdaterNotifyChannel` | string | `—` | no | no | Optional Discord channel id for update notifications |
| `UpdaterPostUpdateCmd` | string | `—` | no | no | Optional shell command after successful update |
| `ErrorCoalesceWindowSec` | string | `60` | no | no | Seconds window for error occurrence coalescing |
| `TokenMasterSecret` | string | `—` | yes | yes | Master secret for token subsystem (required when tokens used) |
| `TokenTTL` | string | `900` | no | no | Default token TTL seconds |
| `TokenMaxTTL` | string | `86400` | no | no | Maximum allowed token TTL seconds |
| `TokenIssuer` | string | `zene` | no | no | JWT/token issuer claim |
| `TokenAudience` | string | `dashboard` | no | no | JWT/token audience claim |
| `CROSS_HOST_HTTP_HOST` | string | `0.0.0.0` | no | no | Cross-Host control HTTP bind host |
| `CROSS_HOST_HTTP_PORT` | string | `8020` | no | no | Cross-Host control HTTP port |
| `CROSS_HOST_MTLS_ENABLED` | boolean | `false` | no | no | Require mTLS for Cross-Host HTTP |
| `CROSS_HOST_INDEX_ENABLED` | boolean | `false` | no | no | Enable Cross-Host index features |
| `CROSS_HOST_API_GATEWAY_ENABLED` | boolean | `true` | no | no | Enable Cross-Host API gateway |
| `CROSS_HOST_LOAD_WEIGHT_GUILD` | string | `1` | no | no | Load weight: guilds |
| `CROSS_HOST_LOAD_WEIGHT_MEMBER` | string | `0.001` | no | no | Load weight: members |
| `CROSS_HOST_LOAD_WEIGHT_EVENT` | string | `10` | no | no | Load weight: events |
| `CROSS_HOST_LOAD_WEIGHT_COMMAND` | string | `20` | no | no | Load weight: commands |
| `CROSS_HOST_LOAD_WEIGHT_SHARD` | string | `0.5` | no | no | Load weight: shards |
| `CROSS_HOST_CLUSTER_SECRET` | string | `—` | no | yes | Shared cluster secret for Cross-Host auth |
| `CROSS_HOST_MACHINE_ID` | string | `—` | no | no | Stable machine identity for this host |
| `CROSS_HOST_ROLE` | string | `—` | no | no | Process role (orchestrator/worker/etc.) |
| `CROSS_HOST_ORCHESTRATOR_URL` | string | `—` | no | no | Orchestrator base URL for workers |
| `CROSS_HOST_TOKEN_TTL_SEC` | string | `—` | no | no | Cross-Host machine token TTL seconds |
| `CROSS_HOST_HEARTBEAT_MS` | string | `—` | no | no | Heartbeat interval ms |
| `CROSS_HOST_DEAD_GRACE_MS` | string | `—` | no | no | Dead-member grace period ms |
| `CROSS_HOST_SUSPECT_AFTER` | string | `—` | no | no | Suspect threshold |
| `CROSS_HOST_TOTAL_SHARDS` | string | `—` | no | no | Total shard count when assigned |
| `CROSS_HOST_MANUAL_SHARDS` | string | `—` | no | no | Manual shard assignment list |
| `CROSS_HOST_ASSIGNMENT_STRATEGY` | string | `—` | no | no | Shard assignment strategy name |
| `CROSS_HOST_COMPAT_MODE` | string | `—` | no | no | Compatibility mode flag/string |
| `CROSS_HOST_MTLS_CA_PATH` | string | `—` | no | yes | mTLS CA certificate path |
| `CROSS_HOST_MTLS_CERT_PATH` | string | `—` | no | yes | mTLS client/server cert path |
| `CROSS_HOST_MTLS_KEY_PATH` | string | `—` | no | yes | mTLS private key path |
| `CROSS_HOST_WORKER_API_HOST` | string | `—` | no | no | Worker API bind host |
| `CROSS_HOST_WORKER_API_PORT` | string | `—` | no | no | Worker API port |
| `CROSS_HOST_WORKER_API_ADVERTISE_HOST` | string | `—` | no | no | Advertised worker API host |
| `CROSS_HOST_API_PROXY_TIMEOUT_MS` | string | `—` | no | no | API proxy timeout ms |
| `CROSS_HOST_QUERY_TIMEOUT_MS` | string | `—` | no | no | Distributed query timeout ms |
| `CROSS_HOST_QUERY_CONCURRENCY` | string | `—` | no | no | Distributed query concurrency |
| `CROSS_HOST_STATS_INTERVAL_MS` | string | `—` | no | no | Stats publish interval ms |
| `CROSS_HOST_REBALANCE_COOLDOWN_MS` | string | `—` | no | no | Rebalance cooldown ms |
| `CROSS_HOST_REBALANCE_MAX_MOVES` | string | `—` | no | no | Max moves per rebalance |
| `CROSS_HOST_REBALANCE_MIN_IMPROVEMENT` | string | `—` | no | no | Minimum improvement threshold |
| `CROSS_HOST_MAX_CONCURRENT_UPDATES` | string | `—` | no | no | Rolling update concurrency |
| `CROSS_HOST_INDEX_RETENTION_DAYS` | string | `—` | no | no | Index retention days |
| `CROSS_HOST_LOAD_IMBALANCE_THRESHOLD` | string | `—` | no | no | Load imbalance threshold |
| `CROSS_HOST_REGION_LABEL_KEY` | string | `—` | no | no | Region label metadata key |
| `Database` | json-string | `—` | no | yes | JSON map of database aliases to engine configs |
| `CoreDataEngine` | string | `—` | no | no | Explicit Core data durable engine selection |
| `CoreDataAlias` | string | `—` | no | no | Explicit Core data connection alias |
| `DiscordIntents` | string | `—` | no | no | Discord gateway intents configuration |
| `LogLevel` | string | `—` | no | no | Logging level (also LOG_LEVEL in some paths) |
| `LOG_LEVEL` | string | `—` | no | no | Alternate logging level env name |
| `LogTZ` | string | `—` | no | no | Timezone for log timestamps when supported |
| `TZ` | string | `—` | no | no | Process timezone |
| `PluginPublicKeys` | string | `—` | no | no | Additional trusted plugin public keys |
| `PLUGIN_SIGNING_KEY` | string | `—` | yes | yes | Private key material for packing/signing plugins |
| `PrivateKey` | string | `—` | no | yes | Legacy/alternate private key env |
| `GatewayMasterKey` | string | `—` | no | yes | Gateway master key when used |
| `GithubPat` | string | `—` | no | yes | GitHub PAT for updater/repo access |
| `GH_TOKEN` | string | `—` | no | yes | Alternate GitHub token env |
| `RepositoryUrl` | string | `—` | no | no | Override repository URL |
| `PluginAssetsOrigin` | string | `—` | no | no | Allowed origin for plugin dashboard assets |
| `BETTER_AUTH_SECRET` | string | `—` | no | yes | Dashboard Better Auth secret when BA adapter is used |
| `DASH_PREVIEW_SECRET` | string | `—` | no | yes | Dashboard preview secret |
| `whitelistedPlugins` | string | `—` | no | no | Comma-separated plugin allowlist when policy uses it |
| `SHARD_LIST` | string | `—` | no | no | Shard list for classic sharding |
| `REDIS_URL` | string | `—` | no | yes | Convenience Redis URL when used by a subsystem |
| `UPDATER_ONLY` | string | `—` | no | no | Run updater-only entry behavior when set |
| `UpdaterOnly` | string | `—` | no | no | Alternate updater-only flag casing |
| `ZENE_DEFAULT_RUNTIME` | string | `—` | no | no | Default plugin runtime preference for policy |
| `ZENE_PLUGIN_ID` | string | `—` | no | no | Runtime host context plugin id (isolated hosts) |
| `ZENE_RUNTIME_ID` | string | `—` | no | no | Runtime host context runtime id (isolated hosts) |

## Variable details (selected critical keys)

### DiscordToken
- **Required** for Discord gateway login.
- **Secret.**
- Read at boot via secret/config accessors.
- Missing value fails Discord login.

### BotOwnerIds
- Comma-separated snowflake user IDs.
- Default empty string (no owners configured).
- Used for owner-gated operations.

### Database
- JSON object mapping **alias → connection config**.
- Not a list of engines; each alias has one `engine` and one `uri`.
- Example:

```json
{
  "main": {
    "uri": "rocksdb://local",
    "engine": "surrealdb",
    "namespace": "main",
    "database": "main"
  }
}
```

- See [Database.md](Database.md).

### TokenMasterSecret
- Required when the token subsystem issues tokens.
- Marked required+sensitive in defaults; deployments that never use tokens still should set a strong value if boot requires it.

### allowUnCertifiedPlugins
- Default `false`.
- When `true`, weakens integrity/trust policy. Production deployments should leave this false.

### CROSS_HOST and CROSS_HOST_*
- `CROSS_HOST` enables multi-machine mode.
- Companion keys configure HTTP control plane, mTLS paths, shard assignment, rebalance, worker advertisement, and load weights.
- Secrets: `CROSS_HOST_CLUSTER_SECRET`, mTLS key material.
- See [CROSS_HOST.md](CROSS_HOST.md).

### CoreDataEngine / CoreDataAlias
- Explicit Core data platform backend selection.
- Invalid engine values fail closed (no silent memory fallback for durable production paths).

### Updater*
- Control check vs apply, dry-run, backups, intervals, and repository identity.
- `AutoUpdater` defaults true; `UpdaterBackgroundApply` defaults false.
- See [UPDATER.md](UPDATER.md).

## JSON / non-env configuration

| Name | Form | Notes |
|------|------|-------|
| `Database` | JSON string in env or config | Alias map; see above |
| `common.json` | File | Shared static configuration where used |
| Plugin `config.json5` / `lang/*.json5` | Plugin files | Merged by loader; not process env |

## CLI and scripts

Package scripts (`npm run build`, `slim-build`, `start`, `pack`, `updater`, …) are defined in `package.json`. They are not environment variables.

Migration script (`src/scripts/migrate-nova-to-surreal.ts`) accepts `NOVA_EXPORT_JSON`, `SURREAL_URI`, `SURREAL_NAMESPACE`, `SURREAL_DATABASE`, `SURREAL_USERNAME`, `SURREAL_PASSWORD`, `SURREAL_TOKEN` for one-shot operations—not general bot configuration.

## Inventory methodology

- Defaults registry: `src/core/defaults.ts` (`ENTRIES`).
- Accessor search: `getOptional`, `getBoolean`, `secrets.get` under `src/`.
- Direct `process.env.*` and `process.env['…']` under `src/`.
- Excluded: keys matching `ZENE_TEST_*`, `ZENE_DATA_INTEGRATION`, and pure test fixtures.

**Documented production keys in this table: 105.**
