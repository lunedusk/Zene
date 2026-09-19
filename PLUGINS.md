# Plugins — Developer Guide

## License

Zene is licensed under the **PolyForm Noncommercial License 1.0.0**.

- Free to use and modify for personal and non-commercial purposes.
- You may not sell it, claim it as your own, or use it commercially without written permission.

## Plugin ownership

Any independent plugins, commands, or extensions you create using Zene remain **your** intellectual property. You retain full ownership of your original plugin code.

## Plugin rules

Violating any of the following means your plugin will not be verified or signed, and may be removed:

1. **No malware** — no malicious or harmful content of any kind.
2. **No hidden data exfiltration** — do not call out to your own external API, send confidential user/guild information, or emit telemetry unless it is genuinely necessary to the plugin’s stated function **and** disclosed to the user.
3. **No unnecessary access to secrets** — do not read `common.json`, environment variables, or framework secrets beyond what your plugin actually needs.
4. **Open source if not monetized** — if your plugin is not monetized, it must be open source.
5. **No stolen code** — do not copy, steal, or republish anyone else’s code as your own.

## Verification & signing

- To verify your plugin, get it added to the official `plugins.txt`, or receive a Lunedusk-signed manifest (`manifest.nvx`).
- Email your plugin’s **source code** to **vedant.storm@gmail.com** for safety verification.
- Submit **readable source only** — do not send pre-obfuscated builds. If you want obfuscation, Lunedusk will obfuscate **and** sign after verifying the source.
- A Lunedusk-signed manifest lets the plugin load **without** the boot warning: `BYPASS ACTIVE — loading plugin without cryptographic guarantees`.
- Being listed in the official repo’s `plugins.txt` means any Zene user can install your plugin through the built-in auto-updater.

## Help & issues

Report bugs or ask questions via GitHub Issues and Discussions:  
https://github.com/lunedusk/Zene



## Feature requirements (intents & Discord permissions)

Plugins and core register what they need so operators get soft-fail visibility without hard-disabling features.

```ts
import {
  featureRequirements,
  registerPermissionsFeatureRequirements, // or register your own
} from '#core/manager/featureRequirements.js';
import { PermissionFlagsBits } from 'discord.js';

// Prefer onSetup() so registrations exist before Client ready / guildCreate:
featureRequirements.register({
  id: 'myplugin.syncMembers',
  pluginId: 'myplugin',
  description: 'Short operator-facing label',
  intents: ['GuildMembers'],
  permissions: [PermissionFlagsBits.ManageRoles],
  // softDisabled: true  // skip intent warn + join permission notices
});
```

| Concern | Behaviour |
|---------|-----------|
| Missing **intents** | Console soft-warn once: feature label + intents in parentheses. Feature is **not** auto-disabled. |
| Missing **permissions** on join | DM Discord **server owner**; else staff-like / first sendable channel + owner ping; else silence. |
| Modes | Standalone, classic shard, Cross-Host **worker** (guild-owning process only). |
| Built-ins | `registerAllBuiltinFeatureRequirements()` from core covers core handlers, permissions, api, token, dashboard, dash-data. Each plugin also calls its `register*FeatureRequirements()` in `onSetup`. |

Do **not** put guild ID lists in config for gate/access — use commands + DB. Locale **pick** helpers: `guildLocale.setGuildLocaleValidated` (schema/rules fail closed); no public edit cmds/routes yet.


## Related

- [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) — authoring contract  
- [LOADER.md](LOADER.md) — config/lang defaults merge  
- [UPDATER.md](UPDATER.md) — installing plugins via the updater  


## Registry inspect API

Dashboard (when enabled) exposes read-only inspect endpoints under `/api/dash/admin/registry/`:

- `commands` — slash commands currently registered on the interaction registry
- `events` — EventBus listeners (name/pattern, once, priority, owning plugin)
- `routes` — HTTP access policy routes plus mounted Express base paths

Requires a valid dash session carrying `bot.plugins.view`. Fields that cannot be derived are returned as `null` or empty arrays.


## `dash-data` plugin

Owns **all** dashboard persistence (`dash_*` tables, KV, layouts, surface flags). The `dashboard` plugin depends on it and keeps the HTTP API only; `dashboard/src/lib/db.ts` re-exports the shared store so routes do not change.

Priority `-5` so it loads before `dashboard` (priority `10`).


## Plugin dashboard manifest (`dashboard/manifest.json`)

Optional per-plugin file declaring dashboard surfaces for the **Plugin Dashboard UI SDK**.

- Path: `plugins/<id>/dashboard/manifest.json` (`schemaVersion: 1`)
- Loaded into `GET /api/dash/registry` (session required; visibility filtered for the caller)
- **Tier 1** declarative · **Tier 2** sandboxed iframe (any loaded plugin) · **Tier 3** host module (any loaded plugin that declares `tier: 3`; no separate env allowlist — do not install plugins you do not trust)
- Tier 2/3 assets served from **PluginAssetsOrigin** (`assetOrigin` / `assetEntryUrl` on the registry snapshot)
- Signed/unsigned is a **badge** in registry data only — not a functional gate
- Unknown `kind` / `tier` → surface dropped
- Asset origin: env **`PluginAssetsOrigin`** (default `http://plugin-assets.localhost:{APIPort}`)
- Lifecycle enable/disable/reload bumps registry version and emits `dash.registry.updated`

See **System Prompt - AI - Plugin.md** → *Plugin Dashboard UI SDK*.


## Capability broker (dashboard)

Server-side policy for Tier 2 iframe UI (iframe host is frontend Track B).

| Endpoint | Role |
|----------|------|
| `POST /api/dash/broker/session` | Issue frame **nonce** + capability grants for a registry surface |
| `POST /api/dash/broker/ready` | Bind nonce on first `plugin:ready` (frame identity) |
| `POST /api/dash/broker/proxy` | Authorize a plugin API path under grants + path allowlist |
| `POST /api/dash/broker/dispose` | Dispose surface (rate-limit / host teardown) |

**Path allowlist:** segment-boundary + path-normalized (decode, resolve `.`/`..`). Patterns are `/api/dash/plugins/{pluginId}` and `/api/dash/plugins/{pluginId}/*`. Prefix tricks (`…/foobar`) and traversal are rejected.

**Flood limits:** 60 messages / 10s / surface, max payload 64 KiB, 5 strikes → dispose.

See **System Prompt - AI - Plugin.md** → Plugin Dashboard UI SDK (broker).


## Realtime (SSE)

| Endpoint | Auth | Role |
|----------|------|------|
| `GET /api/dash/events/sse` | Session | Server-Sent Events: `registry.updated`, `surface.invalidate`, `theme.updated`, `layout.updated`, `widget.data`, `heartbeat` |
| `GET /api/dash/events/ws` | Session | **Deferred** (501) — WebSocket via Next BFF upgrade is a follow-up; does not block SSE |

`registry.updated` is emitted when plugin enable/disable/reload bumps the dash registry version (A5). Clients should re-fetch `GET /api/dash/registry` so surfaces for plugins that failed the load gate disappear.

## Registering structure from index.ts

```ts
await this.heart.registry.registerCommand(MyCommand);
await this.heart.registry.extendCommand('admin', {
  kind: 'subcommand',
  name: 'fleet-restart',
  description: '…',
  requirements: { modes: ['crosshost'], crossHostRole: 'worker' },
  execute: async (i) => { /* … */ },
});
```

Duplicates hard-fail. See System Prompt → heart.registry.

## Dynamic registration & requirements

Commands, events, routes, handlers, and middlewares may declare `requirements` (mode: cross-host / sharded / standalone, env, plugins, `when` fn). Access on commands/routes uses permission predicates (`requireAny` / `requireAll` / `denyIf` / …). Prefer registering complete structures then resync; freeze after boot.
