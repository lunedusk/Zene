# Zene architecture reference

## 1. System overview

Zene is a Node.js/TypeScript ESM application whose Core process owns boot sequencing, Discord gateway lifecycle, plugin discovery, configuration and localization, permission initialization, database managers, runtime establishment, interaction routing, observability, and shutdown coordination. Plugins add behavior through loader-recognized surfaces and host-provided services.

At a conceptual level the runtime is composed of the following layers:

1. **Boot pipeline** — loads environment configuration, materializes selected defaults, expands placeholders, applies shared boot preparation, and chooses normal bot mode or updater-only mode.
2. **Core infrastructure** — configures logging, database connections, migrations, permission services, HTTP/metrics and the Discord client.
3. **Trust and discovery** — discovers plugin directories, verifies signed `.nvx` artifacts when present, resolves trust policy, validates manifests, and rejects duplicate plugin IDs.
4. **Dependency and preload** — resolves dependency order, verifies dependency closure, installs dependencies only when policy permits, and synchronizes plugin config/language assets. Preload is intended to be metadata preparation, not execution of plugin entrypoints.
5. **Runtime establishment** — resolves runtime policy, materializes a verified snapshot when applicable, launches the selected execution backend, and establishes lifecycle/IPC binding where needed.
6. **Plugin setup and enable** — for in-process plugins, Core injects an `IHeart` instance and runs hooks; isolated runtimes receive serializable host messages and capability bridge registrations rather than live object graphs.
7. **Operational services** — the event bus, permission services, data registry, audit/error stores, caches, updater, HTTP routers and Cross-Host services operate according to their own lifecycle and configuration.

The exact top-level sequencing is implemented in `src/index.ts`, `src/core/bootstrap/pipeline.ts`, `src/core/database/bootstrap.ts`, `src/core/loader/index.ts`, and `src/core/runtime/manager.ts`. Treat those files as authoritative when behavior changes.

## 2. Package and source organization

| Area | Responsibility |
|---|---|
| `src/index.ts` | Normal application and updater-only entry behavior; top-level boot/shutdown orchestration |
| `src/core/bootstrap/` | Boot steps and error bridge wiring |
| `src/core/bases/` | `BasePlugin`, `BaseCommand`, `BaseEvent`, `BaseHandler`, `BaseMiddleware`, `BaseRoute` |
| `src/core/heart/` | `IHeart` interface and assembled per-plugin Core service domains |
| `src/core/loader/` | Plugin discovery, requirements, integrity gating, config/language asset loading, commands/events/routes/handlers/middleware |
| `src/core/helpers/integrity/` | Manifest/authenticated context, public keys, trust/verification decisions, dependency closure and artifact materialization |
| `src/core/runtime/` | Runtime selection, backend launch, protocol validation, plugin host, lifecycle messages, runtime records and bridge management |
| `src/core/provider/` | Provider declarations, registry, authorization and runtime bindings |
| `src/core/lifecycle/` | Resource registry, dependency guards, lifecycle controller and modification policy |
| `src/core/database/` | Connection registries, database bootstrap, backend selection, adapters and query helpers |
| `src/core/data/` | Typed Core data registry, catalogue, privacy operations, policy validation and storage adapters |
| `src/core/manager/` | Config, language, permissions, token manager, cache facade, HTTP, metrics, updater, cooldowns and related services |
| `src/core/crosshost/` | Orchestrator/worker protocol, membership, shard assignment, snapshots, heartbeats, Redis coordination and query/index features |
| `src/core/audit/`, `src/core/errors/` | Security audit events and coalesced error occurrence records |
| `src/sdk/` | Core-side installed SDK bridge implementation and helper API |
| `packages/zene-sdk/` | Published, platform-neutral typed plugin SDK contract |
| `src/plugins/` | First-party plugins, each following its documented plugin layout |

This map is not a promise that every source file is a supported public extension point. Many files under `src/core/` are implementation details and can change without public API compatibility guarantees.

## 3. `IHeart` and service composition

`src/core/heart/index.ts` defines `IHeart` and `HeartFactory`. The interface carries a plugin ID, Discord client and logger, plus these domains:

- `assets`: config, language, emoji and environment/secret manager references.
- `system`: event bus, scheduler, cooldown class, handler registry accessor, guild gates, audit and error services.
- `discord`: interaction registry.
- `db`: MongoDB, Redis, PostgreSQL, ORM, SQLite and SurrealDB registries.
- `net`: HTTP server and metrics manager.
- `toolbox`: utility, hashing, semver, integrity/manifest, vault, codec/cache and Bloom filter helpers.
- `control`: shutdown/restart, fleet/machine/shard control, runtime identity and diagnostics/gauges.
- `crossHost`: plugin bus availability, machine/peer information, send/request/listener operations and worker-shutdown operation.
- `permissions`: permission manager, cache, bit checks/registration/listing and hierarchy checks.
- `token`: lazy access to the initialized token manager.
- `cache`: namespaced cache facade.
- `guild`: cross-guild resolver and server autocomplete helpers.
- `registry`: command and middleware registration helpers.
- `paginator`: paginated-response helpers.

`HeartFactory.create(pluginId, client, overrides?)` returns a frozen object. The factory uses shared domain objects for many members, so this is not a security sandbox. `BasePlugin.heart` is protected and becomes available after the loader injects Core. Accessing it from a plugin constructor can fail because injection occurs after construction.

Some domains depend on boot-initialized holders. For example, `heart.permissions.manager()` throws if the permission system has not been initialized, and `heart.token.manager()` throws until the token subsystem has registered a manager. Document and respect readiness requirements rather than assuming every member is available during every hook.

## 4. Two plugin contracts

### Core base-class contract

The first-party plugin loader recognizes JavaScript files at specific paths and expects default exports subclassing the corresponding Core base class. `BasePlugin` expects an exported static/instance manifest shape via `manifest`, has an `onSetup()` hook, requires `onEnable()`, and may implement `onDisable()`. Related surfaces are described in [Plugin authoring](PLUGINS.md) and [Loader](LOADER.md).

### Published SDK contract

`packages/zene-sdk/src/index.ts` exports a versioned SDK composed of identity/session types, bridge contracts, command and HTTP contracts, domain interfaces, plugin SDK construction, dashboard contribution helpers, Core data helper functions and Cross-Host operations. The runtime host constructs and injects an authorized bridge. `createPluginSdk(identity, bridge)` rejects identity mismatch and unauthorized sessions. Session metadata includes runtime ID and generation; these identifiers help prevent stale runtime registrations from surviving reloads.

The package version (`SDK_VERSION`, currently `0.1.0`) is separate from `SDK_CONTRACT_VERSION` (currently `3.0.0`). `isSdkContractCompatible` uses the contract major version. Do not assume that Core version and SDK package version are the same number.

See [SDK reference](SDK_REFERENCE.md) for domain signatures and error behavior.

## 5. Lifecycle and ownership

Plugin lifecycle states declared in `src/core/bases/Plugin.ts` are `UNLOADED`, `SETUP`, `ENABLED`, `DISABLED`, and `ERROR`. Loader/runtime status is tracked separately (for example `PENDING`, `PRELOADED`, `SUCCESS`, `FAILED`, and `SKIPPED`). Do not conflate an instance state with a boot pipeline status.

Core lifecycle includes more than calling `onDisable`. The runtime manager tracks runtime handles, resource registrations and SDK/provider bindings. Generation-aware cleanup and ownership registries exist so a stale runtime should not unregister resources owned by a newer runtime generation. Plugin code that schedules jobs, subscribes to events, registers routes/providers, or creates timers should use available ownership/resource facilities and clean up correctly.

## 6. Data and storage boundaries

Database connection aliases are process-side labels. An alias such as `main` is not a SurrealDB namespace or database name. For SurrealDB, URI/protocol, alias, namespace, database and authentication are separate configuration dimensions.

The ordinary database managers provide engine-specific clients. The Core data registry is a separate abstraction that associates plugin-owned data types with scope, privacy classification, storage policy and a durable Core privacy catalogue. Its default resolution considers connected backends in an explicit order and validates an explicit engine/alias instead of silently replacing a requested durable engine with memory. Cross-Host disallows file-local embedded database engines for coordinated shared state.

See [Database](Database.md) and [Data shapes and privacy](DATA_SHAPES.md).

## 7. Event propagation and observability

The EventBus is implemented in `src/core/manager/events/EventBus.ts`; the Core domain exposes it at `heart.system.events`. It supports exact listeners, `*` wildcard matching, priorities, one-shot listeners, owner-scoped removal, sequential emission and concurrent emission. Discord events are bridged under `discord.<event-name>`, while Core lifecycle and subsystem events use names such as `system.ready`, `plugin.enabled`, `audit.recorded` and `error.recorded`.

A listener callback returning a value is not the same as a durable request/reply protocol. Sequential emission awaits listeners one at a time; concurrent emission uses settlement results. Both return an `EventResult`. Consult [Events](EVENTS.md) for event payload definitions and listener lifetime guidance.

Audit records, error occurrences, logs and metrics are distinct systems. Audit is for privileged actions; error occurrences coalesce repeated failures; log lines are diagnostics; metrics are aggregate instrumentation. None should casually duplicate secrets or entire request bodies.

## 8. Runtime isolation is not trust

The runtime manager supports five modeled levels: `in-process`, `worker`, `process`, `container`, and `external`. The runtime capability matrix explicitly distinguishes execution, memory, failure, filesystem and network isolation. In-process unload does not guarantee deletion of an ESM import graph. Worker and process backends do not automatically isolate filesystem or network. Container/external behavior depends on backend implementation.

Trust/integrity verifies what artifact is allowed to execute. Runtime policy determines where it executes. SDK bridge authorization controls which host capabilities are exposed. These are complementary layers; none substitutes for the others.

## 9. Cross-Host topology

Cross-Host uses an orchestrator/worker model and Redis for control coordination. The orchestrator owns membership, worker registration and placement decisions; workers register, receive shard assignments/identify grants and run Discord/plugin workloads when assigned. Configuration snapshots and events are coordinated by the subsystem. Cross-Host requires shared, remote-compatible infrastructure and refuses configured local-file engines where they would violate shared-state assumptions.

It is an optional deployment mode, not a requirement for standalone bots. See [Cross-Host](CROSS_HOST.md) for topology, env configuration, lifecycle and limitations.

## 10. Change-safety rule

When changing Core architecture, trace the full call path: source definition → initialization/bootstrap → public facade/bridge → runtime caller → teardown/recovery → tests → documentation. A class existing in source does not imply it is used in production. A test that creates its own schema or connection does not prove normal boot creates that schema. An SDK type does not prove its bridge is wired for every runtime. Confirm each claim against code.
