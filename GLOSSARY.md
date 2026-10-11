# Zene glossary

**Alias** — Local key used by a database manager to select a connection (for example, `main`). Not the same as a database namespace/name.

**Artifact** — Packaged plugin files and authenticated metadata, commonly carried in the signed `.nvx` format or an allowed JSON manifest path.

**Audit record** — Structured record of a security-relevant action, actor, target, outcome and allowlisted metadata.

**Base class** — Core abstract class (`BasePlugin`, `BaseCommand`, `BaseEvent`, `BaseHandler`, `BaseMiddleware`, `BaseRoute`) used by loader-recognized plugin surfaces.

**Bridge** — Host-created set of capabilities passed to an SDK plugin. Bridge identity is attached to a plugin/runtime generation.

**Capability** — Named operation or runtime property that a caller is permitted/required to use. SDK capability declaration or runtime capability metadata is not automatically an authorization grant.

**Core** — Zene framework runtime and services: boot, database managers, permissions, loaders, runtime management, HTTP, event bus, audit/errors and related components.

**Core data registry** — Owner/scope/privacy-aware data type and record API plus durable privacy catalogue and storage adapters.

**Cross-Host** — Optional multi-machine orchestrator/worker mode that coordinates shard assignment and control operations through shared infrastructure.

**Generation** — Monotonic/runtime-specific lifecycle identifier used to reject stale bridge operations after reload/re-establishment.

**Heart / `IHeart`** — Core service object provided to trusted Core-style plugins. Contains plugin ID, Discord client, logger and domains.

**Integrity status** — Indicates verification result (for example signed/failed/bypassed); separate from boot success and runtime isolation.

**Logical key** — Application-level identity for a record, independent of engine-native database record ID.

**Manifest** — Plugin identity/dependency/compatibility metadata, parsed from signed artifact payload or the allowed manifest JSON path.

**Namespace** — SurrealDB grouping selected on a connection; it is not the application's local manager alias.

**Privacy catalogue** — Retained Core metadata about data-type owner/scope/personal-data status, preserved across plugin unload for privacy deletion.

**Provider** — Registered implementation that can be selected by category through Core's provider registry and associated authorization/binding rules.

**Runtime isolation** — Execution/memory/failure/filesystem/network boundaries provided by the selected runtime backend. Levels differ; “isolated” is not one universal guarantee.

**Runtime ID** — Identifier for a particular execution handle. Paired with generation to bind registrations and cleanup.

**Subject** — User/guild/plugin fields constraining a data operation.

**Trust outcome** — Result of artifact trust policy, represented in SDK sessions by `trusted`, `bypassed`, `legacy`, or `unknown`.

**Typed SDK** — Public `@lunedusk/zene-sdk` contract, separate from Core's larger source-level `IHeart` API.

**Uncertified plugin bypass** — Operator-enabled path that can permit artifacts without a successful signed verification, depending on trust rules. It must remain explicit and restricted.

