# Database Configuration Guide

Welcome to the Database Configuration guide! Our framework uses a dynamic, JSON-based environment variable (`Database`) to allow you to seamlessly connect to one or multiple databases simultaneously.

By defining your databases in your `.env` file, the core system will automatically manage the connection pooling, background retries, and lifecycle teardowns for you.

---

## 1. The `.env` File Setup

Your `.env` file serves as the source of truth for your application. To configure your databases, you will use the `Database` key. Because you might want to connect to multiple databases (e.g., a primary database and a Redis cache), this variable takes a JSON Object.

Here is an example of a database config inside `.env` file for reference:

```env
# --- Database Configuration ---
Database={"main": {"uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main"}, "cache": {"uri": "redis://localhost:6379", "engine": "redis", "poolSize": 5}}
```

---

## 2. The Configuration Object

The `Database` JSON object uses a **Key-Value** structure.

- **The Key (alias):** This is the name you will use to request this database in your code (e.g., `"main"`, `"economy"`, `"cache"`).
- **The Value:** A configuration object defining how to connect to it.

### Configuration Properties

| Property | Type | Required | Description |
|---|---|---|---|
| `uri` | string | **Yes** | The connection string for the database (e.g., `mongodb://localhost:27017/db`, `postgres://user:pass@localhost/db`). Note: For embedded SurrealDB (`rocksdb://local`), the path is managed under `.data/database/surreal/…`. |
| `engine` | string | Optional | Explicitly tells the manager which driver to use. If omitted, the system tries to guess based on the URI protocol (e.g., `redis://` defaults to Redis). See supported engines below. |
| `poolSize` | number | Optional | The maximum number of simultaneous connections in the pool. **Default:** `10`. |
| `maxRetries` | number | Optional | How many times to attempt reconnecting if the database is offline at startup. **Default:** `5`. |

---

## 3. Supported Engines & Examples

Our system supports **6 different database engines** natively. Here is how to configure each one.

### 🍃 MongoDB (`mongo`)

Connects using the native Mongoose driver. Automatically applies your `poolSize` to handle high concurrency.

```json
{
  "main": {
    "uri": "mongodb+srv://user:pass@cluster.mongodb.net/myDatabase",
    "engine": "mongo",
    "poolSize": 20,
    "maxRetries": 5
  }
}
```

### ⚡ Redis (`redis`)

Initializes a robust Redis triad. Behind the scenes, it automatically spins up **Main**, **Pub**, and **Sub** clients for this single alias, allowing you to use standard caching and Pub/Sub event broadcasting instantly.

```json
{
  "cache": {
    "uri": "redis://127.0.0.1:6379",
    "engine": "redis"
  }
}
```

### 🐘 PostgreSQL Native (`native-pg`)

Connects directly to PostgreSQL using the `pg` driver for maximum raw query performance. Includes automatic idle timeouts and connection pooling.

```json
{
  "main": {
    "uri": "postgresql://user:password@localhost:5432/mydb",
    "engine": "native-pg",
    "poolSize": 15
  }
}
```

### 🗄️ SQLite Native (`native-sqlite`)

Uses `better-sqlite3` for incredibly fast, synchronous local SQL. Automatically applies WAL (Write-Ahead Logging) mode for maximum performance.

```json
{
  "localdb": {
    "uri": "sqlite://./data/my_database.db",
    "engine": "native-sqlite"
  }
}
```

### 🔗 TypeORM (`typeorm`)

If you prefer using an Object-Relational Mapper, this engine supports `postgres`, `mysql`, `mariadb`, and `sqlite`. It automatically syncs your tables (in non-production environments) and handles pooling.

```json
{
  "main": {
    "uri": "mysql://user:pass@localhost:3306/mydb",
    "engine": "typeorm",
    "poolSize": 10
  }
}
```

### 🌐 SurrealDB (`surrealdb`)

Official SurrealDB SDK with both **remote** and **embedded** modes via `surrealdb` + `@surrealdb/node`.

**Remote protocols:** `ws://`, `wss://`, `http://`, `https://`  
**Embedded protocols:** `mem://` (in-memory), `rocksdb://` (persistent RocksDB), `surrealkv://` / `surrealkv+versioned://` (persistent SurrealKV)

**Path rules for embedded storage:**
- `rocksdb://local` (or empty path) resolves to `.data/database/surreal/rocksdb/{alias}/`
- `surrealkv://local` resolves to `.data/database/surreal/surrealkv/{alias}/`
- Explicit paths after the scheme are honoured as written (resolved absolute)

**Optional auth / selection fields** on the config object (applied after connect when present):

| Property | Description |
|---|---|
| `namespace` | Surreal namespace (`.use`) |
| `database` | Surreal database (`.use`) |
| `username` / `password` | Credentials for `.signin` |
| `token` | Bearer token for `.authenticate` (alternative to username/password) |

```json
{
  "main": {
    "uri": "rocksdb://local",
    "engine": "surrealdb",
    "namespace": "main",
    "database": "main"
  },
  "remote": {
    "uri": "ws://127.0.0.1:8000",
    "engine": "surrealdb",
    "namespace": "app",
    "database": "prod",
    "username": "root",
    "password": "secret"
  }
}
```

**Default fallback:** If no SurrealDB `"main"` instance exists after configured databases are initialized, the framework auto-provisions one at `.data/database/surreal/rocksdb/main` unless `DisableDefaultSurrealDB=true` or `CROSS_HOST=true` (embedded local-file engines are forbidden under Cross-Host).

**Access in code:**

```ts
const db = this.heart.db.surreal.get('main');
await db.query('CREATE person SET name = $name', { name: 'Tobie' });
```

---

## 4. Advanced: Multiple Databases

You are not limited to just one database. Because the configuration is JSON, you can mix and match databases exactly as your architecture requires.

**Example: NovaDB as Primary, Redis as Cache, and Postgres for Analytics:**

```env
Database={"main": {"uri": "rocksdb://local", "engine": "surrealdb", "namespace": "main", "database": "main"}, "cache": {"uri": "redis://localhost:6379", "engine": "redis"}, "analytics": {"uri": "postgresql://user:pass@remote:5432/stats", "engine": "native-pg", "poolSize": 5}}
```

### Accessing them in your code

If you are using the `IHeart` domain system, accessing these databases is as simple as calling their alias:

```ts
// Access your Redis triad
const cacheDb = heart.db.redis.get('cache');
await cacheDb.main.set('key', 'value');

// Access Postgres
const pgPool = heart.db.postgres.get('analytics');

// Access SurrealDB
const surreal = heart.db.surreal.get('main');
await surreal.query('INFO FOR DB');
```


---

## 5. Subsystem data backends (permissions, token, guild-gate)

Framework tables for **permissions**, **tokens**, and **guild-gate** do not use the raw `Database` JSON alone. They go through a shared **backend selector**:

1. Prefer an explicit engine from config or env for that subsystem.
2. Otherwise pick the first available engine in order: **sqlite → postgres → mongo** on the resolved alias (default `main`).

| Subsystem | Config keys | Env engine | Env alias |
|-----------|-------------|------------|-----------|
| Permissions | `permissions.engine` / `permissions.alias` | `PermissionsEngine` | `PermissionsDbAlias` |
| Token | `token.engine` / `token.alias` | `TokenEngine` | `TokenDbAlias` |
| Guild-gate | same pattern as permissions when configured | (inherits main preference when unset) | |

SQL access is unified via `SqlAdapter` (`?` placeholders rewritten to `$n` on postgres). Mongo uses collection helpers on the same adapter surface.

Token persistence: use **`DbTokenStore`** (`#core/manager/token.js`). `SqliteTokenStore` is a deprecated alias only.

---

## 6. Schema migrations

Schema is owned by the **migration runner**, not by ad-hoc `CREATE TABLE` in managers.

- **When:** after all databases connect, **before** plugins boot.
- **Scopes:** independent chains — `core` and each `plugin:<id>` (external plugins are not coupled to core version bumps).
- **Shape:** forward-only ordered steps (`version` 1, 2, 3…); each step is a TypeScript `MigrationStep` with `up(ctx)`.
- **Engines:** each step must support the active engine (sqlite / postgres / mongo). Mongo steps must be internally idempotent.
- **Plugin folder:** `plugins/<id>/migrations/` (registered at preload).
- **Tracking table/collection:** `schema_migrations` per connected backend, keyed by scope + version.

If a plugin has migrations but no connected backend for its alias, that scope is skipped (debug log) and boot continues.

See also the authoring contract in [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) (Migrations section).


---

## Dashboard data plugin (`dash-data`)

Persistence for the web dashboard lives in the **`dash-data`** plugin (not the HTTP `dashboard` plugin).

### Strategy (existing data)

- **Same physical tables/collections** (`dash_*`) on the same backend selected by `resolveDashboardBackend()` / `DashboardEngine` env.
- Migrations use `CREATE TABLE IF NOT EXISTS` / create collection if missing — **rows are not copied or deleted**.
- Installs that already ran `plugin:dashboard` v1 keep their data; `plugin:dash-data` v1 is idempotent against the same names.
- **New** tables in `plugin:dash-data` v2: `dash_kv`, `dash_layouts`, `dash_surface_flags`.

### Access

| Path | Role |
|------|------|
| `src/plugins/dash-data/src/lib/store.ts` | Shared store (SQL/mongo helpers + domain API) |
| Handler `dash-data` / `store` | Inter-plugin API (`kv*`, `getLayout`, `getTheme`, bans, …) |
| `dashboard/src/lib/db.ts` | Compatibility **re-export** of the store — existing `/api/dash/*` routes unchanged |

Document collections `dash_infractions`, `dash_audit_log`, `dash_command_counters` are stored on SurrealDB `main` (tables of the same name).

## Permission link tables

When using SQL adapters, permissions manager ensures:

- `perm_role_links` — Discord role ↔ perm role
- `perm_role_grants` — provenance (`direct` | `discord_role`)
- `perm_guild_mirror` — per-guild Discord permission mirror flag + optional map JSON

Legacy role `assignedUserIds` without grant rows are migrated to `direct` on init.
