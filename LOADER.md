# Plugin loader internals and authoring contract

## 1. Loader stages

The main `PluginManager` in `src/core/loader/index.ts` owns discovery, preload, boot, status and teardown. The responsibilities are separated to reduce accidental execution before runtime selection:

1. **Core version discovery.** Reads the root `package.json` version used for compatibility checks.
2. **Discovery/trust gate.** Scans folders, resolves signed or bypass manifest data, checks Core/Node constraints, records integrity/trust and rejects duplicate IDs.
3. **Dependency graph.** Orders dependencies before dependents. Priority provides ordering among independent roots; it cannot make a dependent precede its dependency.
4. **Preload.** Checks execution authorization and dependency closure, invokes the dependency installer as needed, synchronizes config and language files, and confirms the `index.js` entrypoint exists. The preload code intentionally avoids importing the executable plugin entrypoint.
5. **Boot.** Resolves runtime policy, establishes one runtime path for all backends and performs setup/enable lifecycle operations. In-process execution uses Core base classes and `HeartFactory`; isolated runtimes exchange validated protocol messages.
6. **Finalization.** Registers active status, publishes lifecycle events, synchronizes emoji and freezes the command structure after the plugin ecosystem boots.

The implementation is the authority. The summarized stages do not imply that every step always runs for every plugin: invalid plugins can be skipped or fail, no plugin directory is a supported empty state, and dependencies that did not reach acceptable states can block dependents.

## 2. Status and diagnostics

`PluginBootStatus` values are `PENDING`, `PRELOADED`, `SUCCESS`, `FAILED`, and `SKIPPED`. `IntegrityStatus` values include `signed`, `unsigned`, `failed`, and `bypassed`. These are separate axes. A plugin can be signed but fail later during setup; the integrity status does not imply successful boot.

`PluginManager` exposes `getBootStatus(pluginId)`, `getPreloadedPluginDirs()`, and `excludePreloadedPlugin(pluginId, reason)` as part of its Core class. The manager also uses its registry for active in-process plugin instances; isolated plugins can have runtime records without appearing in the same instance registry. Do not use `registry.has(id)` as the only test for whether any runtime is active.

## 3. Dependency ordering

`discoverPlugins()` builds a map by manifest ID and logs a reject-all conflict on duplicate IDs. `sortDependencies()` performs depth-first topological ordering. Missing dependencies and cycles cause resolution failure and removal of affected entries. Priority is compared for root ordering and is ascending in the current implementation; dependencies remain first regardless of priority.

There are two dependency systems:

- `manifest.dependencies`: other Zene plugin IDs.
- `manifest.nodeDependencies` and `package.json.dependencies`: npm packages needed by a plugin.

These should be declared accurately. A plugin dependency does not install an npm package, and an npm dependency does not load another plugin. Avoid mutable dependency declarations after artifact signing.

## 4. File discovery and class requirements

The loader's class surfaces use default exports and compiled `.js` files in recognized directories:

- `src/commands/**/*.js`: default export extends `BaseCommand`.
- `src/events/**/*.js`: default export extends `BaseEvent`.
- `src/routes/**/*.js`: default export extends `BaseRoute`.
- Handler and middleware paths are implemented by `src/core/loader/handler.ts` and `middlewares.ts`; read those exact paths and lifecycle calls when relying on their load semantics.

The command loader throws up to its caller on command import/registration failure; event and route loaders log per-file failures and continue their batch in the baseline implementation. Therefore, error propagation is surface-specific and should not be described as identical for every loader.

## 5. Requirements evaluation

`src/core/loader/requirements.ts` defines `RegisterRequirements`, `RequirementContext`, and `evaluateRequirements()`. It can compare deployment mode, role, sharding status, environment values/boolean values, truthy env names, Node version, plugin loaded status, provider availability and custom predicates. `mode: 'strict'` changes how a failed requirement is handled for a component; it is not a signed permission grant.

`detectDeployMode()` currently checks `CROSS_HOST` before `isSharded`, otherwise returns standalone. `detectCrossHostRole()` recognizes `orchestrator` and `worker`. Environment predicates operate through `SecretManager`. Custom predicates can throw; failures are converted into reasons. `all` requires all predicates to pass, and `any` succeeds after the first passing predicate.

## 6. Config/language/emoji loading

Config and language synchronization happen during preload before plugin entrypoint execution. Managers keep raw and runtime representations so placeholders can be expanded and reloads can be re-applied to raw values instead of compounding prior expansion. Validation failures are recorded in Core and can disable a plugin through the plugin gate. See [Placeholders](PLACEHOLDERS.md) and [Operations](OPERATIONS.md).

Do not write documentation that assumes every JSON-like configuration value is overwritten by defaults. The exact merge-preservation and write semantics are implemented in `src/core/loader/mergePreserve.ts`, `config.ts`, `lang.ts`, and `json5SurgicalWrite.ts`.

## 7. Runtime selection and lifecycle

RuntimeManager is the boundary for all runtime types, including in-process execution. It snapshots/materializes the artifact, launches, tracks a runtime record, tracks a disposable runtime resource, and supports setup/enable/disable/unload requests. Errors after establishment attempt termination and authenticated-context cleanup.

For in-process runtime, Core imports the materialized entrypoint, validates `BasePlugin` inheritance, injects a scoped Heart, and invokes plugin hooks and auxiliary loaders. Isolated runtimes do not transfer live JS objects across the boundary; their host process registers remote handlers through protocol messages.

See [Runtime](RUNTIME.md) for the isolation matrix and policy selection.

## 8. Security and maintenance rules

- Do not import entrypoints during preload to “check” them; import executes code.
- Never fall back from failed signed artifacts to unsigned metadata.
- Do not weaken dependency closure checks to fix npm install inconvenience.
- Avoid direct `process.env` handling in new plugin APIs unless the runtime contract permits it.
- Ensure plugin runtime resources are owned by plugin/runtime generation and disposed on teardown.
- Keep per-surface error propagation behavior explicit.
- Test duplicate plugin IDs, cycles, missing dependencies, malformed manifest, compatibility failures and enable/setup failures.
