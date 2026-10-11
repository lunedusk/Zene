# Plugin runtime and isolation model

## 1. The runtime manager

`src/core/runtime/manager.ts` is the establishment and lifecycle boundary for runtime backends. `RuntimeManager.establish()` resolves policy against backend availability and requested capabilities, refuses to overwrite an active runtime, materializes/snapshots plugin input where required, launches the chosen backend, records runtime identity, and registers cleanup. `lifecycle()` sends a lifecycle operation to an established runtime. `terminate()` ends the backend and invalidates generation-scoped bindings/resources.

The selection result is structured: success includes a selected level and reason code; failure includes a rejection code/message and may include attempted levels. An establishment failure is wrapped in `RuntimeEstablishError`, with plugin ID and optional filesystem code/path. Callers should log the stable error summary without leaking absolute sensitive paths or credentials.

## 2. Isolation levels

The capability matrix in `src/core/runtime/types.ts` is authoritative. Its current guarantees are summarized below.

| Level | Separate execution/memory | Failure/disposable context | Filesystem isolated by the modeled capability | Network isolated by the modeled capability | Important limitation |
|---|---|---|---|---|---|
| `in-process` | No | No | No | No | Logical unload and fresh import evaluation do not guarantee ESM module graph garbage collection. |
| `worker` | Yes | Yes | No | No | Worker termination removes the worker heap/context, not the host filesystem/network. |
| `process` | Yes | Yes | No | No | Child process exit destroys its address space, but host filesystem/network remain shared absent external controls. |
| `container` | Yes | Yes | Yes | Yes | Actual boundary depends on container backend/runtime configuration. |
| `external` | Yes | Yes | Yes | Yes | External orchestrator owns the lifecycle; this is optional and backend-dependent. |

Do not reduce this matrix to a simple “sandbox yes/no” label. Each dimension matters. An external process may be isolated from memory but have broad filesystem/network permissions. A container label alone does not prove a secure container configuration.

## 3. Runtime policy

`RuntimePolicy` separates:

- `preferred`: the desired isolation level;
- `minimum`: a hard floor the selector must not cross;
- `allowed`: the permitted candidate levels;
- `allowFallback`: whether another eligible level can be selected if the preferred one cannot be used.

The default policy is `process` preferred/minimum, allowed only `process`, with fallback disabled. The selector also checks the runtime capability matrix against each required capability: `executionIsolation`, `memorySpaceIsolation`, `failureIsolation`, `filesystemIsolation`, `networkIsolation`, and `disposableContext`. Unknown required capability names are rejected.

For authenticated plugin metadata, signed `allowedRuntimes` is intersected with operator-allowed candidates. A bad signed runtime name or empty intersection causes rejection. Operator preferences must not weaken an authenticated minimum isolation floor.

`resolvePluginRuntimePolicy()` reads `ZENE_PLUGIN_RUNTIME_<NORMALIZED_PLUGIN_ID>`, then `ZENE_DEFAULT_RUNTIME`, then defaults to `process`. The implementation shown at this baseline maps a chosen value into a hard allowed/preferred/minimum set with fallback disabled; invalid strings normalize to `process`. The exact signed-policy integration is in `authenticatedPolicy.ts`, `selector.ts`, and the trust context.

## 4. Artifact materialization

The loader does not intentionally import plugin entrypoint code merely to preload metadata. During establishment it can use a verified-artifact materialization based on authenticated file digests, or snapshot a directory into an execution materialization when the plugin has no authenticated file list. The execution entrypoint is resolved relative to the plugin root; path-escape checks belong to the runtime/host boundary.

Materialization supports safer execution against a stable snapshot rather than blindly importing a mutable discovery directory. It is not a guarantee that an unsigned plugin is trusted; bypassed plugins remain bypassed, and the operational trust policy is separate.

## 5. Message protocol and validation

The runtime protocol carries serializable messages and payloads rather than arbitrary live object graphs. `src/core/runtime/protocol.ts` defines message shapes; `messageValidation.ts` validates inbound messages; `host/pluginHost.ts` and `host/processMain.ts` are relevant host entrypoints. Isolated registrations are translated into Core-owned bindings for handlers/providers/commands/routes and related services.

Do not pass class instances, functions, sockets, DB clients, Discord client objects, or cyclic arbitrary structures over IPC. Define a versioned payload schema and validate untrusted values on both sides. Treat messages as untrusted input even when sent by another local process.

## 6. SDK bridge identity

The Core SDK factory installs a bridge for a specific `pluginId`, `runtimeId`, and `generation`. The public SDK session contains those values, the SDK and contract versions, a trust outcome, and an authorization indicator. `assertBridgeAuthorized` rejects a non-authorized session. `assertBridgeGeneration` rejects a bridge whose runtime or generation does not match the active owner.

The bridge is capability injection, not a global mutable SDK registry. `installPluginSdkBridge()` wires domains; `uninstallPluginSdkBridge()` removes generation-scoped registrations. Keep plugin-level external resources tied to that generation and ensure teardown doesn't touch a newer generation.

## 7. Lifecycle and resource cleanup

The runtime manager records runtime handles and uses the lifecycle resource registry. Establishment failures clean partial handles/bindings/materialization. Termination invalidates bindings, removes the handle, disposes materialized artifacts where applicable and deactivates the runtime record.

Plugin authors should treat disable/unload as distinct: disable may preserve the runtime object depending on the backend, whereas unload/termination disposes the execution context. Never rely on module globals being reset by an in-process “reload.” Use explicit disposers and ownership registries.

## 8. Environment passing

`RuntimeLaunchRequest.env` is an explicit filtered environment for isolated backends; the runtime types describe it as not being the full parent process environment. `src/core/runtime/backends.ts` constructs the environment and intentionally rejects unsafe runtime options such as `NODE_OPTIONS` in the relevant path. Do not weaken environment filtering to “make imports work.” Add the specific required environment contract and tests instead.

The Core boot process stores configuration in `process.env`, and `SecretManager` does not scrub every sensitive value out of the parent process. Therefore, in-process plugins can potentially read process globals and imported Core objects; runtime isolation has to be chosen with this threat model in mind.

## 9. Choosing a backend

Use `process` when a disposable process and separate memory/failure domain are required but you trust the host filesystem/network boundary. Use a worker when lower startup cost matters and the plugin can work within a worker environment. Use container/external only when the corresponding backend is available and configured. Keep `in-process` for deliberately trusted, tightly integrated plugin code that needs the Core class ecosystem.

The level must be selected from security requirements, not just performance preference. Require and test capabilities such as filesystem and network separation explicitly when they are part of the threat model.
