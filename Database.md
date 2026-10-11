# Database configuration and persistence reference

## 1. Connection model

Zene can maintain several database connections at once. Each connection has an **alias**—a process-local key such as `main`, `crosshost`, or a subsystem-specific name. Aliases are not database names and do not imply a particular engine.

The `Database` setting is parsed in `src/core/database/bootstrap.ts` as a JSON object whose property names are aliases and whose values are connection configurations:

```json
{
  "main": {
    "uri": "ws://127.0.0.1:8000",
    "engine": "surrealdb",
    "namespace": "zene",
    "database": "main",
    "username": "root",
    "password": "replace-me",
    "poolSize": 10,
    "maxRetries": 5
  },
  "crosshost": {
    "uri": "redis://127.0.0.1:6379",
    "engine": "redis"
  }
}
```

Put the JSON on one line in `.env`:

```dotenv
Database={"main":{"uri":"ws://127.0.0.1:8000","engine":"surrealdb","namespace":"zene","database":"main","username":"root","password":"replace-me"},"crosshost":{"uri":"redis://127.0.0.1:6379","engine":"redis"}}
```

The parser accepts `uri`, `engine`, `poolSize`, `maxRetries`, and optional SurrealDB `namespace`, `database`, `username`, `password`, `token`. Entries missing a non-empty URI are skipped. A JSON parse failure is logged; it does not magically make the supplied configuration valid.

## 2. Supported connection routes

| Engine/protocol | Manager route | Notes |
|---|---|---|
| `postgres-native://...` or engine `native-pg` | Native PostgreSQL pool | Used by the direct PostgreSQL manager and supported Core data adapter. |
| `sqlite://...` with native selection (no ORM entities and not forced ORM) | Native SQLite manager | File-local. Disallowed in Cross-Host. |
| `rocksdb://`, `surrealkv://`, `surrealkv+versioned://`, `mem://` | SurrealDB manager | Embedded protocols are disallowed when Cross-Host is enabled. `mem` is process-local and non-durable. |
| `ws://`, `wss://`, `http://`, `https://` when treated as Surreal protocol | SurrealDB remote connection | Remote SurrealDB protocol. Namespace/database are separately selected. |
| `redis://`, `rediss://` | Redis manager | Cross-Host's control plane needs Redis through `Database.crosshost` or `Database.main`. |
| `mongodb://`, `mongodb+srv://` | MongoDB manager | Pool size used when configured. |
| `postgres://`, `postgresql://`, `mysql://`, `mariadb://`, ORM `sqlite://` | TypeORM manager | SQL/ORM route, depending on selection. Cross-Host rejects SQLite. |

The `engine` field can disambiguate a URI; protocol detection also chooses a route. Consult `src/core/database/index.ts` before adding a new engine or protocol. Database clients are exposed through `heart.db` for Core plugin code.

## 3. Default bootstrap

`initAllDatabases()` in `src/core/database/bootstrap.ts` reads configured aliases and calls `DatabaseManager.init()`. It then ensures default `main` SQLite and Surreal connections only when those managers don't already have `main`, unless the relevant disable flag or Cross-Host rule suppresses them. The default embedded Surreal path is resolved under `.data/database/surreal/<engine>/<alias>`; default SQLite uses `.data/database-sqlite/main.db`.

- `DisableDefaultSqlite=true` suppresses default SQLite. Source comments warn that permission and other Core features relying on SQLite may be unavailable if no replacement backend exists.
- `DisableDefaultSurrealDB=true` suppresses default embedded SurrealDB.
- Cross-Host mode skips/rejects local-file engines because workers require shared state.
- Core data platform initialization follows database manager setup. It resolves an active data engine/alias after managers have been initialized.

Configured connection initialization failures are logged. Verify actual connected aliases with startup logs/health checks; a JSON entry in configuration is not evidence that a service connected.

## 4. SurrealDB options and identity

`SurrealConnectOptions` includes optional `namespace`, `database`, `username`, `password`, and `token`. The Surreal manager builds a client with remote and Node engines and provides the `ws` implementation because the runtime's WebSocket requirements need an explicit implementation for supported Node versions. Connection and auth errors are classified into safe categories for logs.

The five values to distinguish are:

1. **Alias** — local manager key, e.g. `main`.
2. **URI** — embedded path or remote endpoint.
3. **Namespace** — SurrealDB namespace selected on connect.
4. **Database** — SurrealDB database selected inside that namespace.
5. **Record/table identity** — SurrealDB table and record key used by a query.

For example, `surrealDB.get('main')` resolves an alias. It does not refer to a database literally named `main` by itself.

The shared helper in `src/core/database/surrealRecord.ts` selects `type::record` for SurrealDB 3+ and `type::thing` for 2.x where supported, allowlists table names, parameter-binds identities and removes the reserved record `id` from CONTENT payloads. Application-level identities are carried in `logicalKey` (and compatible `key` fields). Runtime paths should use the shared helpers instead of duplicating record query construction.

### Core audit and error stores

At the documented source baseline, `audit_entries` and `error_occurrences` are ensured by their stores using idempotent `DEFINE TABLE IF NOT EXISTS ... SCHEMALESS` before public operations. This is separate from SQL/Mongo Core migrations. The boolean schema cache is module-local, so if code introduces multiple Surreal aliases or changes database ownership, review the schema ensure's connection scope and reset behavior.

### Core data adapter

The Core data registry adapters use separate key-value and privacy catalogue structures. `src/core/data/adapters/recordCodec.ts` defines the shared catalogue/record constants. Catalogue IDs are logical application IDs and must not be confused with Surreal's reserved `CONTENT.id` field. A Core data adapter schema is not the schema for the audit/error stores.

## 5. Core data backend selection

`resolveCoreDataBackend()` supports `sqlite`, `postgres`, `mongo`, `surreal`, and `redis`. Explicit inputs are resolved from the caller/config, `core.dataBackend` settings and then `CoreDataEngine`/`CoreDataAlias`. An explicit but disconnected/unknown engine fails closed. With no explicit engine, the resolver prefers connected backends in the order SQLite → PostgreSQL → MongoDB → SurrealDB → Redis, skips SQLite in Cross-Host, and may look for `main` after checking the requested alias.

The resolver's fallback is **backend selection among connected managers**, not a guarantee that all storage engines are semantically equivalent. Type-specific `storage` policy is validated against the active adapter. Durable requests cannot use the memory adapter or silently switch to an unrelated durable engine; a required connection alias must match.

## 6. Core data storage policies

The data registry supports:

```ts
type DataStorageEngine =
  | 'memory' | 'sqlite' | 'postgres' | 'mongo' | 'surreal' | 'redis';

interface DataStoragePolicy {
  engine: DataStorageEngine;
  alias?: string;
  requireDurable?: boolean;
  requireSubjectDelete?: boolean;
}
```

A data type also declares scope, owner plugin, personal-data flag, privacy class, optional schema and retention metadata. The active adapter is selected during `initializeDataPlatform()` and the privacy catalogue is loaded before privacy deletion operations should run. Memory mode requires explicit permission; production durable selection does not silently fall back when a configured durable service fails.

See [Data shapes and privacy](DATA_SHAPES.md) for authorization semantics and record types.

## 7. Database migration system

The migration runner in `src/core/database/migrations/runner.ts` handles registered Core and plugin migration scopes. It maintains migration version state and applies migration steps according to engine capability. SQLite migrations capture operations and apply them transactionally; PostgreSQL uses a transaction; Mongo records migration metadata using a unique scope/version index. The SQL/Mongo migration set does not automatically create arbitrary SurrealDB tables; Surreal-only stores currently own their schema ensure.

Plugin migration discovery checks the plugin migration entrypoints supported by the runner. Test the actual supported layout and schema lifecycle before relying on a migration in production.

## 8. Failure and recovery

- Do not log full credential-bearing connection strings.
- Check both connection-manager logs and consuming subsystem config; a manager can be connected on one alias while the consumer hardcodes another alias.
- In Cross-Host, all workers/orchestrator must agree on shared database topology where shared state is required.
- Back up persistent data and test restoration, not just backup creation.
- Do not delete whole schemas in tests that share a database. Use unique IDs and test-specific namespace/database isolation.
- Preserve errors on failed durable writes; don't return fabricated success or hide missing schemas behind a memory adapter.
