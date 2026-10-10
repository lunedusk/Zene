# Setup guide

This guide takes a clean checkout of Zene from install to a successful first boot.

## Prerequisites

- **Node.js** ≥ 20 (see `engines` in `package.json`)
- **npm** available on `PATH`
- A Discord application with a bot token
- Network access for Discord and any remote databases you configure

Optional for advanced features:

- PostgreSQL, MongoDB, Redis, or SurrealDB services for durable backends
- Secrets suitable for token signing and Cross-Host if those features are enabled

## Install

```bash
git clone https://github.com/lunedusk/Zene.git
cd Zene
npm install
```

`postinstall` prepares plugin dependency workspaces used by the loader. Do not skip it in normal installs.

## Configuration

```bash
cp .env.example .env
```

### Minimum required values

| Variable | Purpose |
|----------|---------|
| `DiscordToken` | Discord bot token |
| `BotOwnerIds` | Comma-separated Discord user IDs treated as bot owners |

### Common optional values

| Variable | Purpose |
|----------|---------|
| `DefaultLocale` | Default language code (default often `en`) |
| `APIPort` | HTTP API listen port when the HTTP server is enabled |
| `LogLevel` | Logging verbosity |
| `Database` | JSON map of database aliases (see [Database.md](Database.md)) |
| `TokenMasterSecret` | Required when token features need a master secret (use ≥ 32 characters) |
| `CROSS_HOST` | Enable multi-machine mode when set appropriately |

Treat all tokens and secrets as sensitive. Never commit `.env`.

Full field documentation: [ENV Reference.md](ENV%20Reference.md).

## Database defaults

If you do not configure `Database`, Core can provision local defaults for development (for example embedded SQLite or SurrealDB under `.data/`, subject to disable flags such as `DisableDefaultSurrealDB`). Production deployments should set explicit remote aliases and credentials.

Cross-Host deployments must use **shared remote** databases for shared state. Embedded local-file engines are not valid as the shared Cross-Host store.

## Build and start

```bash
npm run build
npm start
```

For a TypeScript-focused compile path used in many validation workflows:

```bash
npm run slim-build
```

### Expected first-boot effects

- Log output under the configured log directory
- Data directories under `.data/` when local engines are used
- Plugin discovery from configured plugin roots
- Discord gateway login when `DiscordToken` is valid

## Common failures

| Symptom | Likely cause |
|---------|----------------|
| Login / gateway errors | Invalid or missing `DiscordToken` |
| Permission / owner checks always fail | `BotOwnerIds` not set to your user ID |
| Database connection errors | Invalid `Database` JSON, wrong URI, or service down |
| Surreal WebSocket errors under Node | Ensure Core uses the shared Surreal client (Node `ws` binding); do not construct ad-hoc clients without `websocketImpl` |
| Plugin fails integrity | Unsigned or tampered artifact; see [INTEGRITY.md](INTEGRITY.md) |

## Local development versus production

**Local development**

- Prefer minimal `.env`
- Local SQLite/embedded Surreal is acceptable for single-process work
- Hot paths and test databases should stay isolated from production data

**Production**

- Use strong unique secrets
- Prefer managed remote databases with backups
- Restrict dashboard and HTTP exposure
- Enable only the intents and privileges the deployment needs
- Do not run Cross-Host with worker-local embedded databases for shared records

## Next steps

- Author plugins: [PLUGINS.md](PLUGINS.md)
- AI-assisted plugin work: [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md)
- Multi-machine: [CROSS_HOST.md](CROSS_HOST.md)
