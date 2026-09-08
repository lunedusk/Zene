# Zene — Environment Variable Reference

> **Framework Version:** Zene v0.5.6
> **Last Updated:** 2026
> **Node.js Requirement:** ≥ 20

This document is the complete reference for every environment variable recognized by the Zene framework. Variables are read from your `.env` file at startup via `dotenv` and managed through the internal `secretManager`. Once the application boots, the secret store is locked — changes to `.env` require a full restart to take effect.

---

## Table of Contents

1. [How to Use This Document](#1-how-to-use-this-document)
2. [Configuration Sources — `.env` vs `common.json`](#2-configuration-sources--env-vs-commonjson)
3. [Core Identity](#3-core-identity)
4. [Cryptographic Keys & Plugin Integrity](#4-cryptographic-keys--plugin-integrity)
5. [Discord Connection](#5-discord-connection)
6. [Logging](#6-logging)
7. [HTTP API Server](#7-http-api-server)
8. [Database](#8-database)
9. [Plugins](#9-plugins)
10. [Internationalisation](#10-internationalisation)
11. [Rate Limiting](#11-rate-limiting)
12. [Hot Reload](#12-hot-reload)
13. [Auto Updater](#13-auto-updater)
14. [Authentication & Tokens](#14-authentication--tokens)
15. [Full `.env` Template](#15-full-env-template)
16. [Quick-Reference Table](#16-quick-reference-table)
17. [Cross-Host / Orchestrator](#17-cross-host--orchestrator)

---

## 1. How to Use This Document

Each variable entry follows this structure:

| Field | Meaning |
|---|---|
| **Required** | Whether the bot will refuse to start if this is absent |
| **Default** | The value used when the variable is not set |
| **Safe to Change** | Whether a live change (followed by restart) is low-risk |
| **Breaking Risk** | Whether changing this can cause data loss, auth failures, or outages |
| **Recommended Action** | What you should actually do with this variable |

> ⚠️ **Danger** entries are variables where an incorrect value can cause **data corruption, bot bans, plugin rejection, or security vulnerabilities**. Read the full description before touching them.

---

## 2. Configuration Sources — `.env` vs `common.json`

Zene supports **two ways** to supply configuration values. Understanding how they interact is essential before you set anything up.

### Option A — `.env` File (Standard)

The standard approach. Create a `.env` file at the project root. Values are loaded at startup by `dotenv` and read through the `secretManager`. The secret store is **locked after boot** — no live changes without a restart.

```
project-root/
├── .env          ← your configuration lives here
├── plugins/
└── ...
```

This is the recommended approach for all production deployments and most development setups.

### Option B — `common.json` (Alternative Config Source)

`common.json` is a structured JSON file at the project root that gives you a **typed, panel-friendly alternative** to `.env`. It is processed by the `Common777` internal system during the very first phase of bootstrap — before the plugin system, before Discord login, before anything else.

```
project-root/
├── common.json   ← alternative to .env
├── plugins/
└── ...
```

#### File Structure

`common.json` must always contain an `__info__` block with `__author__` set to exactly `"Lunedusk"`. The framework validates this on every boot and will exit with a security error if it is missing or incorrect — this is an integrity lock to prevent accidental use of a foreign config file.

```json
{
    "__info__": {
        "__author__": "Lunedusk",
        "version": "auto"
    },
    "ENVSettings": false,
    "DiscordToken": "your_bot_token_here",
    "DiscordIntents": ["Guilds", "GuildMessages", "MessageContent"],
    "DefaultLocale": "en",
    "APIPort": 3000,
    "TZ": "UTC",
    "Database": {"main": {"uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main"}}
}
```

> ℹ️ The `version` field inside `__info__` is **always overwritten** by the framework with the value from `package.json` at boot. You can set it to anything; it will be replaced.

#### The `ENVSettings` Switch

This is the key field that controls how `common.json` interacts with `process.env`:

| Value | Behaviour |
|---|---|
| `true` | **Respect `.env` / existing environment.** `common.json` is loaded but none of its values are written to `process.env`. Effectively a no-op for config injection — only the `__info__` validation and caller identity lock run. |
| `false` | **Inject into environment.** All fields in `common.json` (except `__info__` and `ENVSettings` itself) are serialized and written into `process.env`, overriding or supplementing any `.env` values. |
| *(absent)* | `common.json` is parsed and validated but **no injection occurs** — same effect as `true`. |

#### Value Serialization Rules

When `ENVSettings=false`, values are converted to strings before being written to `process.env`:

| JSON Type | Serialized As |
|---|---|
| `string` | Written as-is |
| `number` / `boolean` | Converted via `String()` |
| `Array` | Joined with commas — `["Guilds", "GuildMessages"]` → `"Guilds,GuildMessages"` |
| `object` | Serialized with `JSON.stringify()` — suitable for `Database` |
| `null` / `undefined` | Skipped entirely |

#### Which Fields Can Go in `common.json`?

Any environment variable documented in this reference can be placed in `common.json` as a top-level key. The field names are identical. Array-typed variables (like `DiscordIntents`) can be provided as a native JSON array instead of a comma-separated string — the serialization step handles the conversion automatically.

```json
{
    "__info__": { "__author__": "Lunedusk", "version": "auto" },
    "ENVSettings": false,

    "NODE_ENV": "production",
    "BotName": "MyBot",
    "DiscordToken": "your_token",
    "DiscordIntents": ["Guilds", "GuildMessages", "MessageContent", "GuildMembers"],
    "LogLevel": "info",
    "TZ": "UTC",
    "APIPort": 3000,
    "isSharded": false,
    "DefaultLocale": "en",
    "EnableGlobalRatelimit": true,
    "hotReloadEnabled": false,
    "allowUnCertifiedPlugins": false,
    "Database": {
        "main": { "uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main" }
    },
    "PublicKey": "MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ="
}
```

> ⚠️ **Do not put `PrivateKey` in `common.json`.** The same rule that applies to `.env` applies here — the signing key must never live on a production server. If `common.json` is committed to source control or readable by a hosting panel, `PrivateKey` in it is a serious security exposure.

#### Security: Caller Identity Lock

`Common777` performs a **process entry-point lock** on first bootstrap. It records the `process.argv[1]` path of the process that called it and stores it. On every subsequent call to `common777.get()`, it re-checks the entry point. If the path has changed (which would indicate a suspicious runtime injection), the process exits immediately with a security error. You cannot work around this — it is by design.

#### `common.json` vs `.env` — When to Use Which

| Situation | Use |
|---|---|
| Self-hosted VPS / bare metal with SSH access | `.env` |
| Control panel / hosting dashboard (e.g. Pterodactyl) that supports JSON config files | `common.json` with `ENVSettings=false` |
| Control panel that has its own env variable injection | `common.json` with `ENVSettings=true` (let the panel handle env) |
| Development machine | Either — `.env` is simpler |
| You want typed arrays for `DiscordIntents` without comma-string formatting | `common.json` |

#### Precedence

If both `.env` and `common.json` exist and `ENVSettings=false`, `common.json` values are written into `process.env` **after** `dotenv` has already loaded `.env`. This means **`common.json` wins** on any key that appears in both files when `ENVSettings=false`. If `ENVSettings=true`, `.env` values are untouched and take precedence.

---

## 3. Core Identity

### `NODE_ENV`

Controls the application runtime mode. Affects log verbosity, TypeORM auto-sync behaviour, and various internal safety checks.

| | |
|---|---|
| **Required** | No |
| **Default** | `production` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Leave as `production` in deployment. Set to `development` on a local machine only. |

**Accepted values:** `production`, `development`

When set to `development`, the log level defaults to `debug` (verbose), TypeORM will auto-sync database tables, and certain safety guards are relaxed. Never run a public-facing bot in `development` mode — it leaks internal debug output.

```env
NODE_ENV=production
```

---

### `BotName`

The display name of the bot used in internal logs, panel status messages, and any framework-generated strings that reference the bot's identity.

| | |
|---|---|
| **Required** | No |
| **Default** | *(none — logs will show the Discord tag instead)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Set this to your bot's name for cleaner log output. |

```env
BotName=MyBot
```

---

### `BotOwnerIds`

A comma-separated list of Discord user Snowflake IDs that are treated as **bot owners**. Bot owners bypass all permission checks — they receive every permission bit automatically and are never denied by `canExecute()`.

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty — no one is treated as a bot owner)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — adding an incorrect user ID grants that person full, unrestricted control over every command and API endpoint. Removing a valid owner ID locks them out of owner-only commands instantly. |
| **Recommended Action** | Set this to your own Discord user ID. Add additional trusted admins only when necessary. Never include IDs of users you do not fully trust — bot owners can manage roles, revoke tokens, and access all admin commands. |

To find your Discord user ID: enable Developer Mode in Discord settings, then right-click your username and select "Copy User ID".

```env
# Single owner
BotOwnerIds=123456789012345678

# Multiple owners
BotOwnerIds=123456789012345678,987654321098765432
```

---

## 4. Cryptographic Keys & Plugin Integrity

Zene uses **Ed25519** asymmetric signatures to verify the authenticity and integrity of plugins distributed as `.nvx` manifests. The public/private key pair works together — if you change one, you must change the other.

---

### `PublicKey`

The Ed25519 public key used to verify `.nvx` plugin manifests at startup. If a plugin's signature does not match this key, it is rejected outright.

| | |
|---|---|
| **Required** | No (see note below) |
| **Default** | `MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=` *(Lunedusk developer key)* |
| **Safe to Change** | Only if you are also replacing `PrivateKey` |
| **Breaking Risk** | **HIGH** — changing this without a matching `PrivateKey` will cause all signed plugins to fail integrity checks and be rejected |
| **Recommended Action** | **Leave at default** unless you are self-signing your own plugins. If you distribute your own certified plugins, replace both `PublicKey` and `PrivateKey` with your own generated Ed25519 key pair. |

The default value is the Lunedusk developer public key, which allows you to run any officially signed Zene plugin without configuration. If you generate your own key pair (required for distributing your own certified plugins), the value must be the raw Base64-encoded public key **without** PEM headers.

> ⚠️ **This key and `PrivateKey` are a matched pair.** If you change `PublicKey`, you must also have the corresponding `PrivateKey` available, and you must re-sign all plugins with it. Mismatching these will silently reject every plugin on startup.

```env
PublicKey=MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=
```

---

### `PrivateKey`

The Ed25519 private key used by the **plugin packer** (`npm run pack <plugin_id>`) to sign `.nvx` manifests. This key is **never used by the bot at runtime** — it is only needed when building and signing plugin distributions.

| | |
|---|---|
| **Required** | No — only needed when running the packer script |
| **Default** | *(none)* |
| **Safe to Change** | Only alongside `PublicKey` |
| **Breaking Risk** | **CRITICAL** — treat this like a password. Do not commit it to source control. Do not share it. |
| **Recommended Action** | Only set this on a build machine or developer machine. **Never set this on a production bot server.** |

The value may be provided as a raw Base64 string (without PEM headers) or as a full PEM block. The packer accepts both formats.

If this key is absent when you run `npm run pack`, the packer will exit with an error. If you are not packaging plugins, you do not need this variable at all.

> 🔒 **Security Notice:** `PrivateKey` grants the ability to produce signatures that your bot will trust. Anyone with this value can sign arbitrary plugins that your bot will load and execute. Store it in a secrets vault, not in a committed `.env` file.

```env
# Raw Base64 format (no PEM headers required)
PrivateKey=MC4CAQAwBQYDK2VwBCIEI...
```

---

### `PluginPublicKeys`

Optional JSON map of **plugin id → Base64 SPKI public key**. When verifying a plugin's `.nvx` signature, the updater and boot-time integrity path resolve keys in this order:

1. `PluginPublicKeys[pluginId]` if present  
2. `PublicKey` env (or default Lunedusk key)

| | |
|---|---|
| **Required** | No |
| **Default** | `{}` (empty — all plugins use `PublicKey`) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Medium — wrong key for a given id causes signature rejection for that plugin only |
| **Recommended Action** | Use only when third-party or self-signed plugins need a different verify key than the global `PublicKey`. |

```env
# PluginPublicKeys={"my-plugin":"MCowBQYDK2VwAyEA...","other-plugin":"MCowBQYDK2VwAyEA..."}
```

---

### `PLUGIN_SIGNING_KEY`

**CI / GitHub Actions only.** Same material as `PrivateKey`, used by Plugin CI to sign `manifest.nvx` before creating `plugin-{id}-v*` tags. Workflows export it as `PrivateKey` for the packer.

| | |
|---|---|
| **Required** | No on the bot host; **yes** as a GitHub secret for plugin-ci pack steps |
| **Default** | *(none)* |
| **Safe to Change** | Only with matching `PublicKey` / `PluginPublicKeys` |
| **Breaking Risk** | **CRITICAL if leaked** — same as `PrivateKey` |
| **Recommended Action** | Store as a repository secret named `PLUGIN_SIGNING_KEY`. Do not put it in production bot `.env`. The packer also accepts `PrivateKey` locally. |

> ℹ️ Not read by the running bot. Documented here so operators know which secret Plugin CI expects.

---

## 5. Discord Connection

### `DiscordToken`

The bot token obtained from the [Discord Developer Portal](https://discord.com/developers/applications). This is the primary credential used to authenticate with the Discord Gateway.

| | |
|---|---|
| **Required** | **YES — the bot cannot start without this** |
| **Default** | *(none)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **CRITICAL** — an incorrect or leaked token can result in your bot being disabled by Discord |
| **Recommended Action** | Set this and protect it. Never share it. Never commit it to source control. If leaked, regenerate it immediately from the Developer Portal. |

> 🔒 **Security Notice:** Your bot token is equivalent to a username and password combined. Anyone with this value has full control of your bot account, including sending messages, joining servers, and making API calls. The logger automatically redacts known sensitive fields, but you should never log this value manually.

```env
DiscordToken=your_bot_token_here
```

---

### `DiscordIntents`

A comma-separated list of Discord Gateway intent names to enable when logging in. This controls which events the bot receives from Discord.

| | |
|---|---|
| **Required** | No |
| **Default** | All **unprivileged** intents (safe fallback — see below) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Medium — removing an intent that a plugin depends on will silently break that plugin's event listeners without any startup error |
| **Recommended Action** | **Explicitly set this** to the intents your plugins actually need. Leaving it unset works but causes the framework to log a warning on every boot indicating no intents were specified. Defining it explicitly silences that warning and makes your intent requirements clear and auditable. |

#### Format

The value is a **comma-separated string** of intent names passed directly to the `IntentBuilder`. Names are **case-insensitive** and **underscore-insensitive** — `GuildMessages`, `guildmessages`, and `guild_messages` are all equivalent.

```env
# Comma-separated, case-insensitive, underscores optional
DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers
```

#### Special Keywords

In addition to individual intent names, three special keywords are supported:

| Keyword | Behaviour |
|---|---|
| *(not set / empty)* | Loads all **unprivileged** intents — the safest default |
| `default` or `unprivileged` | Explicitly loads all unprivileged intents (same as leaving unset) |
| `all` | Loads **every** intent including all three privileged ones — use with care |

Keywords can be combined with individual intent names. For example, `unprivileged,MessageContent` loads all safe intents and additionally requests `MessageContent`.

#### All Available Intent Names

These are the valid `GatewayIntentBits` names from Discord.js v14:

| Intent Name | Privileged | Events Unlocked |
|---|---|---|
| `Guilds` | No | Guild create/update/delete, channel events, role events |
| `GuildMembers` | **YES** | Member join/leave/update |
| `GuildModeration` | No | Ban/unban events |
| `GuildExpressions` | No | Emoji, sticker, soundboard events |
| `GuildIntegrations` | No | Integration create/update/delete |
| `GuildWebhooks` | No | Webhook update events |
| `GuildInvites` | No | Invite create/delete |
| `GuildVoiceStates` | No | Voice state updates |
| `GuildPresences` | **YES** | Presence/status updates |
| `GuildMessages` | No | Message create/update/delete in guilds |
| `GuildMessageReactions` | No | Reaction add/remove in guilds |
| `GuildMessageTyping` | No | Typing start in guilds |
| `DirectMessages` | No | DM message events |
| `DirectMessageReactions` | No | Reaction add/remove in DMs |
| `DirectMessageTyping` | No | Typing start in DMs |
| `MessageContent` | **YES** | Access to `message.content` field |
| `GuildScheduledEvents` | No | Scheduled event create/update/delete |
| `AutoModerationConfiguration` | No | AutoMod rule events |
| `AutoModerationExecution` | No | AutoMod action execution |
| `GuildMessagePolls` | No | Poll create/end in guilds |
| `DirectMessagePolls` | No | Poll create/end in DMs |

#### Privileged Intents

Three intents are marked **Privileged** by Discord and require additional steps:

- `GuildMembers`
- `GuildPresences`
- `MessageContent`

For each privileged intent you enable:
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → **Bot** tab
3. Scroll to **Privileged Gateway Intents** and toggle the relevant intent **ON**

> ⚠️ **If a privileged intent is listed in `DiscordIntents` but not enabled in the Developer Portal, Discord will reject the Gateway connection and the bot will fail to start entirely.** The framework will log a warning at startup listing every privileged intent it is about to request, giving you a chance to verify before the connection attempt.

> ⚠️ **Bots in 100+ servers** that request privileged intents must apply for verification via the Developer Portal. Using privileged intents in large bots without approval violates Discord's ToS and can result in your bot being disabled.

#### Examples

```env
# Minimum viable — just guild structure and message events (no content access)
DiscordIntents=Guilds,GuildMessages

# Standard bot — guild events + message content reading + member tracking
DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers

# Moderation-focused bot — add reaction and voice state tracking
DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers,GuildMessageReactions,GuildVoiceStates,GuildModeration

# All unprivileged intents (same as leaving the variable unset)
DiscordIntents=unprivileged

# Everything — requires all three privileged intents enabled in Developer Portal
DiscordIntents=all
```

---

### `GuildID`

A specific Discord server (guild) Snowflake ID. When set, all slash commands are synced to this guild only instead of globally. Guild commands appear instantly; global commands can take up to one hour to propagate.

| | |
|---|---|
| **Required** | No |
| **Default** | *(none — commands are registered globally)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — switching from guild to global means commands may be invisible for up to one hour |
| **Recommended Action** | Set this to your development or test server ID during development. **Remove or clear it for production deployments** so commands are available everywhere. |

```env
GuildID=123456789012345678
```

---

### `isSharded`

Enables Discord Sharding Mode. When `true`, the process launches a `ShardingManager` that spawns worker processes to handle separate Gateway shards. Required for bots in 2,500+ servers.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires full restart) |
| **Breaking Risk** | Medium — enabling sharding changes the process architecture significantly; ensure your plugins and database are shard-safe before enabling |
| **Recommended Action** | Leave `false` unless you are in 2,500+ guilds. The framework handles shard spawning automatically once enabled. |

```env
isSharded=false
```

---

## 6. Logging

### `LogLevel`

The minimum severity level for log output. Messages below this level are suppressed.

| | |
|---|---|
| **Required** | No |
| **Default** | `info` in production, `debug` in development |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | None |
| **Recommended Action** | Keep at `info` for production. Use `debug` temporarily when diagnosing issues. |

**Level hierarchy (lowest to highest severity):**

| Level | When to use |
|---|---|
| `debug` | Verbose internal tracing — plugin preload details, cache hits, route resolution |
| `info` | Normal operational events — startup, plugin boot, command sync |
| `warn` | Non-fatal anomalies — missing optional config, integrity bypass active |
| `error` | Recoverable errors — plugin boot failure, DB connection retry |
| `fatal` | Unrecoverable crash — application will exit after logging |

Setting `LogLevel=warn` will suppress all `info` and `debug` output. Setting it to `debug` will produce very high volume output — do not use in production unless actively troubleshooting.

```env
LogLevel=info
```

---

### `LogTZ`

The IANA timezone string used to format timestamps in log output and rotating log file names.

| | |
|---|---|
| **Required** | No |
| **Default** | `UTC` (falls back to `process.env.TZ` if set, then `UTC`) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | None |
| **Recommended Action** | Set to your server's local timezone for readable timestamps in log files. Examples: `America/New_York`, `Europe/London`, `Asia/Kolkata`. |

This only affects **display** — all internal timestamps are still UTC epoch values. Log files are rotated daily based on this timezone.

```env
LogTZ=UTC
```

---

## 7. HTTP API Server

### `APIPort`

The TCP port the built-in Express HTTP server binds to. This server exposes REST endpoints registered by plugins via `RouteLoader`, as well as the internal Prometheus metrics endpoint.

| | |
|---|---|
| **Required** | No |
| **Default** | `3000` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — any reverse proxy or external service pointing at the old port will break until updated |
| **Recommended Action** | Change if port 3000 conflicts with another service. Remember to update your reverse proxy configuration accordingly. |

The HTTP server only starts on the **primary shard** (shard 0 or standalone mode). In multi-shard deployments, only one HTTP server is active.

```env
APIPort=3000
```

### `ApiKey`

The master API gateway key used when the gateway runs in env mode. When `configuration/api.json5` enables env mode, Zene reads this value from the secrets manager and uses it as the gateway's primary authentication credential.

| | |
|---|---|
| **Required** | **Yes — if API gateway env mode is enabled** |
| **Default** | *(none — must be supplied through `.env`, `common.json`, or another secrets-backed source)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **CRITICAL** — changing or leaking this value affects gateway authentication immediately |
| **Recommended Action** | Store this in a secrets manager or protected environment file. Rotate it only during a maintenance window, and update any gateway clients at the same time. |

Generate a strong value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```env
ApiKey=your_gateway_master_key_here
```

> 🔒 **Security Notice:** This is the master credential for the API gateway when env mode is enabled. Treat it like a root password: never commit it, never paste it into a shared config file, and rotate it immediately if exposure is suspected.

### `GatewayMasterKey`

Preferred env name for the gateway master key when `auth.masterKeySource` is `"env"` and `auth.masterKeyEnvVar` is `GatewayMasterKey` (common default). Equivalent role to `ApiKey` depending on gateway config.

| | |
|---|---|
| **Required** | **Yes — if API gateway auth is enabled with env master key** |
| **Default** | *(none)* |
| **Safe to Change** | Yes (requires restart; update clients) |
| **Breaking Risk** | **CRITICAL** for API auth |

Also used to authorize Prometheus scrapes on `/metrics` and `/metrics.json` (`Authorization: Bearer <GatewayMasterKey>`).

```env
GatewayMasterKey=${rand:hex:48}
```

### Gateway `auth.keys` (config, not env)

Configured in the API plugin config (`configuration` / plugin `config.json5`), not as a single env var. Each entry:

- `key` — secret string
- `label` — human label
- `enabled` — boolean
- `bits` — string array of permission bits (e.g. `bot.tokens.manage`, `bot.permissions.view`)

The health-check script (`scripts/healthcheck.mjs` / `health.mjs`) should use a dedicated key whose `bits` include at least:

`bot.tokens.view`, `bot.tokens.manage`, `bot.permissions.view`, `bot.permissions.manage`, `bot.roles.manage`, `bot.gates.view`, `bot.gates.manage`, `bot.emoji.view`, `bot.emoji.manage`

Master key bypasses bit checks; ordinary keys must satisfy `httpRoutes` policy (`bits` + `bitsMode`).

### `ZENE_BOOT_SHARED_RAND`

Internal JSON blob injected by the primary process for `${rand:…@shared}` resolution on all shards. **Do not set manually** unless debugging multi-shard; it is written at boot by the shared-rand bootstrap.

| | |
|---|---|
| **Required** | No (auto-managed) |
| **Default** | *(absent until primary generates)* |

### Admin env reload

`/admin reload-env` re-reads `.env` / `.env.local` only (not `common.json`), re-expands placeholders, persists untagged `${rand:…}` into the file, and applies values through `secrets.applyEnvReload` (allow-set = keys in those files). `#tag` rand is process-stable across reload. `DiscordToken` / `DiscordIntents` are never applied by reload. Live `secrets.get` / `process.env` readers see updates; values cached at boot (including the Discord client session) do not.

### Health endpoints

| Path | Auth | Purpose |
|------|------|---------|
| `GET /health` | None | Process liveness (HttpServer) |
| `GET /api/health` | Gateway bearer (unless policy marks public) | API gateway health |

Both are intentional: `/health` for orchestrators; `/api/health` for authenticated gateway checks.

---

## 8. Database

### `Database`

A JSON object defining all database connections the bot should establish at startup. Each key is an **alias** you use to access the database in code; the value is a configuration object.

| | |
|---|---|
| **Required** | No |
| **Default** | `{}` — automatic SurrealDB + SQLite `main` fallbacks when not configured (see DisableDefault*) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — changing the alias of an existing database will cause plugins that reference the old alias to fail; changing the URI of a stateful database (NovaDB, SQLite, PostgreSQL) without migrating data first will result in data loss |
| **Recommended Action** | Define all your databases here. Never change an alias after a plugin has written data to it. Test database changes against a backup first. |

#### Format

```env
Database={"alias": {"uri": "...", "engine": "...", "poolSize": 10, "maxRetries": 5}}
```

#### Configuration Properties

| Property | Type | Required | Default | Description |
|---|---|---|---|---|
| `uri` | string | **Yes** | — | Connection string for the database |
| `engine` | string | No | Auto-detected from URI protocol | Database driver to use (see supported engines below) |
| `poolSize` | number | No | `10` | Maximum simultaneous connections |
| `maxRetries` | number | No | `5` (user-defined entries); `3` (auto-provisioned `main` NovaDB fallback) | Connection retry attempts on startup failure |
| `namespace` | string | No | — | SurrealDB only: namespace for `.use()` after connect |
| `database` | string | No | — | SurrealDB only: database for `.use()` after connect |
| `username` | string | No | — | SurrealDB only: username for `.signin()` |
| `password` | string | No | — | SurrealDB only: password for `.signin()` |
| `token` | string | No | — | SurrealDB only: token for `.authenticate()` (alternative to username/password) |

#### Supported Engines

| Engine Key | Description | URI Format Example |
|---|---|---|
| `mongo` | MongoDB via Mongoose | `mongodb+srv://user:pass@host/db` |
| `redis` | Redis — automatically creates **Main**, **Pub**, and **Sub** clients for this alias | `redis://127.0.0.1:6379` |
| `native-pg` | PostgreSQL via the `pg` driver | `postgresql://user:pass@localhost:5432/db` |
| `native-sqlite` | SQLite via `better-sqlite3`. WAL mode applied automatically. | `sqlite://./data/my.db` |
| `typeorm` | TypeORM ORM — supports `postgres`, `mysql`, `mariadb`, `sqlite` | `mysql://user:pass@localhost:3306/db` |
| `surrealdb` | SurrealDB (remote + embedded). Protocols: `ws`/`wss`/`http`/`https`/`mem`/`rocksdb`/`surrealkv`. Optional `namespace`, `database`, `username`, `password`, `token`. Embedded local paths under `.data/database/surreal/{engine}/{alias}/` when using `…://local`. | `rocksdb://local` or `ws://127.0.0.1:8000` |

#### Accessing Databases in Plugin Code

```ts
// Redis
const redis = this.heart.db.redis.get('cache');
await redis.main.set('key', 'value');
await redis.pub.publish('channel', 'message');

// PostgreSQL
const pg = this.heart.db.postgres.get('analytics');

// MongoDB
const mongo = this.heart.db.mongo.get('main');

// SQLite
const sqlite = this.heart.db.sqlite.get('localdb');

// TypeORM
const orm = this.heart.db.orm.get('main');

// SurrealDB
const surreal = this.heart.db.surreal.get('main');
await surreal.query('INFO FOR DB');
```

#### Multi-Database Example

```env
Database={"main": {"uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main"}, "cache": {"uri": "redis://localhost:6379", "engine": "redis"}, "analytics": {"uri": "postgresql://user:pass@host:5432/stats", "engine": "native-pg", "poolSize": 5}}
```

> ⚠️ **Alias stability is critical.** Once a plugin stores data under an alias (e.g. `main`), renaming that alias orphans all existing data. Treat aliases as permanent identifiers.

```env
Database={"main": {"uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main"}}
```

---


---

### `DisableDefaultSqlite`

When `true`, suppresses the automatic provisioning of a fallback `main` SQLite instance at `.data/database-sqlite/main.db`. Normally, if no SQLite `"main"` database exists after all configured databases are initialized, the framework creates one automatically for use by the permission system and other core features.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **HIGH** — the permission system (`PermissionsManager`, `PermissionCache`) and token system (`SqliteTokenStore`) depend on a SQLite `main` instance. Disabling it without providing an alternative SQLite database in your `Database` config will cause these core systems to crash at boot. |
| **Recommended Action** | **Leave at `false`.** Only set to `true` if you have explicitly configured a `"main"` SQLite database in your `Database` env variable using the `native-sqlite` engine. |

```env
DisableDefaultSqlite=false
```

---

### `DisableDefaultSurrealDB`

When `true`, suppresses the automatic provisioning of a fallback `main` SurrealDB instance at `.data/database/surreal/rocksdb/main`. Normally, if no SurrealDB `"main"` database exists after all configured databases are initialized, the framework creates an embedded RocksDB-backed instance automatically.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Medium — only plugins that explicitly depend on `this.heart.db.surreal.get('main')` are affected. Core permission/token systems do not require SurrealDB. |
| **Recommended Action** | **Leave at `false`** unless you intentionally want no default SurrealDB and will configure one explicitly (or not use SurrealDB at all). Embedded defaults are skipped automatically when `CROSS_HOST=true`. |

```env
DisableDefaultSurrealDB=false
```

---

## 9. Plugins

### `allowUnCertifiedPlugins`

When `true`, allows plugins **without** a valid `.nvx` signed manifest to load using their `manifest.json` file directly. This bypasses all cryptographic integrity verification.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | **SECURITY RISK** — enabling this means any code placed in your `plugins/` directory will run without verification. Only enable in a fully controlled, trusted environment. |
| **Recommended Action** | **Leave at `false` in production.** Use `whitelistedPlugins` for granular bypass of specific plugins you trust, rather than bypassing everything globally. |

> 🔒 **Security Notice:** Plugins run with full Node.js process privileges. A malicious plugin can access your `DiscordToken`, database contents, and file system. Only load plugins you have either personally written or that are signed with a trusted `PublicKey`.

```env
allowUnCertifiedPlugins=false
```

---

### `whitelistedPlugins`

A comma-separated list of specific plugin directory names that are allowed to bypass the `.nvx` signature check and load from their `manifest.json` directly. Provides granular bypass without opening the door to all unsigned plugins.

| | |
|---|---|
| **Required** | No |
| **Default** | *(none — empty list)* |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Medium security risk — each whitelisted plugin runs without cryptographic verification |
| **Recommended Action** | Use this during active plugin development when you have not yet packed the plugin with `npm run pack`. Remove entries once a plugin is properly signed. |

Plugin IDs must match their directory names exactly (kebab-case).

```env
whitelistedPlugins=my-dev-plugin,another-wip-plugin
```

---

## 10. Internationalisation

### `DefaultLocale`

Sets the fallback locale used by the Language Manager when a translation key is not found in the requested locale, or when no locale is explicitly specified.

| | |
|---|---|
| **Required** | No |
| **Default** | `en` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — changing this to a locale that has no translation files will cause all `i18n.get()` calls to return raw `namespace:key` strings |
| **Recommended Action** | Leave at `en` unless your bot's primary audience speaks a different language and you have full translation coverage for that locale. |

The Language Manager resolves translations using a fallback chain: `requested locale → base locale → DefaultLocale → en`. Setting `DefaultLocale` to a locale with incomplete coverage means users may see raw keys instead of text.

Supported built-in locales: `en`, `es`, `fr`, `de`. Custom locale codes are accepted but flagged with a warning.

```env
DefaultLocale=en
```

---

## 11. Rate Limiting

### `EnableGlobalRatelimit`

Toggles the framework-level global rate limiter that applies across all Discord interactions. When enabled, a user who triggers interactions too quickly receives an ephemeral cooldown message instead of executing the command.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — disabling it may increase Discord API pressure and make your bot vulnerable to spam abuse |
| **Recommended Action** | **Leave enabled.** Only disable temporarily when debugging interaction handling and the rate limiter is interfering with rapid test inputs. |

This is separate from per-command cooldowns defined in plugin code via `CommandConfig.cooldown`. The global rate limiter acts as a coarse filter across the entire interaction pipeline before any command-specific logic runs.

```env
EnableGlobalRatelimit=true
```

---

## 12. Hot Reload

### `hotReloadEnabled`

When `true`, the framework watches the `configuration/` directory (configs and language files) and the emoji assets for file changes and reloads them in memory without requiring a bot restart.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes (requires restart to toggle) |
| **Breaking Risk** | Low — hot reload is additive; if the watcher fails, the last successfully loaded values remain in memory |
| **Recommended Action** | Enable during development for a faster iteration loop. Keep `false` in production unless you regularly update configs or translations at runtime. |

Hot reload covers: `configuration/` JSON5 config files, `configuration/lang/` translation files, and emoji asset maps. It does **not** hot-reload plugin source code. Plugin source code reloading is a separate, first-class framework feature handled by `PluginManager.reload()` — it fully disables the target plugin, re-discovers it from disk, reinstalls dependencies, re-imports the module with a cache-busting URL, replays the full boot lifecycle, and resyncs Discord commands automatically. This is typically exposed via an admin command in your own plugin that calls the framework method, rather than being triggered by a file watcher.

```env
hotReloadEnabled=false
```

---

## 13. Auto Updater

Zene can check GitHub for newer **tagged** releases and apply them without a local git repository. The updater runs after compilation via:

```bash
npm run updater
# or with flags:
node --import ./core/dependency/index.mjs ./index.js --updater
node --import ./core/dependency/index.mjs ./index.js --updater --dry-run
node --import ./core/dependency/index.mjs ./index.js --updater --force
node --import ./core/dependency/index.mjs ./index.js --updater --baseline-only
node --import ./core/dependency/index.mjs ./index.js --updater --target v0.1.12
node --import ./core/dependency/index.mjs ./index.js --updater --downgrade
node --import ./core/dependency/index.mjs ./index.js --updater --install-plugin error-reporter
node --import ./core/dependency/index.mjs ./index.js --updater --install-plugin foo --plugin-tag plugin-foo-v1.2.0
```

It only starts `common777` + `secrets` — it does **not** log into Discord, load plugins, or start the HTTP server.

### Version policy (core tags `vX.Y.Z`)

| Change | Behaviour |
|---|---|
| Major (`X`) | Always allowed when updater is on |
| Minor (`Y`) | Always allowed when updater is on |
| Patch (`Z`) | Allowed **only** when `DevBuilds=true` |

**Tags only** — the client never falls back to branch tips for version selection. Superseded tags listed in `takebacks.json` are skipped on normal updates (see below).

SafeUpdate compares local files to a **baseline** (Blake2b-512 hashes written after the last successful update), never to the newest remote tree. Plugins are planned from the **core tag's `plugins.txt`** (not a local copy), follow a manifest `id` decision tree, and are never blindly overwritten. Applied plugins are written to **`src/plugins/{id}/`** and mirrored to **`plugins/{id}/`** (full tree, including `.js`).

---

### `AutoUpdater`

Master switch for automatic / CLI-driven updates.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — disabling only stops automatic resolution; explicit `--target` / `--install-plugin` still work |
| **Recommended Action** | Leave `true` if you want CLI/`npm run updater` to work. Set `false` on machines that must never pull remote code unless forced. |

```env
AutoUpdater=true
```

---

### `RepositoryUrl`

Highest-priority repository identifier. Accepts `owner/repo` or a full GitHub URL.

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty — falls back to `UpdaterDefaultRepo`)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium — if this is set and the request fails (404, auth, network), the updater **aborts with a warning and does nothing**. It will not fall back to the default repo. |
| **Recommended Action** | Leave empty to use the official default. Set only when tracking a fork or private mirror. |

```env
# RepositoryUrl=lunedusk/Zene
# RepositoryUrl=https://github.com/lunedusk/Zene
```

---

### `GithubPat`

Optional GitHub Personal Access Token (or fine-grained token) for private repos or higher API rate limits.

| | |
|---|---|
| **Required** | No (required only for private repositories) |
| **Default** | *(none)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | **HIGH if leaked** — a token with `repo` scope can read private code |
| **Recommended Action** | Set only when needed. Prefer a fine-grained token limited to the target repository. Never commit it. Also accepted as `GH_TOKEN` for compatibility. |

```env
# GithubPat=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### `UpdaterDefaultRepo`

Fallback repository when `RepositoryUrl` is absent.

| | |
|---|---|
| **Required** | No |
| **Default** | `lunedusk/Zene` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Leave at default unless you permanently track a different public repo. |

```env
UpdaterDefaultRepo=lunedusk/Zene
```

---

### `UpdaterBranch`

Branch used when fetching optional repo files such as **`takebacks.json`** if no local copy exists. **Not** used to select core or plugin versions (those are **tags only**).

| | |
|---|---|
| **Required** | No |
| **Default** | `main` |
| **Safe to Change** | Yes |
| **Breaking Risk** | None for tag-based version flow |
| **Recommended Action** | Leave as `main` unless your default branch differs. |

```env
UpdaterBranch=main
```

---

### `DevBuilds`

Allows **patch** tag upgrades (`v1.2.3` → `v1.2.4`). Major and minor upgrades are always allowed when the updater is on.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — enabling only accepts more tags; it does not force an update by itself |
| **Recommended Action** | Keep `false` in production. Set `true` on staging or when you intentionally want every patch release. |

```env
DevBuilds=false
```

---

### `SafeUpdate`

When `true`, the updater refuses to apply a new tag if any managed local file differs from the last written baseline (content hash mismatch). Per-plugin dirty checks apply the same rule under each plugin root.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | **HIGH if disabled carelessly** — local edits can be overwritten |
| **Recommended Action** | Leave `true`. Use `--force` or `UpdaterAllowForce=true` only when you intentionally discard local changes to managed files. |

Files never present in any baseline, and plugins marked “leave alone”, are not treated as dirty.

```env
SafeUpdate=true
```

---

### `UpdaterKeepExtra`

Preserve local files and directories that do not exist on the remote tree (top-level extras, unknown folders, etc.).

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium if set to `false` — extras may be ignored in planning (updater still does not delete arbitrary trees by default, but keep `true`) |
| **Recommended Action** | Leave `true`. |

```env
UpdaterKeepExtra=true
```

---

### `UpdaterAllowForce`

Allows overriding SafeUpdate via config (in addition to the CLI `--force` flag).

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes |
| **Breaking Risk** | **HIGH** — enables overwriting user-modified managed files |
| **Recommended Action** | Leave `false`. Prefer one-off `--force` on the CLI when needed. |

```env
UpdaterAllowForce=false
```

---

### `UpdaterDryRun`

Plan-only mode: resolve tags, run safety checks, print the plan, write nothing.

| | |
|---|---|
| **Required** | No |
| **Default** | `false` |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Use via CLI `--dry-run` for one-off checks. Set `true` in env only if you want every updater invocation to be non-mutating. |

```env
UpdaterDryRun=false
```

---

### `UpdaterMaxBackups`

How many successful pre-update backups to retain under `.data/updater/backups/`.

| | |
|---|---|
| **Required** | No |
| **Default** | `3` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — lowering only drops older backups |
| **Recommended Action** | `3` is enough for most hosts. Increase on machines with spare disk if you want a longer rollback window. |

```env
UpdaterMaxBackups=3
```

---

### `UpdaterTimeoutMs`

Overall timeout (milliseconds) for the update pipeline, including download and `npm run build`.

| | |
|---|---|
| **Required** | No |
| **Default** | `300000` (5 minutes) |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low — too low may abort large builds; too high only delays failure detection |
| **Recommended Action** | Raise on slow CI or large trees; `300000` is fine for typical installs. |

```env
UpdaterTimeoutMs=300000
```

---

### `UpdaterPostUpdateCmd`

Optional shell command run after a successful apply + rebuild (e.g. migrate, notify).

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty — skipped)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium — a failing or destructive command runs with the bot process privileges |
| **Recommended Action** | Leave empty unless you have a specific post-update step. Prefer idempotent scripts. |

```env
# UpdaterPostUpdateCmd=node scripts/post-update.js
```

---

### `UpdaterNotifyChannel`

Optional Discord channel Snowflake for future/post-update notifications (only meaningful when the bot is already running; the standalone updater path does not log in).

| | |
|---|---|
| **Required** | No |
| **Default** | *(empty)* |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Leave empty until notification wiring is used in your deployment. |

```env
# UpdaterNotifyChannel=123456789012345678
```

---

### `UpdaterPluginManifest`

JSON filename used inside each plugin folder for identity / `zene_version` checks during updates (`.nvx` is preferred for cryptographic integrity when present).

| | |
|---|---|
| **Required** | No |
| **Default** | `manifest.json` |
| **Safe to Change** | Only if all your plugins use a different name |
| **Breaking Risk** | Medium — wrong name disables id matching and changes plugin update decisions |
| **Recommended Action** | Leave as `manifest.json`. |

```env
UpdaterPluginManifest=manifest.json
```

---

### `UpdaterMode`

How the updater is intended to run.

| | |
|---|---|
| **Required** | No |
| **Default** | `standalone` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Keep `standalone` for `npm run updater`. Use `background` only if you later wire periodic checks inside a long-running process. |

**Accepted values:** `standalone`, `background`

```env
UpdaterMode=standalone
```

---

### CLI flags (not env, but related)

| Flag | Effect |
|---|---|
| `--updater` | Enter updater-only mode (no Discord login) |
| `--dry-run` / `--dryRun` | Plan only |
| `--force` | Bypass SafeUpdate for this run |
| `--baseline-only` / `--baselineOnly` | Find exact or nearest tag, hash-match local files, write baseline; non-matching files are treated as user-updated and excluded from the baseline. No file overwrite. |
| `--target <tag>` | Move core to an explicit tag (upgrade or downgrade). Can force a superseded tag. |
| `--downgrade` | Prefer `takebacks.json` **recommend** for the current baseline tag; else baseline `previousTag`. Warns and exits if neither exists. |
| `--install-plugin <id>` | Install or update one plugin listed in the **tag's** `plugins.txt` (never auto-installs others). |
| `--plugin-tag <tag>` | With `--install-plugin`, pin that plugin to an exact tag (skips semver search). |

---

### `plugins.txt` (on the **core release tag**, not local)

Source of truth for which plugins the updater may touch:

```text
plugin-error-reporter
economy:lunedusk/zene-economy
tickets:org/tickets-plugin@v2.0.0
```

| Line | Meaning |
|---|---|
| `plugin-foo` or `foo` | In-repo → tags `plugin-foo-v*` |
| `name:owner/repo` | External GitHub plugin |
| `name:owner/repo@v1.2.0` | External with pinned tag |

Compatibility uses **`zene_version` only**. Layouts L1 (`src/plugins/{id}`), L2 (repo root is the plugin), L3 (`plugins/{id}`) are detected from the archive; runtime always ends at `plugins/{id}/` after mirror.

---

### `takebacks.json` (repo root)

Optional file (also fetchable from `UpdaterBranch` if missing locally). Active entries with `status` `superseded` or `withdrawn` are **skipped** on normal updates.

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "tag": "v0.1.12",
      "status": "superseded",
      "recommend": "v0.1.14",
      "reason": "Critical fix",
      "severity": "high",
      "at": "2026-08-15T00:00:00.000Z",
      "active": true
    }
  ]
}
```

Ship `takebacks.example.json` as a template; rename or copy to `takebacks.json` when live. The Takebacks workflow can annotate GitHub Releases as `[SUPERSEDED]`.

---


### `UpdaterIntervalMs`

Background mode poll interval in milliseconds.

| | |
|---|---|
| **Required** | No |
| **Default** | `21600000` (6 hours) |
| **Safe to Change** | Yes |
| **Breaking Risk** | None |
| **Recommended Action** | Raise in production if you want rarer checks; minimum effective interval is clamped to 60s in code. |

```env
UpdaterIntervalMs=21600000
```

---

### `UpdaterBackgroundApply`

When `UpdaterMode=background`, whether a discovered update is **applied** (then the process exits `0` so Docker/`restart: unless-stopped` can restart on the new build). If `false`, only plans/logs.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium — apply triggers rebuild + process exit |
| **Recommended Action** | Keep `true` under Docker with `restart: unless-stopped`. Set `false` for notify-only.

```env
UpdaterBackgroundApply=true
```

---

### `UpdaterAutoRollback`

After a core update, write a pending-health marker. If the bot fails to complete a full bootstrap twice (or the grace window elapses without a healthy mark), the next boot/updater run restores `previousTag` with `--force`.

| | |
|---|---|
| **Required** | No |
| **Default** | `true` |
| **Safe to Change** | Yes |
| **Breaking Risk** | Medium — can move the tree backward after bad releases |
| **Recommended Action** | Leave `true` on production. Disable only if you manage rollbacks manually via `--target` / `--downgrade`. |

```env
UpdaterAutoRollback=true
```

---

### `UpdaterHealthGraceMs`

How long after an update the pending-health marker may wait for a successful boot before age-based rollback is allowed (boot-attempt ≥ 2 still rolls back earlier).

| | |
|---|---|
| **Required** | No |
| **Default** | `900000` (15 minutes) |
| **Safe to Change** | Yes |
| **Breaking Risk** | Low |
| **Recommended Action** | Increase on slow hosts; decrease if you want faster recovery from crash loops. |

```env
UpdaterHealthGraceMs=900000
```

---

### First run / missing baseline


If `.data/updater/baseline.json` is missing or unreadable:

- Normal update path may still select the newest **allowed** tag, apply, rebuild, then write a new baseline (including `previousTag` when upgrading from an existing baseline).
- `--baseline-only` selects the exact or nearest tag relative to the current baseline tag or `package.json` version, compares hashes, and writes a baseline from matching files only.

## 14. Authentication & Tokens

### `TokenMasterSecret`

The master secret used to derive per-user HMAC-SHA256 signing keys for bearer tokens issued by the Token Manager. All token signatures depend on this value — changing it invalidates every existing token instantly.

| | |
|---|---|
| **Required** | **Yes — if the `token` plugin is loaded** |
| **Default** | *(none — the token handler will refuse to initialize without it)* |
| **Safe to Change** | Only with full token revocation first |
| **Breaking Risk** | **CRITICAL** — changing this value silently invalidates all active tokens. Users with existing tokens will receive `INVALID_SIGNATURE` errors and must re-authenticate. There is no migration path — old tokens cannot be verified against a new secret. |
| **Recommended Action** | Generate a strong random string of at least 32 characters and set it once. Treat it like a database password — persistent across restarts, never committed to source control. To rotate, first call `revokeAll` for each active user via the API, then swap the secret and restart. |

Generate a secure value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```env
TokenMasterSecret=k7Bz9xQ2mR4nW8pL1vY6dF3hJ5tA0uC9wE2sG4kM7bN1xR8qT6yP3
```

> 🔒 **Security Notice:** This secret is the root of trust for your entire token authentication system. Anyone with this value can forge valid tokens for any user with any permission bits. Store it in a secrets vault or a protected `.env` file, never in source control or a client-accessible config.

---

### `TokenTTL`

The default time-to-live (in seconds) for newly issued tokens. After this duration, the token expires and the client must refresh or re-authenticate.

| | |
|---|---|
| **Required** | No |
| **Default** | `900` (15 minutes) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | Low — only affects newly issued tokens; existing tokens keep their original expiry |
| **Recommended Action** | 900 seconds (15 minutes) is a good balance between security and UX. Increase for low-risk dashboards; decrease for sensitive admin panels. |

```env
TokenTTL=900
```

---

### `TokenMaxTTL`

The absolute maximum TTL (in seconds) that can be requested when issuing a token. Even if a caller requests a longer TTL via the API, the Token Manager clamps it to this value.

| | |
|---|---|
| **Required** | No |
| **Default** | `86400` (24 hours) |
| **Safe to Change** | Yes (requires restart) |
| **Breaking Risk** | None |
| **Recommended Action** | Leave at 24 hours unless you have a specific reason to allow longer-lived tokens. Longer tokens mean longer windows of exposure if a token is stolen. |

```env
TokenMaxTTL=86400
```

---

### `TokenIssuer`

The `iss` (issuer) claim embedded in every token. On verification, the Token Manager rejects tokens whose issuer doesn't match this value. Useful for distinguishing tokens from different environments (staging vs production).

| | |
|---|---|
| **Required** | No |
| **Default** | `zene` |
| **Safe to Change** | Yes — but invalidates all existing tokens (they'll fail the issuer check) |
| **Breaking Risk** | Medium — changing this is effectively a soft revocation of all tokens |
| **Recommended Action** | Leave as `zene` unless you run multiple Zene instances and need to prevent tokens from one environment being used in another. |

```env
TokenIssuer=zene
```

---

### `TokenAudience`

The `aud` (audience) claim embedded in every token. On verification, the Token Manager rejects tokens whose audience doesn't match. Used to scope tokens to a specific consumer (e.g. `dashboard`, `mobile`, `api`).

| | |
|---|---|
| **Required** | No |
| **Default** | `dashboard` |
| **Safe to Change** | Yes — but invalidates all existing tokens (they'll fail the audience check) |
| **Breaking Risk** | Medium — same as `TokenIssuer` |
| **Recommended Action** | Leave as `dashboard` for single-audience setups. If you have multiple clients consuming tokens, consider issuing tokens with different audiences per client via the API's `TokenIssueOptions`. |

```env
TokenAudience=dashboard
```

---

## 15. Full `.env` Template

Copy this template as your starting point. Required variables are marked. All others have safe defaults.

```env
# ============================================================
# Zene — Environment Configuration
# ============================================================

# ── RUNTIME ─────────────────────────────────────────────────
NODE_ENV=production
BotName=MyBot

# ── BOT OWNERS ─────────────────────────────────────────────
# Comma-separated Discord user IDs with full admin bypass
# BotOwnerIds=123456789012345678

# ── DISCORD ─────────────────────────────────────────────────
# REQUIRED
DiscordToken=your_bot_token_here

# Optional: restrict to specific intents (leave blank for defaults)
# DiscordIntents=Guilds,GuildMessages,MessageContent,GuildMembers

# Optional: guild-scope command sync (use during development only)
# GuildID=123456789012345678

# Optional: enable sharding for 2500+ server bots
isSharded=false

# ── LOGGING ─────────────────────────────────────────────────
LogLevel=info
LogTZ=UTC

# ── HTTP API ─────────────────────────────────────────────────
APIPort=3000

# ── DATABASE ─────────────────────────────────────────────────
# JSON object: alias -> { uri, engine, poolSize?, maxRetries? }
# Leave blank to auto-provision SurrealDB + SQLite main fallbacks
Database={"main": {"uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main"}}

# Set to true ONLY if you have manually defined a "main" database above
# and explicitly do not want the automatic fallback
# Set to true ONLY if you have manually defined a "main" SQLite database
# and do not want the automatic fallback
DisableDefaultSqlite=false

# Set to true ONLY if you do not want the automatic SurrealDB main fallback
# at .data/database/surreal/rocksdb/main
DisableDefaultSurrealDB=false

# ── PLUGIN INTEGRITY ────────────────────────────────────────
# Default is the Lunedusk developer key — leave unchanged to run official plugins
PublicKey=MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=

# Only set on build machines — never on production servers
# PrivateKey=your_ed25519_private_key_base64

# WARNING: enabling this bypasses plugin signature verification globally
allowUnCertifiedPlugins=false

# Granular bypass for specific plugins in development
# whitelistedPlugins=my-dev-plugin

# ── INTERNATIONALISATION ────────────────────────────────────
DefaultLocale=en

# ── RATE LIMITING ───────────────────────────────────────────
EnableGlobalRatelimit=true

# ── HOT RELOAD ──────────────────────────────────────────────
hotReloadEnabled=false

# ── AUTHENTICATION & TOKENS ────────────────────────────────
# REQUIRED if API gateway env mode is enabled — must be kept secret
# ApiKey=your_gateway_master_key_here

# REQUIRED if using the token plugin — must be 32+ characters, persistent
# TokenMasterSecret=your_generated_secret_here

# Token TTL in seconds (default: 900 = 15 minutes)
# TokenTTL=900

# Max TTL cap in seconds (default: 86400 = 24 hours)
# TokenMaxTTL=86400

# Issuer and audience claims (change only if running multiple environments)
# TokenIssuer=zene
# TokenAudience=dashboard

# ── PLUGIN INTEGRITY (extra) ───────────────────────────────
# Optional per-plugin verify keys (JSON object)
# PluginPublicKeys={"my-plugin":"MCowBQYDK2VwAyEA..."}

# ── AUTO UPDATER ────────────────────────────────────────────
AutoUpdater=true
# RepositoryUrl=                    # if set and fails → abort (no fallback)
# GithubPat=                        # private repos / higher rate limits
UpdaterDefaultRepo=lunedusk/Zene
UpdaterBranch=main
DevBuilds=false
SafeUpdate=true
UpdaterKeepExtra=true
UpdaterAllowForce=false
UpdaterDryRun=false
UpdaterMaxBackups=3
UpdaterTimeoutMs=300000
# UpdaterPostUpdateCmd=
# UpdaterNotifyChannel=
UpdaterPluginManifest=manifest.json
UpdaterMode=standalone
UpdaterIntervalMs=21600000
UpdaterBackgroundApply=true
UpdaterAutoRollback=true
UpdaterHealthGraceMs=900000
# CLI: --target, --downgrade, --install-plugin, --plugin-tag, --baseline-only
# takebacks.json at repo root (optional) — see §13
```

---

## 16. Quick-Reference Table

| Variable | Required | Default | Safe to Change | Breaking Risk |
|---|---|---|---|---|
| `NODE_ENV` | No | `production` | Yes | Low |
| `BotName` | No | *(none)* | Yes | None |
| `BotOwnerIds` | No | *(empty)* | Yes | **High** |
| `DiscordToken` | **YES** | *(none)* | Yes | Critical if leaked |
| `DiscordIntents` | No | All unprivileged (warns if unset) | Yes | Medium |
| `GuildID` | No | *(global sync)* | Yes | Low |
| `isSharded` | No | `false` | Yes | Medium |
| `LogLevel` | No | `info` / `debug` | Yes | None |
| `LogTZ` | No | `UTC` | Yes | None |
| `APIPort` | No | `3000` | Yes | Low |
| `ApiKey` | If API gateway env mode is enabled | *(none)* | Yes | **Critical** |
| `Database` | No | `{}` + auto Surreal/SQLite | Yes | **High** |
| `DisableDefaultSqlite` | No | `false` | Yes | **High** |
| `DisableDefaultSurrealDB` | No | `false` | Yes | Medium |
| `PublicKey` | No | Lunedusk dev key | Only with `PrivateKey` | **High** |
| `PrivateKey` | No | *(none)* | Only with `PublicKey` | Critical — keep secret |
| `PluginPublicKeys` | No | `{}` | Yes | Medium |
| `PLUGIN_SIGNING_KEY` | CI pack only | *(none)* | Only with matching public key | Critical if leaked |
| `allowUnCertifiedPlugins` | No | `false` | Yes | Security risk |
| `whitelistedPlugins` | No | *(empty)* | Yes | Medium security risk |
| `DefaultLocale` | No | `en` | Yes | Low |
| `EnableGlobalRatelimit` | No | `true` | Yes | Low |
| `hotReloadEnabled` | No | `false` | Yes | Low |
| `TokenMasterSecret` | If token plugin loaded | *(none)* | Only with revocation | **Critical** |
| `TokenTTL` | No | `900` | Yes | Low |
| `TokenMaxTTL` | No | `86400` | Yes | None |
| `TokenIssuer` | No | `zene` | Yes (invalidates tokens) | Medium |
| `TokenAudience` | No | `dashboard` | Yes (invalidates tokens) | Medium |
| `AutoUpdater` | No | `true` | Yes | Low |
| `RepositoryUrl` | No | *(empty)* | Yes | Medium (fail = abort) |
| `GithubPat` | No* | *(none)* | Yes | **Critical if leaked** |
| `UpdaterDefaultRepo` | No | `lunedusk/Zene` | Yes | Low |
| `UpdaterBranch` | No | `main` | Yes | None |
| `DevBuilds` | No | `false` | Yes | Low |
| `SafeUpdate` | No | `true` | Yes | **High if disabled** |
| `UpdaterKeepExtra` | No | `true` | Yes | Medium if `false` |
| `UpdaterAllowForce` | No | `false` | Yes | **High** |
| `UpdaterDryRun` | No | `false` | Yes | None |
| `UpdaterMaxBackups` | No | `3` | Yes | Low |
| `UpdaterTimeoutMs` | No | `300000` | Yes | Low |
| `UpdaterPostUpdateCmd` | No | *(empty)* | Yes | Medium |
| `UpdaterNotifyChannel` | No | *(empty)* | Yes | None |
| `UpdaterPluginManifest` | No | `manifest.json` | Rarely | Medium |
| `UpdaterMode` | No | `standalone` | Yes | Low |
| `UpdaterIntervalMs` | No | `21600000` | Yes | None |
| `UpdaterBackgroundApply` | No | `true` | Yes | Medium |
| `UpdaterAutoRollback` | No | `true` | Yes | Medium |
| `UpdaterHealthGraceMs` | No | `900000` | Yes | Low |

\*Required only for private GitHub repositories.

### `common.json` Field Reference

All standard env variables above are also valid as top-level keys in `common.json`. Additional fields specific to `common.json`:

| Field | Required | Description |
|---|---|---|
| `__info__.__author__` | **YES** | Must be exactly `"Lunedusk"` — framework exits on mismatch |
| `__info__.version` | No | Always overwritten by `package.json` version at boot |
| `ENVSettings` | No | `true` = respect existing env; `false` = inject all fields into `process.env`; absent = no injection |
| `TZ` | No | Timezone shorthand in `common.json` — equivalent to `LogTZ` when injected into env |

---

*For plugin development documentation, database API reference, or the full IHeart context API, refer to the corresponding framework documentation files.*

## 17. Cross-Host / Orchestrator


**Worker cluster client** (after register) may call orchestrator `GET /cross-host/v1/cluster/shards|workers`, `GET /cross-host/v1/cluster/guild-owner`, `POST /cross-host/v1/cluster/shard-shift` with the machine Bearer token. See [CROSS_HOST.md](CROSS_HOST.md).

Master switch and multi-machine control plane. When `CROSS_HOST` is true, the process branches before classic standalone / `isSharded` boot. See [CROSS_HOST.md](CROSS_HOST.md). Lifecycle events: [EVENTS.md](EVENTS.md).

### Master

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CROSS_HOST` | Yes (to enable) | `false` | Master switch |
| `CROSS_HOST_ROLE` | Yes when enabled | — | `orchestrator` \| `worker` |
| `CROSS_HOST_MACHINE_ID` | Yes on worker | — | Stable identity; register refused if missing |
| `CROSS_HOST_ORCHESTRATOR_URL` | Yes on worker | — | Base URL for HTTP challenge + register |
| `CROSS_HOST_CLUSTER_SECRET` | Yes | — | Shared HMAC secret (sensitive) |
| `CROSS_HOST_HTTP_HOST` | Orchestrator | `0.0.0.0` | Control HTTP bind |
| `CROSS_HOST_HTTP_PORT` | Orchestrator | `8020` | Dedicated port; not the normal bot API port |
| `CROSS_HOST_TOTAL_SHARDS` | No | *(from Discord `/gateway/bot`)* | Optional override for cluster shard count |

### Compatibility & auth

| Variable | Default | Notes |
|---|---|---|
| `CROSS_HOST_COMPAT_MODE` | `strict` | `strict` \| `range` |
| `CROSS_HOST_TOKEN_TTL_SEC` | `3600` | Short-lived machine token TTL |
| `CROSS_HOST_MTLS_ENABLED` | `false` | Optional mTLS |
| `CROSS_HOST_MTLS_CERT_PATH` | — | Client/server cert when mTLS enabled |
| `CROSS_HOST_MTLS_KEY_PATH` | — | Private key when mTLS enabled |
| `CROSS_HOST_MTLS_CA_PATH` | — | CA bundle when mTLS enabled |

### Heartbeat / failure (reserved; intervals used from later milestones)

| Variable | Default | Notes |
|---|---|---|
| `CROSS_HOST_HEARTBEAT_MS` | `5000` | |
| `CROSS_HOST_SUSPECT_AFTER` | `3` | Missed heartbeats |
| `CROSS_HOST_DEAD_GRACE_MS` | `15000` | Grace after suspect |

### Load / rebalance / updates

| Variable | Default | Notes |
|---|---|---|
| `CROSS_HOST_STATS_INTERVAL_MS` | `900000` | Worker stats publish interval |
| `CROSS_HOST_REBALANCE_COOLDOWN_MS` | `60000` | Min time between rebalance cycles |
| `CROSS_HOST_LOAD_IMBALANCE_THRESHOLD` | `0.25` | Relative (max-min)/avg |
| `CROSS_HOST_REBALANCE_MAX_MOVES` | `32` | Cap moves per cycle |
| `CROSS_HOST_REBALANCE_MIN_IMPROVEMENT` | `0.05` | Min imbalance improvement to accept a move |
| `CROSS_HOST_ASSIGNMENT_STRATEGY` | `least_loaded` | `least_loaded` / `sticky` / `manual` / `region_aware` |
| `CROSS_HOST_MANUAL_SHARDS` | `{}` | JSON machineId to number[]; invalid overlay rejected entirely |
| `CROSS_HOST_REGION_LABEL_KEY` | `region` | Worker label key for region_aware |
| `CROSS_HOST_MAX_CONCURRENT_UPDATES` | `1` | Drain-first rolling update concurrency |
| `CROSS_HOST_LOAD_WEIGHT_GUILD` | `1` | |
| `CROSS_HOST_LOAD_WEIGHT_MEMBER` | `0.001` | Ignored when memberCount omitted |
| `CROSS_HOST_LOAD_WEIGHT_EVENT` | `10` | |
| `CROSS_HOST_LOAD_WEIGHT_COMMAND` | `20` | |
| `CROSS_HOST_LOAD_WEIGHT_SHARD` | `0.5` | Keeps empty workers attractive |



### API gateway (public edge)

| Variable | Default | Notes |
|---|---|---|
| `CROSS_HOST_API_GATEWAY_ENABLED` | `true` | Orchestrator proxies public HTTP to workers |
| `CROSS_HOST_API_PROXY_TIMEOUT_MS` | `30000` | Upstream proxy timeout |
| `CROSS_HOST_WORKER_API_HOST` | `0.0.0.0` | Worker HTTP bind address |
| `CROSS_HOST_WORKER_API_PORT` | `APIPort` or `3000` | Worker HTTP bind port |
| `CROSS_HOST_WORKER_API_ADVERTISE_HOST` | _(none)_ | Host/IP orchestrator uses to reach worker API (required for routing) |

### Optional index & query

| Variable | Default | Notes |
|---|---|---|
| `CROSS_HOST_INDEX_ENABLED` | `false` | Optional secondary metadata index |
| `CROSS_HOST_INDEX_BACKEND` | `redis` | `redis` only |
| `CROSS_HOST_INDEX_RETENTION_DAYS` | `14` | Index retention |
| `CROSS_HOST_QUERY_TIMEOUT_MS` | `5000` | Per-worker query RPC timeout |
| `CROSS_HOST_QUERY_CONCURRENCY` | `16` | Max parallel scatter-gather RPCs |

Index backend is Redis-only. Shared audit/error/dash document data use remote SurrealDB under Cross-Host.

### Redis

Cross-Host requires Redis. Resolution order:

1. `Database.crosshost` when URI is `redis://` / `rediss://` or `engine` is `redis`
2. Else `Database.main` when that entry is Redis
3. Else **boot fails**

Example:

```
Database={"crosshost":{"uri":"redis://127.0.0.1:6379","engine":"redis"},"main":{"uri":"wss://surreal.example.com","engine":"surrealdb","namespace":"main","database":"main"}}
```

### Safety

- Do not run two orchestrators against the same cluster secret / Redis instance.
- Never put the Discord token in Cross-Host register payloads.
- `CROSS_HOST_CLUSTER_SECRET` is treated as sensitive by the secret manager pattern.

## Placeholder expansion in environment values

After secrets assimilate and before the vault locks, string values in the environment may contain:

- `${env:OTHER_KEY}` / `${secret:OTHER_KEY}` (and optional `?` forms)
- `${rand:hex:N}` / `${rand:hex:N#tag}` / `${rand:hex:N@shared}` (env untagged rand is **runtime-only**, not written to disk; `@shared` uses fleet boot blob)
- `%%key%%` non-emoji placeholders

See [docs/PLACEHOLDERS.md](docs/PLACEHOLDERS.md).


## Data backend selection (per subsystem)

Preference when engine is unset: sqlite → postgres → mongo (first connected alias).

| Subsystem | Config section keys | Env engine | Env alias |
|-----------|---------------------|------------|-----------|
| Permissions | `permissions.engine` / `permissions.alias` | `PermissionsEngine` | `PermissionsDbAlias` |
| Token | `token.engine` / `token.alias` | `TokenEngine` | `TokenDbAlias` |
| GuildGate | `guildGate.engine` / `guildGate.alias` (or core plugin config) | `GuildGateEngine` | `GuildGateDbAlias` |
| Dashboard | `dashboard.engine` / `dashboard.alias` | `DashboardEngine` | `DashboardDbAlias` |

Default alias: `main`. Core migrations use the permissions-resolved backend.

## Known limitations

- **MongoDB / PostgreSQL paths** are implemented and selected via the backend selector, but this repository’s primary CI/runtime verification is SQLite. Treat first deploy on mongo/pg as a validation pass.
- **NovaDB replica resync** follows the engine’s designed recovery path (WAL + manifest); full remote replica catch-up semantics are not a separate product feature beyond that design.



### PluginAssetsOrigin

| | |
|--|--|
| **Purpose** | Base URL for Tier 2 plugin dashboard static assets (iframe origin) |
| **Default** | `http://plugin-assets.localhost:{APIPort}` |
| **Safe to Change** | Yes (requires restart; update CSP / dashboard shell config) |


### DashHostOriginPlugins

| | |
|--|--|
| **Purpose** | Comma-separated plugin ids allowed to register **Tier 3** (host-origin, unsandboxed) dashboard surfaces |
| **Default** | empty (no Tier 3) |
| **Safe to Change** | Yes (requires restart or registry rebuild after lifecycle) |

## Permissions / token notes

- `BotOwnerIds` — comma-separated Discord user IDs; highest ownership (env owners).
- Token plugin master secret must be configured for `/api/tokens/*` issue/verify.
- Cross-host storage still rejects sqlite/file primary engines when Cross-Host is on.
