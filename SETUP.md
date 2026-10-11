# Installation and setup guide

This document covers a clean local setup and the decisions needed before exposing a bot publicly. The commands assume a Unix-like shell and an npm-based checkout.

## 1. Prerequisites

- Node.js `>=20.0.0` (the root `package.json` declares this engine requirement).
- npm and a working compiler/toolchain for native dependencies where needed.
- A Discord application and bot token if you intend to connect to Discord.
- Network access to Discord and any remote service you configure.
- A database chosen for each subsystem you plan to use. For a simple local instance, the code can provision default local stores; production multi-process or Cross-Host workloads need deliberate shared-storage choices.

## 2. Install dependencies

```bash
npm ci
cp .env.example .env
```

Inspect `.env.example` rather than assuming its `Database` line is valid JSON for your intended deployment. The example is a template, not a complete engine matrix. The `Database` setting is a JSON **object mapping aliases to connection objects**. Its connection fields include `uri`, optional `engine`, optional `poolSize` and `maxRetries`, plus SurrealDB-specific `namespace`, `database`, `username`, `password` and `token`.

A conventional SurrealDB remote entry looks like:

```dotenv
Database={"main":{"uri":"ws://127.0.0.1:8000","engine":"surrealdb","namespace":"zene","database":"main","username":"root","password":"REPLACE_ME"}}
```

The exact authentication mode depends on your Surreal server. Do not copy demo credentials into a public deployment.

## 3. Minimum Discord configuration

Set `DiscordToken` to the token for your bot. The root defaults registry marks this key required and sensitive. Do not commit it, paste it into issues, or put it into logs. Configure `DiscordIntents` only when you need a deliberate override; `src/index.ts` builds intents through the Core intent builder. The bot must have the Discord application permissions and gateway intents required by the installed plugins.

Set `NODE_ENV=production` for production-like behavior; Core materializes this default if unset. Set `BotOwnerIds` to a comma-separated list only for the operator accounts that should be recognized as owners by features that consult that setting.

## 4. Run a build

```bash
npm run build
```

`build` cleans generated outputs, builds the local gateway multiplex and Zene SDK packages, compiles Core, and copies runtime assets. The leaner command:

```bash
npm run slim-build
```

cleans outputs, compiles the current workspace and copies assets without the `install-packages` step. Use the full build when verifying a clean install or SDK/package changes; use the slim build for a faster local source check only when its prerequisites are already built.

The root package uses ESM and compiled import mappings such as `#core/*`, `#plugins/*`, and `#scripts/*`. Do not run the compiled entrypoint against an incomplete generated output tree.

## 5. Start Zene

```bash
npm start
```

This runs the compiled `index.js` with the dependency bootstrap preloaded. For development, inspect the current `dev` script in `package.json`; it runs `tsx` against `src/index.ts` with the dependency bootstrap import. Avoid combining development and production generated files without understanding which version is being executed.

## 6. Database bootstrap

`Database` is parsed as an alias map in `src/core/database/bootstrap.ts`. Each entry is initialized through `DatabaseManager`; failed configured entries are logged. Zene can provision default `main` SQLite and embedded SurrealDB stores if no corresponding alias exists and the default-disable flags are false. It skips those embedded defaults in Cross-Host mode. The Core data platform initializes after database manager bootstrapping and resolves a usable backend from connected managers.

Useful controls include:

- `DisableDefaultSqlite=true` — disables the built-in local SQLite fallback. Core features relying on SQLite can then be unavailable if no compatible configured backend exists.
- `DisableDefaultSurrealDB=true` — disables the default local `main` SurrealDB instance.
- `CoreDataEngine` and `CoreDataAlias` — explicit selection for the Core data registry, or use the `core.dataBackend` config path when configured.

For multi-worker deployment, choose shared backends and aliases intentionally. See [Database](Database.md), [Data shapes and privacy](DATA_SHAPES.md), and [Cross-Host](CROSS_HOST.md).

## 7. Production checklist

Before first public deployment:

- Keep `allowUnCertifiedPlugins=false` unless you fully understand the trust bypass consequences.
- Control who can place plugin artifacts into the plugin directory; validate signing keys and the artifact trust path.
- Set strong secrets for enabled subsystems, especially `TokenMasterSecret`, signing keys and Cross-Host cluster authentication.
- Do not expose dashboard/admin endpoints directly to the Internet until auth, allowed origins, proxy configuration and route permissions have been reviewed.
- Put persistent database files, backups and logs on protected storage. Ensure backup restoration is tested.
- Prefer remote/durable database backends where data must survive host replacement. Do not treat process-local cache data as shared state.
- Use least-privilege database credentials and network firewall rules.
- Make a dry-run updater plan before applying an update to a production installation.
- Keep the Core release and plugin artifacts/version requirements mutually compatible.

## 8. Run focused tests

```bash
npx tsx --test src/core/database/surrealRecord.unit.test.ts
npm run slim-build
```

Optional service-backed integration suites depend on local services and are gated by their test environment variables. Keep test-only environment settings out of the production `.env` file and public deployment documentation. See [Testing](TESTING.md).

## 9. Common first-boot failures

### Missing Discord token or login errors
Check `DiscordToken`, ensure it is the bot token rather than an application secret, and verify that the bot has not been reset.

### Database alias not found
Check the `Database` JSON syntax, alias, URI scheme and engine. The `main` label is an application alias, not a database name. Ensure the subsystem is configured to use the same alias that was connected.

### Data platform refuses memory fallback
This is intentionally fail-closed for durable production requirements. Configure a compatible connected backend or explicitly enable memory only in suitable test/development setup.

### Plugin rejected before boot
Inspect integrity/trust logs, signed artifact validity, signer key selection, plugin metadata, Node/Core version requirements, dependency declarations, and plugin disable/validation results. A failed signed artifact must not silently fall back to an unsigned manifest.

### Commands are not visible in Discord
Confirm plugin boot completed, the command loader recognized the files, requirements passed, permission defaults are valid and application command synchronization completed. Guild-scoped sync and global sync have different propagation behavior.

### Isolated plugin cannot import Core internals
That is an architectural boundary. Use the injected SDK or adjust the runtime/plugin contract deliberately; do not rely on accidental access to Core source aliases from an isolated runtime.

## 10. Where next

- [Plugin authoring](PLUGINS.md)
- [AI prompt](System%20Prompt%20-%20AI%20-%20Plugin.md)
- [Runtime isolation](RUNTIME.md)
- [Security model](SECURITY.md)
- [Troubleshooting](OPERATIONS.md)
