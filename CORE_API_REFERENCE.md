# Core service API reference for trusted plugin code

This is a source-oriented companion to [Plugin authoring](PLUGINS.md), [Architecture](ARCHITECTURE.md), and the [AI system prompt](System%20Prompt%20-%20AI%20-%20Plugin.md). It catalogues public members reachable through the Core `IHeart` domains, with emphasis on functions that plugin code could actually call. It is not a promise that every exported manager is supported as a stable third-party API. Core managers can change between releases; inspect the checked-out declaration before upgrading.

## 1. Start with `IHeart`

`IHeart` is declared in `src/core/heart/index.ts`. It contains `id`, `client`, `log`, and the following readonly domains:

| Property | Publicly exposed shape | Main source |
|---|---|---|
| `assets` | `config`, `lang`, `emoji`, `secrets` | `src/core/heart/assets.ts` |
| `system` | `events`, `scheduler`, `cooldowns`, `handler`, `gates`, `audit`, `errors` | `src/core/heart/system.ts` |
| `discord` | `interactions` | `src/core/heart/discord.ts` |
| `db` | `mongo`, `redis`, `postgres`, `orm`, `sqlite`, `surreal` | `src/core/heart/db.ts` |
| `net` | `http`, `metrics` | `src/core/heart/net.ts` |
| `toolbox` | `utils`, `security`, `data` helper namespaces | `src/core/heart/toolbox.ts` |
| `control` | local/fleet/machine/shard control and diagnostics | `src/core/heart/control.ts` |
| `crossHost` | Core Cross-Host bus | `src/core/heart/crossHost.ts` |
| `permissions` | manager/cache/bit APIs/hierarchy check | `src/core/heart/permissions.ts` |
| `token` | lazy TokenManager accessor | `src/core/heart/token.ts` |
| `cache` | facade + namespace function | `src/core/heart/cache.ts` |
| `guild` | cross-guild resolver/autocomplete | `src/core/heart/guild.ts` |
| `registry` | command/middleware registration and command tree | `src/core/heart/registry.ts` |
| `paginator` | page creation/replies/navigation handlers | `src/core/heart/paginator.ts` |

`HeartFactory.create()` returns a frozen object but many exposed manager references are shared. A plugin receiving `IHeart` is not isolated from the Core process. Do not expose the complete Heart to an untrusted plugin as a way to implement narrow capability access.

## 2. Configuration manager (`heart.assets.config`)

Implementation: `src/core/manager/config.ts`.

Main public methods include:

- `init(hotReload = false): Promise<void>` — initialize/read config sources, with reload/watch behavior when enabled.
- `reloadAll(): Promise<boolean>` — reload config files as supported by the manager.
- `reloadFile(name): Promise<boolean>` — reload a named config; `name` follows manager config naming conventions, not an arbitrary OS path.
- `getLoadedConfigs(): string[]` — report loaded names.
- `get<T>(name): Readonly<T> | null` — read the runtime config model.
- `getRaw<T>(name): Readonly<T> | null` — access raw config representation.
- `getRedacted<T>(name): Readonly<T> | null` — access the redacted view.
- `getStrict<T>(name): Readonly<T>` — require presence and throw if absent.
- `has(name): boolean` — test if a config is present.
- `dumpSnapshot(): Record<string, unknown>` and `applySnapshot(raw): void` — Cross-Host snapshot operations.
- `setPluginScopedValue(pluginId, key, value, ...)` — scoped mutation path; inspect full type for exact arguments and validation behavior.
- `getConfigValidationFailures(): ReadonlyMap<string, readonly string[]>` and `hasConfigValidationFailure(pluginId): boolean` — inspect validation status.

Config loading maintains raw and expanded runtime values, applies merge-preservation and validation rules, and can record failure information used by plugin disabling. Don't mutate a returned readonly object or assume a config `get` grants authority to change values. `getRaw` can contain unexpanded material and should not be sent to a public endpoint. `getRedacted` is safer for display but should still be handled as configuration data.

## 3. Language manager (`heart.assets.lang`)

Implementation: `src/core/manager/lang.ts`.

Types:

```ts
type TranslationVars = Record<string, string | number | boolean>;
type CompiledTranslation = (vars?: TranslationVars) => string;
```

Public methods include:

- `init(hotReload = false): Promise<void>`
- `getLoadedNamespaces(): string[]`
- `dumpSnapshot(): Array<{locale: string; namespace: string; raw: unknown}>`
- `applySnapshot(...)`
- `reloadFile(namespace, locale?): Promise<boolean>`
- `reloadAll(): Promise<boolean>`
- `wipeCache(locale?): void`
- `getRaw(namespace, locale?): Record<string, unknown> | null`
- `getRedacted(namespace, locale?): Record<string, unknown> | null`
- `getNamespace(namespace, locale?): Readonly<Record<string, CompiledTranslation>> | null`
- `get(namespace, key, variables?, requestedLocale?): string`
- `getLangValidationFailures(): ReadonlyMap<string, readonly string[]>`
- `hasLangValidationFailure(pluginId): boolean`
- `clearLangValidationFailures(): void`

Current lookup logic tries locale fallbacks including configured master/default locale and English where applicable. `get()` returns a string; a missing translation may resolve through fallbacks and placeholders. Do not treat untranslated output as safe to expose without review. Variables allow string/number/boolean values, not arbitrary objects. Namespaces and plugin ownership depend on loader file naming conventions.

## 4. Emoji manager (`heart.assets.emoji`)

Implementation: `src/core/manager/emoji.ts`.

Public methods include `init(hotReload = false): Promise<void>`, `reload(): Promise<boolean>`, `get(key): string | null`, `parse(text): string`, `getAll(): Readonly<Record<string,string>>`, `dumpSnapshot(): Record<string,string>`, and `applySnapshot(map): void`. Emoji parsing may transform placeholders in strings; don't assume arbitrary user text should be parsed before display without considering escaping or expected syntax.

## 5. Secret manager (`heart.assets.secrets`)

Implementation: `src/core/helpers/secretManager.ts`.

Public methods include:

- `set(key, value): void`
- `get(key): string`
- `getOptional(key, fallback?): string | undefined`
- `getBoolean(key, fallback?): boolean`
- `has(key): boolean`
- `keys(): string[]`
- `assimilateEnv(pattern?): void`
- `replaceExpanded(key, value): void`
- `lock(): void`
- `applyEnvReload(mutations, allowSet): {updated: string[]; skipped: string[]}`

This is a privileged environment-access surface, not a secret-isolation boundary. Values remain in `process.env`. After lock, `set` prevents overwriting keys that were sealed, while the sanctioned reload method only updates keys from an explicit allowlist and excludes identity keys. Never enumerate values into logs/API results; `keys()` exposes names only. Third-party plugins should not be given this surface unless they are fully trusted.

## 6. Event manager (`heart.system.events`)

Implementation: `src/core/manager/events/EventBus.ts`.

Exact signatures and semantics are in [Events](EVENTS.md). Methods: `on`, `once`, `removeListener`, `unregisterByOwner`, `clear`, `emit`, `emitConcurrent`, `listInspect`. `on` returns an unsubscribe closure. `emit` executes sequentially; `emitConcurrent` awaits all listeners concurrently. Each returns `EventResult`, and handler failures are logged/represented rather than necessarily aborting all handlers. Use owner-scoped subscriptions and cleanup rather than global `clear()`.

## 7. Scheduler (`heart.system.scheduler`)

Implementation: `src/core/scheduler/index.ts`.

Core scheduler public methods include:

- `init(): Promise<void>`
- `registerTask(name, func): void`
- `every(name, {seconds?, minutes?, hours?}, func?): Promise<JobConfig>`
- `cron(name, expr, func?): Promise<JobConfig>`
- `remove(name): Promise<boolean>`
- `removeTask(name): Promise<boolean>`
- `start(): void`
- `stop(): void`

The scheduler stores task functions in a registry and job configurations separately. `every` needs at least one positive interval unit. `cron` requires exactly five space-separated fields in the current wrapper check; validate the expression with the installed parser. Persistent scheduling metadata (default file path in the singleton) cannot serialize arbitrary function closures, so task handlers must be registered again by application code.

The public SDK scheduler is different and narrower: it exposes plugin-owned `every`, `cron`, and `cancel`. Prefer the SDK on SDK plugins and cancel owned tasks when done.

## 8. Handler registry (`heart.system.handler`)

Implementation: `src/core/manager/handler/registry.ts`, exposed through a Proxy in `system.ts`.

Dynamic plugin handler properties are available through the accessor; special methods include `$has(pluginId, name?)`, `$get<T extends BaseHandler>(pluginId, name)`, `$list()`, `$listDetailed()`. Core registry methods include `get`, `has`, `getByPlugin`, `list`, `listDetailed`, `pluginIds`, `size`, `register`, `unregister`, `unregisterPlugin` and `clear`. Unload logic can invoke handler teardown; do not mutate the registry directly to avoid normal ownership cleanup.

## 9. Guild gates (`heart.system.gates`)

The gate accessor provides `isReady()`, `isGuildBlocked(guildId)`, `isPluginBlocked(pluginId,guildId)`, `isInteractionBlocked(ownerPluginId,guildId)` and a manager reference. Treat a gate check as a current policy view; for protected operations, enforce it in the path where the operation is authorized rather than relying only on an earlier unrelated event check.

## 10. Audit and errors (`heart.system.audit`, `heart.system.errors`)

Audit methods: `record(input)`, `list(filter?)`, `getById(id)`. Error methods: `record(input)`, `recordFromError(err)`, `list(filter?)`, `getById(id)`. Audit can return null on failure unless `AuditFailClosed=true`; error occurrence record may return null when store write fails. Check return values if durable recording is a requirement. Detailed schemas are in [Audit](AUDIT.md) and [Errors](ERRORS.md).

## 11. Database registries (`heart.db`)

Definitions: `src/core/database/index.ts`, plus `redis.ts`, `postgres.ts`, `sqlite.ts`, `mongo.ts`, `surreal.ts`.

Common manager methods:

- `connect(alias, uri, ...)` (SQLite's native path is synchronous; other engines are async).
- `has(alias)`; some registries also provide `tryGet(alias)`.
- `get(alias)` — throws when alias is unavailable.
- `pingAll(): Promise<Record<string, boolean>>`.
- engine-specific `disconnect(alias)` and `disconnectAll()` methods.

Engine-specific differences matter:

- Redis `get(alias)` returns a triad of `main`, `pub`, `sub` clients; `tryGet(alias)` returns a nullable clients view.
- PostgreSQL `get(alias)` returns a `pg.Pool`.
- Mongo `get(alias)` returns a Mongoose connection.
- Native SQLite `get(alias)` returns a `better-sqlite3` Database.
- Surreal `get(alias)` returns a `Surreal` client. `connect` accepts `SurrealConnectOptions`; namespace/database/auth are connect options, separate from alias/URI.
- ORM `get(alias)` and entity configuration differ from native managers.

Do not generalize direct CRUD methods across these returned driver types. A plugin calling them is committing to the driver's own schema/transaction/query model. Prefer the Core data SDK for typed plugin data and privacy operations.

## 12. HTTP server (`heart.net.http`)

Implementation: `src/core/manager/http/server.ts`.

Public methods include `init(): void`, `registerRouter(basePath, router): void`, `unregisterRouter(basePath): void`, `listMounts(): string[]`, `start(port?, host?): Promise<void>`, `finalize(): void`, `stop(timeoutMs = 10_000): Promise<void>`. `registerRouter` throws before `init()`. Router registration/mounting is not itself authentication. The server has a finalize phase for routes/services after plugin boot; verify which path you use and whether the server has started.

The SDK HTTP bridge only accepts an opaque router handle and has its own adapter contract. Don't pass Express-specific routers through the platform-neutral SDK unless the current host adapter guarantees that type is accepted.

## 13. Metrics (`heart.net.metrics`)

Implementation: `src/core/manager/metrics/index.ts`.

Public methods include `init(config?: MetricsConfig): Promise<void>` and `stop(): void`. Initialization can collect default process metrics under `bot_` prefix and optionally enable an HTTP route or file dump according to `MetricsConfig`. A bearer/master-key guard is present in the HTTP path when configured; do not expose metrics routes to public networks without confirming authentication and network ACLs.

## 14. Cache facade (`heart.cache`)

Implementation: `src/core/manager/cacheFacade.ts`, detailed in [Cache](CACHE.md).

`CacheFacade.namespace(alias = 'main', options?)`, `cooldown()`, `guildGate()`, `main()`. `CacheNamespace`: `get`, `set`, `delete`, `deleteByPrefix`, `deleteKeysMatching`, `has`, `incrWithTtl`, `decr`, `hasPresence`, `setPresence`, `deletePresence`, `clearPresence`, `loadPresence`. It may use Redis and local TTL maps. Local fallback is not durable/shared across processes.

## 15. Cooldowns (`heart.system.cooldowns`)

Implementation: `src/core/manager/cooldown.ts`.

Public manager methods include `initialize(definitions)`, `define(slug,limit,windowSeconds)`, `isRateLimited(slug,ctx)`, `refund(slug,ctx)`, `getBucket(slug)` and `flush()`. The public SDK has a separate bridge interface; use its exact result type (`limited`, `remaining`, optional `resetAt`) rather than inventing return fields.

## 16. Permissions (`heart.permissions.manager()`)

Implementation: `src/core/manager/permissions.ts`; typed wrapper in `src/core/heart/permissions.ts`.

The Heart wrapper directly exposes manager initialization-dependent operations: `manager()`, `cache()`, `hasBit`, `requireBit`, `registerBit`, `listBits`, `canActOnMember`.

The full `PermissionsManager` currently contains methods in these groups:

- `setCache`, `init`, `applyCommandDefaults`, `resolveHttpRouteAccess`;
- `registerBit`, `listBits`, `bitsExist` and rank/bit-related validation helpers;
- role CRUD: `createBotRole`, `updateBotRole`, `deleteBotRole`, `listBotRoles`, `assignBotRole`, `revokeBotRole`; server-role CRUD/assignment/revocation/listing;
- `findHoldersOfBit`, `canActOnMember`, `resolve`, `cachedResolve`, `hasBit`, `hasAllBits`, `hasAnyBit`, `requireBit`;
- interaction authorization `canExecute`, `sendDenied`;
- Discord permission mirror methods and role-link/grant helpers;
- cache invalidation methods for users/guilds.

Exact object inputs/return types and internal actor/hierarchy checks vary per method. Do not call mutation methods merely because they are public on the class. Use the narrow wrapper where sufficient and inspect the entire authorization preamble of the method before writing a privileged command.

## 17. Token subsystem (`heart.token.manager()`)

Implementation: `src/core/manager/token.ts`; wrapper in `src/core/heart/token.ts`.

The manager includes `issue`, `verify`, `revokeAll`, `revokeDevice`, `listDevices`, `refresh`, `hasBit`, `requireBit`, `requireBits`, and a deliberately unsafe `debugDecodeUnsafe` requiring the literal confirmation argument `I_UNDERSTAND_THIS_IS_UNSAFE`. Token stores implement device/global version and last-JTI operations. Token manager construction requires a strong master secret (minimum length enforced) and uses issuer/audience, expiry and rotation checks. Verify tokens through `verify()`; don't use `debugDecodeUnsafe` as authentication.

The full store implementations support particular engines and have individual query/update behavior. Don't assume all stores provide identical transaction/concurrency guarantees.

## 18. Registry (`heart.registry`)

Detailed type in `src/core/heart/registry.ts`.

- `registerCommand(input, {resync?})`: accepts a `BaseCommand` instance, constructor or `CommandDefinition`.
- `extendCommand(rootName, extension, {resync?})`.
- `registerCommandDefinition(def, {resync?})`.
- `registerMiddleware(input)`.
- `listCommandTree()`.
- `freezeCommandStructure()`, `isCommandStructureFrozen()`.
- `resyncApplicationCommands(guildId?)` synchronizes application commands and emits a command-tree resync event.

Commands are frozen after the normal boot pipeline reaches ecosystem completion. A dynamic command update must account for this invariant rather than bypassing registry validation.

## 19. Paginator (`heart.paginator`)

Implementation: `src/core/heart/paginator.ts` and `src/core/paginator/`.

The Heart domain has `create(options)`, `replyOrPaginate(options)`, `handleButton(interaction)`, `clearUserSessions(userId)`, `canAttach(utilButtonCount)`, `unitsFromLines(lines,idPrefix?)`, and `isPaginatorId(customId)`. Options and page unit types are defined by `PaginatorCreateOptions`, `AutoPaginateOptions` and `Paginator` declarations in the implementation. Always inspect those before constructing custom component IDs or assuming navigation behavior.

## 20. Toolbox contents

`heart.toolbox` is a nested object, not one flat bag:

- `utils.random`, `utils.format`, `utils.EmojiSyncer`;
- `utils.hash.hashFile`, `hashBuffer`, `HASH_ALGORITHM`;
- `utils.semver.SemVer`, `SemVerRange`;
- `utils.nodever.NodeVersion`;
- `utils.redact`;
- `security.integrity`, `security.manifest`, `HybridVault`, `SecureVault`;
- `data.codec`, `data.Cache` (TTLCache class), `data.BloomFilter`.

These classes inherit their own APIs. Use only what the plugin needs; do not treat helper availability as a stable SDK contract. Signing/integrity helpers can have privileged effects and need careful call-site review.

## 21. Runtime API versus plugin API

`RuntimeManager`, provider registries, SDK bridge installation functions, plugin runtime records, database bootstrap and Core security helpers are primarily infrastructure. They may be exported from source modules but are not automatically supported for third-party plugins. Use them only for Core-level changes where the task includes boot/teardown and regression tests.

## 22. Safe use rules

- Prefer the narrowest Heart wrapper or public SDK method that accomplishes the task.
- Check readiness before using permission/token/database services that initialize later.
- Use manager-owned transactions/CRUD methods where correctness depends on them.
- Track every event subscription, task, route, provider and external resource with the intended owner.
- Distinguish null/missing from empty values and thrown errors.
- Never make the API reference more specific than the source contract actually is.
