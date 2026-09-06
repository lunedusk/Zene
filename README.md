# Zene

**v0.5.6** — modular Discord application framework in TypeScript (pure ESM, Node ≥ 20, discord.js v14).

Built for production bots: plugin sandboxing, integrity checks, polyglot storage, ranked permissions, optional multi-machine sharding, and a full HTTP/dashboard surface.

Credits: [VeduStorm](https://github.com/VeduStorm) · [Lunedusk](https://github.com/lunedusk)

---

## Why Zene

| Capability | What you get |
|------------|----------------|
| **Plugins** | Isolated workspaces, dependency graph boot, signed manifests |
| **Permissions** | Ranked bits, role links, optional Discord-permission mirror |
| **Storage** | SQLite / Postgres / Mongo / Redis — shared backend selector |
| **HTTP API** | Tokens, permissions, audit, gates, dashboard admin |
| **Cross-Host** | Multi-machine shards (env-gated; classic paths unchanged) |
| **UX** | CV2/embed builders, atomic paginator, lang-backed errors |

---

## Quick start

```bash
npm install
cp .env.example .env   # or your env layout — see SETUP.md
# set at least: DiscordToken, BotOwnerIds, Database, TokenMasterSecret
npm run build
npm start
```

Full install, env, and first-run: **[SETUP.md](SETUP.md)**  
Every environment variable: **[ENV Reference.md](ENV%20Reference.md)**

---

## Documentation map

Start here, then follow the links that match your task.

| Doc | When to open it |
|-----|-----------------|
| [SETUP.md](SETUP.md) | Install, env, first boot, route probe |
| [ENV Reference.md](ENV%20Reference.md) | All env keys (including `TokenMasterSecret`) |
| [PLUGINS.md](PLUGINS.md) | Writing plugins, registration, requirements |
| [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) | Authoring contract for plugin agents |
| [LOADER.md](LOADER.md) | Config/lang loaders, help filter |
| [Database.md](Database.md) | Engines, schemas, permission link tables |
| [NovaDB.md](NovaDB.md) | NovaDB specifics |
| [CROSS_HOST.md](CROSS_HOST.md) | Multi-machine sharding |
| [EVENTS.md](EVENTS.md) | Framework + plugin events |
| [ERRORS.md](ERRORS.md) | Error registry + core lang codes |
| [AUDIT.md](AUDIT.md) | Audit log |
| [CACHE.md](CACHE.md) | Cache façade |
| [UPDATER.md](UPDATER.md) | Auto-updater & release packaging excludes |
| [PLACEHOLDERS.md](PLACEHOLDERS.md) | Placeholder resolution |
| [INTEGRITY.md](INTEGRITY.md) | Manifest / hash integrity |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community |

---

## Project layout

```
zene/
├── src/
│   ├── index.ts              # process entry
│   ├── core/                 # framework
│   │   ├── heart/            # injected context surface
│   │   ├── loader/           # plugins, commands, requirements
│   │   ├── manager/          # config, lang, permissions, guildGate/Access/Locale, featureRequirements, tokens, HTTP, updater…
│   │   ├── permissions/      # hierarchy + Discord mirror
│   │   ├── paginator/        # in-process atomic paginator
│   │   ├── crosshost/        # orchestrator / worker (env-gated)
│   │   ├── builders/         # embed + Components V2
│   │   ├── bases/            # Command, Event, Route, Handler, Plugin
│   │   └── …
│   ├── plugins/              # first-party plugins
│   │   ├── core/             # admin, help, moderation handlers
│   │   ├── api/              # gateway + OpenAPI
│   │   ├── token/            # bearer tokens
│   │   ├── permissions/      # bits, roles, links, mirror
│   │   ├── dashboard/        # admin HTTP + UI APIs
│   │   └── dash-data/        # dashboard persistence
│   ├── database/             # adapters / migrations helpers
│   └── scripts/              # packers and tooling
├── packages/
│   ├── json2discord/         # @lunedusk/json2discord
│   ├── paginator/            # @lunedusk/paginator
│   └── …                     # optional local deps
├── configuration/            # default config / lang samples
├── scripts/                  # e.g. route-probe.mjs
├── apps/                     # optional frontends (dashboard)
└── docs via *.md at repo root
```

---

## Core features (operator view)

### Permissions

- Built-in **ranked** bits (`getBitRank`). Hierarchy is strict greater-than (no lateral hits).
- Env **`BotOwnerIds`** sit above `bot.owner`.
- Discord role ↔ perm role **links** with grant provenance (`direct` / `discord_role`): `/permissions links`.
- Per-guild Discord permission **mirror** (default off): `/permissions mirror`.
- Route/command access: `require` · `requireAll` · `requireAny` · `denyIf` · `denyIfAny`.

Details: [PLUGINS.md](PLUGINS.md) · [Database.md](Database.md) · [EVENTS.md](EVENTS.md)

### Guild gate vs guild access

| System | Effect | Config (core) | Commands |
|--------|--------|---------------|----------|
| **Guild gate** | Soft-block commands/plugins; bot **stays** | `guildGate.enabled` | `/admin gate …` (DM + guild) |
| **Guild access** | **Leave** disallowed guilds | `guildAccess.*` policy | `/admin access …` (DM + guild) |

Lists live in the DB (shared `dataBackend` soft-resolve). `allowOwner` records inviters who own the bot (env / `bot.owner`) so those guilds are not left. Default locale remains env **`DefaultLocale`**. Optional **guild locale pick** (`guildLocale` / `guildLangFiles`) resolves via `lang.get` without edit commands yet.

### Feature requirements registry

Core and plugins register Discord **intents** + **permissions** they need (`featureRequirements.register`). Missing intents → one soft console warn listing features. On join, missing permissions → try DM the Discord server owner, else a staff/sendable channel with an owner ping. Standalone, classic shard, and Cross-Host workers each run this on the Client that owns the guild.

→ [PLUGINS.md](PLUGINS.md) · [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) · [EVENTS.md](EVENTS.md)

### Cross-Host

Optional multi-machine sharding. Classic standalone and single-host `ShardingManager` stay unchanged when `CROSS_HOST` is off.

→ [CROSS_HOST.md](CROSS_HOST.md) · [EVENTS.md](EVENTS.md)

### HTTP & dashboard

Bearer tokens (`/api/tokens/*`), permissions, audit, gates, emoji, and the dashboard admin API (`/api/dash/*`). OpenAPI is attached on route modules; aggregate document when the API plugin exposes `/api/openapi.json`.

### Paginator

Long lists (bits, holders, help) use the in-process paginator (`heart.paginator`) or the publishable **`@lunedusk/paginator`** package (depends on `@lunedusk/json2discord`).

### Auto-updater

Crash-safe updates with hard excludes for `.github`, `node_modules`, env files, and related junk.

→ [UPDATER.md](UPDATER.md)

## License

**PolyForm Noncommercial License 1.0.0** — free for personal and non-commercial use; commercial use requires a separate arrangement with the authors. See [LICENSE](LICENSE).
