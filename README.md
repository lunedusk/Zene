# Zene

Zene is a modular Discord application framework for Node.js. It is designed for long-running bots and multi-plugin deployments that need clear lifecycle boundaries, signed plugin artifacts, durable storage options, and optional multi-machine coordination.

**Version:** 0.5.7 · **Runtime:** Node.js ≥ 20 · **Language:** TypeScript (pure ESM) · **Discord API:** discord.js v14

## What Zene provides

- **Plugin workspaces** with dependency-aware boot order, integrity verification, and generation-scoped resources
- **Core-owned services** for configuration, logging, events, permissions, HTTP routes, and dashboard sessions
- **Database managers** for SQLite, PostgreSQL, MongoDB, Redis, and SurrealDB (remote or embedded)
- **A public plugin SDK** (`@lunedusk/zene-sdk`) that does not import Core internals
- **Optional Cross-Host** operation for multi-worker deployments with shared remote storage

Zene is a Discord-bot framework, not a generic web application platform.

## Requirements

- Node.js 20 or later
- npm (repository scripts assume npm)
- A Discord bot token
- Write access for `.data/`, `logs/`, and plugin output directories

## Quick start

```bash
git clone https://github.com/lunedusk/Zene.git
cd Zene
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```bash
DiscordToken=your_bot_token
BotOwnerIds=your_discord_user_id
```

Then:

```bash
npm run build
npm start
```

For a full first-run walkthrough, see [SETUP.md](SETUP.md).

## Documentation map

| Document | Purpose |
|----------|---------|
| [SETUP.md](SETUP.md) | Install, configure, and run Zene |
| [PLUGINS.md](PLUGINS.md) | Human plugin author guide |
| [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) | Copy-paste system prompt for AI-assisted plugin work |
| [Database.md](Database.md) | Database engines, aliases, and Core data storage |
| [ENV Reference.md](ENV%20Reference.md) | Environment and configuration reference |
| [CROSS_HOST.md](CROSS_HOST.md) | Multi-machine roles and shared storage |
| [LOADER.md](LOADER.md) | Plugin discovery and loading |
| [INTEGRITY.md](INTEGRITY.md) | Artifact signing, verification, and trust |
| [EVENTS.md](EVENTS.md) | EventBus and Discord event bridging |
| [ERRORS.md](ERRORS.md) | Error model and persistence |
| [AUDIT.md](AUDIT.md) | Audit record model |
| [CACHE.md](CACHE.md) | Cache layers and backends |
| [DATA_SHAPES.md](DATA_SHAPES.md) | Important type shapes and source locations |
| [PLACEHOLDERS.md](PLACEHOLDERS.md) | Placeholder expansion |
| [UPDATER.md](UPDATER.md) | Update check, apply, and rollback |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

## Build and run scripts

| Script | Action |
|--------|--------|
| `npm run build` | Full compile and asset copy |
| `npm run slim-build` | TypeScript compile focused build |
| `npm start` | Start the compiled application |
| `npm run dev` | Development entry (see package scripts) |
| `npm run pack -- <plugin>` | Pack a plugin artifact |
| `npm run build:zene-sdk` | Build the public SDK package |
| `npm run docs` | Generate API docs when configured |

## Architecture overview

```text
Boot → database init → plugin discovery → integrity/trust
    → dependency order → load (commands/events/handlers/routes)
    → lifecycle setup/enable → runtime services
```

Plugins interact with Core through `this.heart.*` (in-tree) or the injected public SDK bridge (third-party). Third-party plugins must not import `#core/*` or private registries.

## License

See [LICENSE](LICENSE) for the project license terms.
