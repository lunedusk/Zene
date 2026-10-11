# EventBus and event payload reference

## 1. Location and contract

The Core EventBus lives in `src/core/manager/events/EventBus.ts` and is exposed through `heart.system.events`. It supports framework events plus Discord.js events prefixed with `discord.`. The published SDK event interface is narrower; see [SDK reference](SDK_REFERENCE.md).

### Listener methods

```ts
on(pattern, callback, options?: { priority?: number; once?: boolean; owner?: string }): () => void
once(pattern, callback, priority = 0): () => void
removeListener(pattern, callback): boolean
unregisterByOwner(ownerId): void
clear(): void
emit(event, ...args): Promise<EventResult>
emitConcurrent(event, ...args): Promise<EventResult>
listInspect(): Array<{ name: string; once: boolean; priority: number; pluginId: string | null }>
```

Patterns with `*` are held as wildcard patterns; other strings use exact listeners. A star is expanded to match any characters, while other regular-expression metacharacters are escaped. Listener order is descending priority, then registration order.

`on()` validates non-empty pattern and callable callback and returns an unsubscribe closure. Owner is optional; `unregisterByOwner(ownerId)` removes only listeners tagged with that owner. It does not remove unowned listeners. `clear()` is global and intended for deliberate Core teardown/test isolation, not ordinary plugin cleanup.

## 2. Serial versus concurrent emission

- **`emit()`** snapshots matching exact/wildcard listeners, sorts them, awaits each callback in order, catches each callback failure, logs it and includes the resulting `Error` in `results`. One listener failing does not stop later listeners. One-shot listeners are removed after execution.
- **`emitConcurrent()`** invokes all snapshotted listeners through `Promise.allSettled`, returns fulfilled values or rejection reasons, and logs each thrown callback error. One-shot listeners are scheduled for removal after invocation. It does not guarantee a deterministic completion order.

Both return `{ event, listenerCount, results }`. `listenerCount` represents the listener snapshot used for this emission, not necessarily the count remaining afterward. Wildcard and exact listeners can both match one event. If the same callback is registered multiple times for the same pattern, removing by callback may remove all such entries from that pattern bucket.

A listener callback returning a value is not a request/reply protocol; use a defined Cross-Host request or another explicit RPC contract for response semantics.

## 3. Framework `EventArgsMap`

The following Core events have typed arguments in the current `EventArgsMap`. The map is descriptive of event name/payload shape, not a guarantee that each event is emitted in every deployment mode.

| Event name | Arguments |
|---|---|
| `system.boot.start` | `{ mode: string; at: number }` |
| `system.ready` | `Client<true>` |
| `system.shutdown.start` | `{ signal: string; role: string; at: number }` |
| `system.shutdown.complete` | `{ signal: string; role: string; at: number }` |
| `system.http.ready` | `{ host: string; port: number }` |
| `system.http.stopped` | `{ at: number }` |
| `system.plugins.booted` | `{ count: number; durationMs: number }` |
| `system.plugins.shutdown` | `{ at: number }` |
| `system.log.error` | `{ level?: string; message: string; name?: string; stack?: string; meta?: unknown; at?: number }` |
| `system.error.unhandled` | `{ message: string; stack?: string; origin?: string; at?: number }` |
| `system.migration.complete` | `{ scope: string; applied: number; failed: number; failedPlugins: readonly string[] }` |
| `system.migration.plugin_failed` | `{ pluginId: string; error: string }` |
| `system.secrets.locked` | `{ keyCount: number }` |
| `system.database.ready` | `{ alias: string; engine?: string }` |
| `system.database.closed` | `{ at: number }` |
| `config.loaded` | `{ count: number }` |
| `config.reloaded` | `{ name?: string; count?: number }` |
| `config.snapshot.applied` | `{ entries: number }` |
| `lang.loaded` | `{ namespaces: number }` |
| `lang.reloaded` | `{ namespaces?: number }` |
| `lang.snapshot.applied` | `{ entries: number }` |
| `emoji.loaded` | `{ count: number }` |
| `emoji.synced` | `{ count?: number }` |
| `emoji.snapshot.applied` | `{ entries: number }` |
| `permissions.ready` | `{ engine: string; alias: string }` |
| `guildgate.ready` | `{ engine: string; alias: string }` |
| `plugin.enabled` | `{ pluginId: string; version?: string; durationMs?: number }` |
| `plugin.disabled` | `{ pluginId: string }` |
| `plugin.preload.complete` | `{ count: number }` |
| `interaction.commands.synced` | `{ count: number; guildId?: string | null; global: boolean }` |
| `interaction.handled` | `{ category: string; commandName?: string; pluginId?: string; guildId?: string | null; success: boolean; durationMs?: number }` |
| `shard.ready` | `{ shardId: number; totalShards: number; userTag: string | null }` |
| `shard.disconnect` | `{ shardId: number; reason?: string }` |
| `shard.set.changed` | `{ previous: readonly number[]; next: readonly number[]; totalShards: number; reason?: string }` |
| `crosshost.worker.registered` | `{ machineId: string; assignedShards: readonly number[]; totalShards: number }` |
| `crosshost.assignment.applied` | `{ machineId: string; previous: readonly number[]; next: readonly number[]; reason: string; generation: number }` |
| `crosshost.heartbeat.started` | `{ machineId: string; intervalMs: number }` |
| `crosshost.worker.dead` | `{ machineId: string; ageMs: number }` |
| `crosshost.rebalance` | `{ strategy: string; moves: number; reason: string }` |
| `crosshost.orchestrator.ready` | `{ totalShards: number; strategy: string; snapshotVersion: number }` |
| `crosshost.claim.acquired` | `{ fingerprint: string }` |
| `crosshost.snapshot.applied` | `{ version: number; mode: 'full' | 'diff'; hash?: string }` |
| `crosshost.identify.granted` | `{ machineId: string; shardId: number; allowResume: boolean }` |
| `crosshost.storage.gate.passed` | `{ at: number }` |
| `crosshost.plugin_bus.started` | `{ machineId: string }` |
| `command:executed` | `{ pluginId: string; commandName: string }` |
| `audit.recorded` | `AuditRecord` |
| `error.recorded` | `ErrorOccurrence` |

The `discord.<E>` namespace is generated from `discord.js`'s `Events` enum. The type map maps each bridged event to the corresponding `ClientEvents[E]` arguments where that key is available. Use the supported event constant/name for your installed discord.js version rather than hardcoding an assumption that all versions expose identical enum values.

## 4. Emission and ownership examples

```ts
const off = heart.system.events.on('system.ready', async (client) => {
  // Keep side effects brief and safe to retry.
});

// On teardown when using an API path not already owner-managed:
off();
```

For a service that owns multiple listeners:

```ts
const owner = `my-plugin:${runtimeId}:${generation}`;
heart.system.events.on('plugin.enabled', onEnabled, { owner });
// When the owning runtime is disposed:
heart.system.events.unregisterByOwner(owner);
```

Use stable event names, narrow payloads and scalar identifiers. Do not emit secrets, raw authorization headers, full database records, large unbounded arrays or non-serializable runtime handles. For user-facing plugin contracts, prefer the injected SDK and its narrower `emit/on/once` API.

## 5. Security and correctness details

- Do not use a wildcard such as `*` for expensive synchronous work without understanding how many events it matches.
- Avoid heavy work in the hot path of Discord gateway events.
- If an event needs a durable audit trail, persist the audit record explicitly; in-memory emission alone isn't durable.
- Do not assume a listener has completed when using fire-and-forget emission by another part of Core.
- Distinguish event payload timestamps from wall-clock observation time.
- Test one-shot cleanup on concurrent emission and listener self-unregistration.
