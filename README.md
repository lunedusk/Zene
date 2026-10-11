# Zene

**Zene** is a modular Discord application framework for Node.js, written in TypeScript and published as pure ECMAScript modules. The repository version at the documentation baseline is `0.5.7`; the minimum Node.js engine declared by the root package is `>=20.0.0`. Zene builds on `discord.js` v14 and provides a plugin loader, host-injected plugin services, multiple database managers, configuration and localization loading, permission services, runtime lifecycle management, signed-artifact verification, and an optional Cross-Host control plane.

## Start here

- **[Setup](SETUP.md):** install, configure, start, validate, and diagnose a first deployment.
- **[Plugin author guide](PLUGINS.md):** create plugins using the conventions recognized by the loader.
- **[Architecture](ARCHITECTURE.md):** understand Core, the plugin lifecycle, service domains, runtimes, and storage boundaries.
- **[AI plugin-development system prompt](System%20Prompt%20-%20AI%20-%20Plugin.md):** one standalone prompt for AI-assisted implementation, debugging, review, and extension work.
- **[Public SDK reference](SDK_REFERENCE.md):** distinguish the published `@lunedusk/zene-sdk` contract from Core's `IHeart` API.
- **[Environment reference](ENV%20Reference.md):** environment inputs, defaults, security implications, and structured values.

## Capabilities at a glance

| Area | What the repository provides | Key reference |
|---|---|---|
| Plugin packaging and discovery | Plugin metadata, dependency ordering, trust/integrity gates, configuration/language assets, and lifecycle loading | [Loader](LOADER.md), [Integrity](INTEGRITY.md) |
| Plugin-facing Core API | Per-plugin `IHeart` domain surface including assets, event bus, database managers, HTTP/metrics, permissions, tokens, cache, registry, and helpers | [Plugin author guide](PLUGINS.md) |
| Published plugin SDK | Typed, capability-injected bridge with session/runtime identity and generation-aware cleanup | [SDK reference](SDK_REFERENCE.md) |
| Runtime isolation | In-process, worker, process, container, and external runtime levels, selected under an explicit policy | [Runtime architecture](RUNTIME.md) |
| Persistence | SQLite, PostgreSQL, MongoDB, Redis, SurrealDB and a dedicated Core data registry with privacy metadata | [Database](Database.md), [Data and privacy](DATA_SHAPES.md) |
| Operational diagnostics | Structured event bus, audit records, coalesced error occurrences, metrics, update planning and rollback support where configured | [Events](EVENTS.md), [Audit](AUDIT.md), [Errors](ERRORS.md), [Updater](UPDATER.md) |
| Multi-machine operation | Optional Cross-Host orchestrator/worker protocol with Redis-backed coordination and shard assignment | [Cross-Host](CROSS_HOST.md) |

## Supported design boundaries

Zene is a framework, not a guarantee that arbitrary plugin code is safe. A plugin executing in-process shares the Core process and memory space. Worker and process runtimes improve execution and memory isolation but still share host filesystem and network unless additional restrictions apply. Container and external runtime guarantees depend on the configured backend. Runtime choice does not replace artifact verification, least-privilege service design, or operational isolation.

The repository exposes two plugin service models that must not be confused:

1. **Core `IHeart`:** the rich service surface used by the first-party loader and in-process plugin base classes. Some members expose powerful Core services and require trusted code.
2. **`@lunedusk/zene-sdk`:** a separate typed public package intended to expose an injected capability bridge. Its contract is narrower and generation-scoped. It does not make Core private internals part of the public SDK.

Use the published SDK for new third-party plugins where the selected runtime and host integration support it. If a plugin intentionally uses `IHeart`, document that dependency and its runtime trust assumptions.

## License

The root package declares `PolyForm-Noncommercial-1.0.0`. Read the repository's `LICENSE` before redistribution or commercial use. Do not infer licensing rights for a plugin from Zene's license; plugins can have their own terms.

## Documentation map

- [Architecture](ARCHITECTURE.md)
- [Setup and operations](SETUP.md), [Operations and troubleshooting](OPERATIONS.md), [Testing](TESTING.md)
- [Plugin authoring](PLUGINS.md), [loader behavior](LOADER.md), [public SDK](SDK_REFERENCE.md), [AI prompt](System%20Prompt%20-%20AI%20-%20Plugin.md)
- [Runtime selection and isolation](RUNTIME.md), [integrity and trust](INTEGRITY.md), [security model](SECURITY.md)
- [Database configuration](Database.md), [data shapes and privacy](DATA_SHAPES.md), [environment variables](ENV%20Reference.md)
- [Events](EVENTS.md), [audit](AUDIT.md), [errors](ERRORS.md), [cache](CACHE.md), [placeholders](PLACEHOLDERS.md)
- [Contributing](CONTRIBUTING.md) and source-level [traceability](SOURCE_TRACEABILITY.md)
- [Cross-Host](CROSS_HOST.md), [updater](UPDATER.md), [glossary](GLOSSARY.md)

