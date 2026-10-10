# Database reference

Zene manages database connections as **named aliases**. Each alias is a connection label in configuration; it is not the same as a SurrealDB namespace or database name.

## Alias model

Configuration uses a `Database` JSON object (or equivalent secret/config source) mapping alias → engine settings:

```json
{
  "main": {
    "uri": "rocksdb://local",
    "engine": "surrealdb",
    "namespace": "main",
    "database": "main"
  },
  "cache": {
    "uri": "redis://127.0.0.1:6379",
    "engine": "redis"
  }
}
```

| Field | Meaning |
|-------|---------|
| `uri` | Connection string for the engine |
| `engine` | One of the supported engine identifiers |
| `namespace` / `database` | SurrealDB only: logical NS/DB after connect |
| `username` / `password` / `token` | SurrealDB authentication when required |
| `poolSize` | Pool sizing where the engine supports pools |

## Supported engines

| Engine value | Manager | Notes |
|--------------|---------|--------|
| `native-sqlite` | SQLite | Local file; common dashboard/test backend |
| `native-pg` | PostgreSQL | Remote SQL |
| `mongo` | MongoDB | Document store |
| `redis` | Redis | Cache and ephemeral structures (main/pub/sub triad) |
| `surrealdb` | SurrealDB | Remote (`ws`/`wss`/`http`/`https`) or embedded (`mem`, `rocksdb`, `surrealkv`) |
| `typeorm` | TypeORM | When configured with entities |

Exact engine strings are defined in Core database configuration types (`src/core/database/index.ts`).

## SurrealDB

### Remote versus embedded

- **Remote:** `ws://`, `wss://`, `http://`, `https://`
- **Embedded:** `mem://`, `rocksdb://`, `surrealkv://` (paths under `.data/database/surreal/...` when using `…://local`)

Node process clients use the Core registry in `src/core/database/surreal.ts`, which supplies a Node-compatible WebSocket implementation from the `ws` package. Prefer this registry over constructing ad-hoc `Surreal` instances in plugins.

### Authentication and selection

Connect with namespace, database, and optional authentication in a single `connect(url, options)` call when using the shared client. Empty credentials are not treated as root login. Unauthenticated local servers omit authentication entirely.

### Record identity

SurrealDB record IDs are distinct from application logical keys. Core helpers in `src/core/database/surrealRecord.ts` use version-aware `type::record` (SurrealDB 3.x) or `type::thing` (2.x), parameter binding, and CONTENT payloads **without** a conflicting reserved `id` field. Application identifiers are stored as `logicalKey` / `key` / `typeId` as appropriate per subsystem.

### Default main instance

Unless disabled (`DisableDefaultSurrealDB`) or forbidden by Cross-Host policy, Core may provision a default Surreal `main` embedded instance for local operation. Cross-Host must not treat embedded local files as the shared multi-worker store.

## Core data platform

Plugin-facing durable data goes through the Core data registry (`src/core/data`), not raw engine clients in third-party plugins.

- **Engines:** memory (explicit test/dev only), sqlite, postgres, mongo, redis, surreal
- **Privacy catalogue:** Core-owned metadata retained after plugin unload for deletion workflows
- **Policies:** durable requirements, alias constraints, and capability checks fail closed

See also the public SDK data surface in `@lunedusk/zene-sdk` (no Core imports).

## Backend selection

Different subsystems resolve backends independently:

- **Core data:** `CoreDataEngine` / `CoreDataAlias` / `core.dataBackend` style configuration
- **Dashboard SQL paths:** `resolveDashboardBackend` and related selectors
- **Guild helpers:** narrower engine unions where Surreal/Redis are not claimed

Invalid explicit engine names fail closed; there is no silent fall-back to memory for durable production paths.

## Cross-Host storage

Shared Cross-Host records require a **remote** shared database alias reachable from every worker. Consumers typically resolve Surreal through `surrealDB.get('main')` / `heart.db.surreal.get('main')` when `main` is the configured shared instance. Document and configure the same alias consistently; do not point shared features at per-worker embedded paths.

## Operational notes

- Connection bootstrap retries are controlled by Core database initialization
- Failed Surreal initialization closes partially constructed clients
- Public errors from the data layer are sanitized (`DATA_PERSISTENCE_FAILURE` and related codes)
- Prefer parameter binding; never interpolate user input into SurrealQL or SQL strings
