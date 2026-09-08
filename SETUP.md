# Zene Setup

## Requirements

- Node.js `>= 20`
- A Discord bot token and application

## Install

```bash
npm ci
cp .env.example .env   # if present; otherwise create .env
```

## Minimal environment

| Variable | Purpose |
|----------|---------|
| `DiscordToken` | Bot token (stays in `process.env`; not scrubbed) |
| `BotOwnerIds` | Comma-separated Discord user IDs with synthetic `bot.owner` |
| `Database` | JSON map of alias → `{ uri, engine? }` (optional; sqlite + SurrealDB defaults exist) |
| `TokenMasterSecret` | ≥32 chars if using the token plugin |

Placeholders such as `${env:DiscordToken}` or `${rand:hex:32}` may appear in env values and in `configuration/*.json5`. See [PLACEHOLDERS.md](PLACEHOLDERS.md).

## First run

```bash
npm run build    # or: npm run dev for TypeScript directly
npm start
```

On first boot:

1. Secrets assimilate (`process.env` catalog + append-only lock) + env placeholder expansion  
2. Plugin discovery, config/lang **merge-preserve** sync into `configuration/` (add missing defaults; keep your keys/comments)  
3. Config/lang load: expand → Zod/rules → dual raw/runtime registries  
4. Databases, permissions, Discord login, plugin boot  

## Build output

`npm run build` compiles TypeScript to the **repo root** (and plugin trees) according to `tsconfig.json` — runtime entry is `node --import ./core/dependency/index.mjs ./index.js` (see `package.json` `start`). Do not assume a separate `dist/` root unless `tsconfig` is changed.

Defaults for env keys live in `src/core/defaults.ts` (single source of truth). Boot order is owned by `src/core/bootstrap/pipeline.ts`.

## Configuration files

- Plugin defaults: `plugins/<id>/data/configuration/config.json5`  
- Runtime (editable): `configuration/<id>.json5` (primary stem; not `<id>-config`)  
- Lang: `configuration/lang/<id>_<locale>.json5`  

Never commit expanded secrets. Disk always keeps `${env:…}` / `${secret:…}` / tagged rand placeholders.

## Docs index

- [README.md](README.md)  
- [PLACEHOLDERS.md](PLACEHOLDERS.md)  
- [ENV Reference.md](ENV%20Reference.md)  
- [Database.md](Database.md)  
- [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md)

## SecretManager and process.env

Secrets are stored in `process.env` as the source of truth. The vault no longer encrypts values in memory or scrubs sensitive keys from the environment. Shard children inherit `DiscordToken`, `ZENE_BOOT_SHARED_RAND`, and other keys by normal process inheritance.

Any plugin or dependency can read `process.env.DiscordToken` (and other keys) directly. That is intentional: isolation was traded for a correct sharding flow. Treat third-party plugins as fully trusted with respect to environment access.


## Admin hot reload

Under `/admin` (owner-gated): `reload-config`, `reload-lang`, `reload-env` (`.env` / `.env.local` only), `reload-emoji`, `cache-list` / `cache-pop`, audit/error list/get, gate commands. Env reload uses a sealed allow-set from keys present in the env file; `#tag` rand stays process-stable across reload. See [PLACEHOLDERS.md](PLACEHOLDERS.md) and [LOADER.md](LOADER.md).

## Cross-Host multi-machine (optional)

1. Provision **Redis** reachable by all hosts (`Database.crosshost` preferred, else `Database.main` with redis URI).
2. Set shared `CROSS_HOST_CLUSTER_SECRET` on every machine.
3. **Orchestrator** (one active claim):
   - `CROSS_HOST=true`, `CROSS_HOST_ROLE=orchestrator`
   - `DiscordToken`, config/lang/emoji on disk (source of truth)
   - Start process; verify `GET /health` on `CROSS_HOST_HTTP_PORT` (default 8020)
4. **Workers** (N machines):
   - `CROSS_HOST=true`, `CROSS_HOST_ROLE=worker`
   - `CROSS_HOST_MACHINE_ID` unique per machine
   - `CROSS_HOST_ORCHESTRATOR_URL` pointing at orchestrator HTTP
   - Same cluster secret and Redis map; **no sqlite** aliases in `Database`
5. Optional: `CROSS_HOST_INDEX_ENABLED=true` with backend `redis` (default) or `postgres` (`Database.crosshost_index` or postgres `main`).

Do not enable Cross-Host with sqlite/file engines — boot will fail the storage gate. Full runbook: [CROSS_HOST.md](CROSS_HOST.md).

## Optional: `@lunedusk/gateway-multiplex`

Cross-Host-only raw Discord gateway helper (WebSocket per shard). **Not** a replacement for root `discord.js`.

```bash
# from repo root
npm run install-packages
# or:
cd packages/gateway-multiplex && npm install && npm run build && cd ../..
npm install ./packages/gateway-multiplex
```

Root `package.json` already depends on `"@lunedusk/gateway-multiplex": "file:packages/gateway-multiplex"`.

| Path | Role |
|------|------|
| `node_modules/discord.js` (or `discord.js` dep) | **Required** for all modes (normal, classic sharded, Cross-Host workers via `DiscordShardAdapter`) |
| `packages/gateway-multiplex` | Optional raw gateway; load only when `CROSS_HOST=true` via `#core/crosshost/gateway/multiplexLoader.js` |

Keep **both**: stock `discord.js` for the bot; multiplex as a separate local package when experimenting with raw gateway multiplexing.

## Route probe

1. Start the bot (normal, sharded, or cross-host worker) with the **token** plugin and `TokenMasterSecret` set.
2. Run the probe (env form recommended):

```bash
PROBE_BASE_URL=http://127.0.0.1:8011 \
PROBE_USER_ID=your_discord_id \
PROBE_TOKEN_MASTER_SECRET=same_as_bot_TokenMasterSecret \
node scripts/route-probe.mjs
```

3. The probe tries **issue → verify → refresh**, captures the bearer, then hits authenticated routes.
4. Optional: `PROBE_TOKEN` if you already have a bearer; `PROBE_ALLOW_RESTART=1` for restart cases.
5. Report: `route-probe-report.json` (or `PROBE_REPORT_PATH`).

Also listed from [README.md](README.md).
