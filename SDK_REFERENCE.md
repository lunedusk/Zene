# `@lunedusk/zene-sdk` public contract reference

This document describes the published typed SDK in `packages/zene-sdk/src`. Its version is independent of Zene Core. The current package declares `SDK_VERSION = 0.1.0`, `SDK_COMPAT_RANGE = '^0.1.0'`, and `SDK_CONTRACT_VERSION = '3.0.0'`.

## 1. Install and entrypoints

The package uses ESM and exports `.` as the platform-neutral public SDK, `./discord` as an optional Discord-specific entrypoint, and `./package.json`. The package engine is Node `>=20`. The `discord.js` peer dependency is optional in package metadata; the platform-neutral contract deliberately uses opaque HTTP/command shapes so it doesn't force a specific HTTP framework.

Core also has a separate internal `src/sdk` implementation and Core `IHeart` domain. Similar names do not imply identical signatures or trust boundaries. See the compatibility table below and [Architecture](ARCHITECTURE.md).

## 2. SDK identity and compatibility

```ts
type PluginId = string;
type ContributionId = string;
type RuntimeGeneration = number;

interface PluginIdentity {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly description?: string;
}

interface SdkSessionContext {
  readonly pluginId: PluginId;
  readonly runtimeId: string;
  readonly generation: RuntimeGeneration;
  readonly sdkVersion: SdkVersion;
  readonly contractVersion?: SdkContractVersion;
  readonly trustOutcome: 'trusted' | 'bypassed' | 'legacy' | 'unknown';
  readonly authorized: boolean;
}
```

`getSdkCompatibilityInfo()` returns package version, contract version and compatibility range. `isSdkContractCompatible(hostContractVersion, pluginContractVersion = SDK_CONTRACT_VERSION)` checks whether both parsed major versions match; it is not a general semver-range solver.

`createPluginSdk(identity, bridge)` binds identity to a Core-provided `SdkBridge`. It rejects an identity mismatch with `SDK_IDENTITY_MISMATCH` and rejects unauthorized bridge sessions through `assertBridgeAuthorized()`. The published SDK package does not have a global mutable bridge registry; Core constructs and injects the authorized bridge.

`SdkError` includes `code`, `message` and optional scalar `details`. Current guard codes include `SDK_OPERATION_DENIED` and `SDK_STALE_GENERATION`; individual domain wrappers can emit additional operation-specific codes.

## 3. The `PluginSdk` surface

`PluginSdk` exposes the following members. Exact interfaces reside in `bridge.ts`, `domains.ts`, `http.ts`, and `types.ts`.

| Domain | Public methods/contracts | Purpose |
|---|---|---|
| `log` | `(level, message, meta?)` | Structured plugin logging; levels: debug/info/warn/error. |
| `config` | `get<T>(key)`, `set(key,value)`, `has(key)`, `getRaw<T>()` | Plugin configuration access. `get`/`getRaw` are async; `has` is synchronous. |
| `events` | `emit(event,...args)`, `on(event,handler)`, `once(event,handler)` | Plugin event pub/sub; `on`/`once` return unsubscribe functions. |
| `providers` | `select<T>(category)`, `register(declaration)` | Provider selection/registration. The host remains responsible for authorizing declarations. |
| `resources` | `track({kind,label?,releaseOn,dispose})`, `untrack(resourceId)` | Track disposables with release points `disable` or `unload`. |
| `data` | `registerType`, `access`, `write`, `export`, `delete` | Ownership- and subject-scoped plugin data operations. |
| `dashboard` | `contribute`, `revoke`, `list` | Register/revoke/read dashboard contributions. Ownership fields are host-authored, not plugin input. |
| `http` | `registerRouter`, `unregisterRouter`, `listMounts` | Register an opaque host-compatible router handle under a base path. |
| `commands` | `registerRoot`, `extendRoot`, `registerChat`, `registerButton`, `registerSelect`, `registerModal`, `unregister` | Register command and component interaction handlers via host adapters. |
| `crossHost` | `isAvailable`, `machineId`, `peers`, `send`, `request`, `on`, `off` | Cross-machine plugin message operations where Cross-Host is available. |
| `scheduler` | `every`, `cron`, `cancel` | Register/cancel plugin-owned scheduled tasks. |
| `cooldowns` | `define`, `isRateLimited`, `refund` | Per-plugin rate-limit definitions and checks. |
| `permissions` | `hasBit`, `requireBit` | Check or require a named permission bit. |
| `features` | `register` | Declare feature/intents metadata. |
| `locale` | `t(namespace,key,variables?)` | Translate a key with scalar interpolation variables. |
| `emoji` | `get(key)`, `parse(text)` | Resolve or parse emoji strings. |
| `cache` | `get`, `set`, `delete` | Async string cache with optional TTL in milliseconds. |
| `diagnostics` | `increment`, `timing` | Emit named counters/timing observations. |
| `guild` | `resolveName(guildId)` | Read-only guild eligibility/name helper. |
| `runtimeRequirements` | value | Runtime requirement metadata bound to the session. |
| `dependencies` | readonly declarations | Resolved dependency declarations available to the runtime. |

A type being present does not mean a domain is always operational. Cross-Host methods require an active host bridge/control plane; requests can time out or fail; database/storage operations can fail; route registration can be rejected. Use typed error behavior and check availability as appropriate.

## 4. Event bridge contract

`SdkBridgeEventBus` is intentionally narrower than Core's `EventBus`. Its `emit()` resolves to `Promise<void>`, and it does not expose Core `emitConcurrent`, `listInspect`, global `clear()`, wildcard options or listener priorities in the published interface. It exposes `on` and `once`, each returning an unsubscribe callback. Use only the methods present in the SDK version you target.

Core should associate listeners with the plugin/runtime owner so `uninstallPluginSdkBridge()` can release them. Plugin code should retain unsubscribe handles and avoid global event side effects after disable/unload.

## 5. Data contract in detail

`DataScope` is `user | guild | plugin | server | global | system`. `PrivacyClass` is `public | internal | personal | sensitive | secret`.

`DataTypeRegistration` has:

```ts
interface DataTypeRegistration {
  readonly id: string;
  readonly schema?: unknown;
  readonly scope: DataScope;
  readonly personalData: boolean;
  readonly privacyClass: PrivacyClass;
  readonly retention?: string;
  readonly storage?: {
    readonly engine: 'memory' | 'sqlite' | 'postgres' | 'mongo' | 'surreal' | 'redis';
    readonly alias?: string;
    readonly requireDurable?: boolean;
    readonly requireSubjectDelete?: boolean;
  };
}
```

`DataSubjectInput` can provide `userId`, `guildId`, and `pluginId`. The Core registry enforces the field required by the type's registered scope, derives owner identity from the bridge session, and checks owner/privacy/storage policies. `DataAccessQuery` accepts only optional exact `key` at this contract. A `DataExportResult` includes `typeId`, readonly values and export time. `delete()` returns the deleted count.

Core-authorized user-global and guild/server deletion is not exposed as a general SDK capability. A plugin cannot ask the public SDK to erase every other plugin's data.

## 6. Dashboard contributions

`SdkDashboardContributionRegistration` carries `contributionId`, `kind`, `scope`, `title`, optional `route`, `apiPath`, `permissionBits`, `capability`, `order` and payload. It has no owner/runtime fields. `SdkDashboardContributionView` adds host-authored `pluginId`, `runtimeId`, and `generation`.

Current enum unions declared by dashboard helper types are:

- kind: `page | nav | settings | widget | api_route | realtime | action | privacy`;
- scope: `user | guild | server | plugin | global | system`.

Registration validates a non-empty contribution ID and strips ownership keys before passing data to the bridge. Revoke uses contribution ID; list returns host-authored views. Do not treat a contribution's UI declaration as authorization—server-side API actions still need permission and ownership checks.

## 7. Command registration

The platform-neutral `SdkBridgeCommands` has `registerRoot(def): Promise<string>`, `extendRoot(def): Promise<string>`, `registerChat(name, handler, metadata?): string`, `registerButton(id, handler): string`, `registerSelect(id, handler): string`, `registerModal(id, handler): string`, and `unregister(name): void`. Root/extension definitions are typed as opaque host contracts in this package; use the exact host version's accepted definition shape instead of inventing properties.

`SdkCommandRequirements` describes eligibility expectations such as deployment mode, Cross-Host role, sharding, environment values, Node version and required plugins. It is metadata interpreted by the host, not proof of permission and not a capability grant.

## 8. HTTP router handle

The platform-neutral SDK defines `SdkHttpRouterHandle = object`, with `registerRouter(basePath, router)`, `unregisterRouter(basePath)` and `listMounts()`. The SDK does not import Express. A host adapter provides a compatible object. The route itself still needs explicit auth and validation; registering a router is not equivalent to securing it.

## 9. Cross-Host contract

`SdkCrossHostMeta` includes `fromMachineId`, `channel`, optional `requestId`, `trackingId` and `messageId`. A handler receives `(payload: unknown, meta)` and can return any value synchronously or asynchronously.

- `isAvailable(): boolean`
- `machineId(): string | null`
- `peers(): readonly string[]`
- `send({target, channel, payload, trackingId?}): Promise<void>`
- `request<T>({target, channel, payload, timeoutMs?, trackingId?}): Promise<T>`
- `on(channel, handler): () => void`
- `off(channel, handler?): void`

The wrapper throws `CROSSHOST_UNAVAILABLE` if the service is unavailable for send/request/on, and wraps transport failures as `CROSSHOST_TRANSPORT`. Validate every received payload. Don't assume durable delivery or exactly-once request handling unless the concrete transport's implementation explicitly guarantees it.

## 10. Scheduling, cooldown, permissions, cache

Scheduling uses `every(name, {seconds?,minutes?,hours?}, handler)`, `cron(name, expression, handler)` and `cancel(name)`. Names are scoped/owned by the host bridge implementation; cancellation should occur as part of plugin teardown.

Cooldown context accepts optional `userId`, `guildId`, `channelId`, `commandId`, `key`. `commandId` maps to Core cooldown command identity and falls back to `key` or slug where the adapter specifies. `isRateLimited` returns `{limited, remaining, resetAt?}`. `refund` should be used only when a consumed attempt is intentionally restored by the application logic.

Permissions use `hasBit(userId, bit, guildId?)` and `requireBit(...)`. A failed require throws; a boolean check is not a replacement for guarding the subsequent privileged operation against race conditions.

Cache uses string values and optional `ttlMs`. `get` returns string or null; `delete` returns boolean. It is a cache, not durable business storage, and local fallback does not make a key globally shared across workers.

## 11. SDK versus Core API

| Question | Public SDK | Core `IHeart` |
|---|---|---|
| Intended use | Versioned, platform-neutral plugin contract | Rich Core-facing API for loader-integrated trusted code |
| Bridge | Core constructed/injected | Direct Core manager/domain objects may be referenced |
| Runtime identity | Session contains runtime ID/generation | Heart is plugin-ID scoped but many domains point to shared singletons |
| Event API | `emit/on/once` | Core EventBus includes priorities, owner unregister, concurrent emit, inspection |
| Database | Typed Core data operations through SDK bridge | `heart.db` exposes engine managers directly; use carefully |
| Discord | Optional `./discord` entrypoint | Core Heart includes `Client<true>` and Discord-specific surfaces |
| Stability | Public package/contract versioning | Source-level Core API can change with repository architecture |

## 12. SDK development checklist

- Pin the SDK version and verify contract compatibility.
- Use bridge-provided services rather than importing Core internal files.
- Treat payloads/command definitions as versioned data.
- Check readiness/availability and surface failures to the right operator channel.
- Track disposables and unsubscribe on disable/unload.
- Never take ownership identity from user payloads.
- Validate HTTP, Discord and Cross-Host inputs.
- Declare data type privacy/scope/storage deliberately.
- Test authorization denial and stale-generation errors.
