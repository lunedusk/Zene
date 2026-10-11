# Documentation source traceability

## Snapshot used

All implementation claims in this bundle are anchored to Zene commit [`c510bbf8fde1fedffd05efe2779ee71e90d5597d`](https://github.com/lunedusk/Zene/commit/c510bbf8fde1fedffd05efe2779ee71e90d5597d), parent `d064c72f6da65c3683afb58648ef11f3123688ea`. The root package metadata at that revision declares Zene `0.5.7`, pure ESM, Node.js `>=20.0.0`, and `discord.js` v14.

## Primary source map

| Documentation | Primary implementation sources reviewed |
|---|---|
| `README.md`, `ARCHITECTURE.md` | `package.json`, `src/index.ts`, `src/core/bootstrap/pipeline.ts`, `src/core/defaults.ts`, `src/core/config/precedence.ts`, `src/core/heart/index.ts`, `src/core/bases/` |
| `SETUP.md`, `CONTRIBUTING.md`, `OPERATIONS.md`, `TESTING.md` | `package.json`, `src/index.ts`, `src/core/database/bootstrap.ts`, source and test layout under `src/core/` and `src/plugins/` |
| `PLUGINS.md`, `CORE_API_REFERENCE.md` | `src/core/bases/Plugin.ts`, `Command.ts`, `Event.ts`, `Handler.ts`, `Middleware.ts`, `Route.ts`; `src/core/heart/index.ts` and its domain modules; `src/core/heart/registry.ts`; config/language/emoji managers |
| `SDK_REFERENCE.md`, `packages/zene-sdk/README.md` | `packages/zene-sdk/package.json`, `packages/zene-sdk/src/index.ts`, `types.ts`, `version.ts`, `bridge.ts`, `plugin.ts`, `data.ts`, `dashboard.ts`, `crosshost.ts`, `domains.ts`, `commands.ts`, `http.ts`, and `discord/` exports; Core host implementation in `src/sdk/coreBridgeFactory.ts` |
| `LOADER.md` | `src/core/loader/index.ts`, `discovery.ts`, `dependency.ts`, `requirements.ts`, `integrityGate.ts`, `config.ts`, `lang.ts`, `commands.ts`, `events.ts`, `handler.ts`, `middlewares.ts`, `routes.ts` |
| `INTEGRITY.md`, `SECURITY.md` | `src/core/helpers/integrity/`, `src/core/loader/integrityGate.ts`, `src/core/runtime/authenticatedPolicy.ts`, `src/core/runtime/selector.ts`, `src/core/provider/authorization.ts`, `src/core/provider/declarations.ts`, `src/core/provider/binding.ts`, secret manager and logging/redaction code |
| `RUNTIME.md` | `src/core/runtime/manager.ts`, `types.ts`, `selector.ts`, `availability.ts`, `backends.ts`, `protocol.ts`, `messageValidation.ts`, `bridge.ts`, `host/`, `pluginRuntimeRecord.ts`; `src/core/lifecycle/` |
| `Database.md` | `src/core/database/index.ts`, `bootstrap.ts`, `backendSelector.ts`, `surreal.ts`, `surrealRecord.ts`, adapter files and `src/core/database/migrations/runner.ts` |
| `DATA_SHAPES.md` | `src/core/data/types.ts`, `policy.ts`, `storage.ts`, `registry.ts`, `bootstrap.ts`, `adapters/`; `src/core/audit/types.ts`, `src/core/errors/types.ts`, SDK types, runtime protocol and `src/core/crosshost/types.ts` |
| `ENV Reference.md` | `src/core/defaults.ts`, `src/core/helpers/secretManager.ts`, `src/core/config/precedence.ts`, `src/core/database/bootstrap.ts`, `backendSelector.ts`, `src/core/crosshost/env.ts`, updater config, token subsystem, runtime manager, dashboard environment reads and `src/scripts/migrate-nova-to-surreal.ts` |
| `CROSS_HOST.md` | `src/core/crosshost/bootstrap.ts`, `env.ts`, `types.ts`, `orchestrator/`, `worker/`, `protocol/`, `query/`, `indexStore/`, `storageGate.ts`, `src/core/heart/control.ts`, `src/core/heart/crossHost.ts` |
| `EVENTS.md` | `src/core/manager/events/EventBus.ts`, `src/core/manager/events/`, `src/core/manager/event.ts`, Core and Discord bridged event types, and event call sites in loader/runtime/audit/error/Cross-Host code |
| `AUDIT.md` | `src/core/audit/index.ts`, `store.ts`, `types.ts`, `redact.ts`, `src/core/crosshost/indexStore/` |
| `ERRORS.md` | `src/core/errors/index.ts`, `store.ts`, `types.ts`, `NovaError.ts`, `catcher.ts`, `src/core/database/surrealRecord.ts` |
| `CACHE.md` | `src/core/manager/cacheFacade.ts`, `src/core/helpers/cache.ts`, `src/core/database/redis.ts`, `src/core/manager/cooldown.ts` |
| `PLACEHOLDERS.md` | `src/core/placeholder/index.ts`, `sharedBootRand.ts`, `src/core/bootstrap/pipeline.ts`, `src/core/manager/config.ts`, `lang.ts`, `emoji.ts` |
| `UPDATER.md` | `src/core/manager/updater/`, `src/index.ts`, `src/scripts/manifestPacker.ts`, and `package.json` scripts |
| `GLOSSARY.md` | Shared names and types from the sources listed above |
| `System Prompt - AI - Plugin.md` | Cross-cutting source map above, with particular attention to plugin base classes, IHeart, published SDK, loader requirements, runtime lifecycle, data policy, and test rules |

## Specific source-grounded behaviors called out

- `IHeart` is an injectable Core service object and is broader/more privileged than the public SDK. The public SDK is defined in `packages/zene-sdk/src/` and Core installs an authorized runtime-generation bridge in `src/sdk/coreBridgeFactory.ts`.
- `SecretManager` reads and writes values in `process.env`; it does not encrypt the entire process environment or keep secrets inaccessible to in-process code.
- Runtime isolation levels are ordered `in-process`, `worker`, `process`, `container`, `external`, but the guarantees differ. In-process unload is not equivalent to destroying the process address space or fully garbage-collecting the native ESM module graph.
- Core data authorization is governed by `src/core/data/policy.ts` and the registry. `deleteUserGlobal`, `deleteGuildServer`, and `deletePluginData` are Core-owned registry functions, not public SDK data methods.
- `Database` is an alias-to-connection JSON map. An alias is not a SurrealDB namespace/database name. `CROSS_HOST` rejects embedded/file-local database engines for the relevant configured paths and requires a supported shared storage/Redis topology.
- Surreal logical identifiers are stored separately from Surreal's reserved record `id` using `logicalKey`/`key`; `src/core/database/surrealRecord.ts` allowlists tables and provides record-identity helpers.
- Audit/error occurrence schema initialization and reads are implemented in their stores. The stores address `surrealDB.get('main')`; connection alias, namespace and database are separate configuration dimensions.
- The Core environment inventory covers fixed subsystem settings and script-only inputs visible at this baseline. Arbitrary keys read by plugin-defined requirements, third-party plugins and generic environment mechanisms are not a finite built-in inventory. Known test harness variables are excluded from production settings tables.

## Validation provenance

The source and documentation were inspected through the public GitHub source tree at the baseline commit. The following test results were supplied by the repository owner from their local checkout; this documentation pass did not rerun them:

- `npx tsx --test src/core/database/surrealRecord.unit.test.ts` — 2 passed, 0 failed.
- `ZENE_DATA_INTEGRATION=1 npx tsx --test src/core/database/phase4-surreal-stores.integration.test.ts src/core/data/phase4a2-external.integration.test.ts` — 8 passed, 0 failed, 0 skipped, per the owner's reported terminal output.
- `npm run slim-build` — completed without reported errors.

No full `npm run build` result or full-suite result was provided. The GitHub status/workflow lookup for the baseline showed no published workflow runs/status checks. A network attempt to clone the repository from this environment failed because `github.com` could not be resolved, so no additional build/test claim is made.

## Deliberate scope limits

This bundle improves the written contract and the package SDK README, but it does not change source code or deployment templates. The existing `.env.example` was not replaced. Its `Database` example contains descriptive placeholder values and should be reviewed as a separate configuration-template fix; do not treat it as a validated, ready-to-run database alias configuration. Do not assume every first-party plugin has been exhaustively documented merely because the Core service surfaces are documented.
