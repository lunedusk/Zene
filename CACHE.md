# Cache architecture and usage

## 1. What the facade does

`src/core/manager/cacheFacade.ts` exposes `CacheFacade` and `CacheNamespace`. `heart.cache.facade` provides the facade and `heart.cache.ns(alias?)` returns a namespace. Each namespace has local key-value storage (`TTLCache`), local rate-limit records, and a process-local presence map; it can also resolve a Redis main client from a configured alias chain.

The default cache alias is `main`. The cooldown-specific alias chain is `cooldown` → `redis`, deliberately separate from the default main chain so rate-limit state doesn't silently bind to a random general database alias. Inspect the namespace selected by each subsystem rather than assuming all features use the same alias.

## 2. Namespace API

The `CacheNamespace` implementation includes:

- `get(key): Promise<string | null>`
- `set(key, value, ttlMs?): Promise<void>`
- `delete(key): Promise<boolean>`
- `deleteByPrefix(prefix): Promise<number>`
- `deleteKeysMatching(predicate): Promise<number>`
- `has(key): Promise<boolean>`
- `incrWithTtl(key, windowMs, limit): Promise<{count, ttlMs, limited}>`
- `decr(key): Promise<void>`
- `hasPresence(key)`, `setPresence(key)`, `deletePresence(key)`, `clearPresence()`, `loadPresence(keys)`

`CacheFacade` exposes `namespace(alias = 'main', options?)`, plus convenience namespace selectors such as `cooldown()`, `guildGate()` and `main()`.

Options include an alias, local maximum size (default 10,000 for a namespace), and optional default TTL. `set` stores locally and attempts Redis write when a client is available. A positive TTL is sent to Redis in milliseconds using `PX`; omitted/non-positive TTL uses a regular Redis set under the current implementation.

## 3. Local versus Redis behavior

Reads try Redis where an eligible client is present. A successful Redis value updates the local cache; a Redis miss removes a stale local key. On Redis failure, the namespace logs a warning and may fall back to local state. Rate-limit operations have local fallback behavior as well.

This has practical implications:

- Local cache entries are process-local and disappear on restart.
- Local fallback is not shared across Cross-Host workers.
- A Redis failure can cause different processes to diverge temporarily if they fall back to local state.
- A cache write returning successfully does not prove that it was persisted in Redis; the implementation catches Redis errors and logs them.
- Do not use this facade as the authoritative store for payments, authorization grants, durable audit records or data that must survive process restart.

## 4. Rate-limit data

`incrWithTtl` uses Redis `INCR`, `PEXPIRE ... NX`, and `PTTL` through a pipeline when possible. The local path records count and reset time. Its `limited` value is based on `count > limit`; it is not `count >= limit`. Keep this contract in mind when interpreting a configured maximum. `decr` decrements only positive values in the current local/Redis path.

A rate-limit decision that protects a sensitive operation should not assume local fallback is a distributed atomic authority. Confirm whether the selected deployment mode requires a shared Redis connection and decide how the operation should behave when it is unavailable.

## 5. Presence keys

Presence state is tracked in a local `Map`; set/delete calls perform a best-effort dual write to Redis with a namespaced prefix `presence:<alias>:<key>`. `clearPresence()` clears the local map. `loadPresence()` seeds local presence entries but does not imply a full Redis scan. These methods are convenience metadata, not durable membership state.

## 6. Plugin guidance

Prefix keys with plugin and feature names, e.g. `example-plugin:preferences:<userId>`, and include scope identifiers so one tenant cannot collide with another. Validate and normalize IDs before constructing keys; avoid raw user-controlled strings that could create unexpectedly broad prefixes.

Use short TTLs for transient results and cache only values safe to retain temporarily. Avoid storing secrets or full personal profiles. When relying on a prefix delete, make the namespace clear and test it against an isolated keyspace.

## 7. Troubleshooting

- Confirm the Redis connection alias is actually initialized.
- Verify the subsystem's alias chain; a configured Redis connection under an unrelated alias may not be discovered.
- Review logs for Redis failures and determine if the code fell back to local state.
- Confirm TTL units are milliseconds in the API.
- Never infer Cross-Host consistency from local fallback passing tests on one process.
