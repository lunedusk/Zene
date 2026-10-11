# Operations and troubleshooting

## 1. Startup order

The standard bot startup path imports the runtime entrypoint, runs the boot pipeline, creates the Discord client, initializes logging/error capture, preloads plugin metadata and dependencies, loads config and language assets, initializes databases, runs migrations, initializes permission systems/caches, initializes interaction handling, logs in to Discord, starts HTTP on the primary client, boots plugins, finalizes HTTP routing, initializes emoji assets and syncs commands. Specific order differs in updater-only and Cross-Host branches; the source entrypoint is authoritative.

Startup errors can come from more than one stage. Read the first causal error and the subsequent cleanup messages separately.

## 2. Plugin fails to load

Investigate in this order:

1. Is the directory in the plugin root and is `index.js` present?
2. Is the manifest parseable, unique and compatible with the Core/Node version?
3. Is a signed artifact present? If so, did verification succeed? A failed signed artifact cannot be rescued by an unsigned JSON manifest.
4. Do all required plugin dependencies exist, avoid cycles and pass authenticated dependency closure?
5. Did npm package installation succeed using the selected backend?
6. Did config/language validation disable the plugin?
7. Does the class export the expected default subclass and does its constructor avoid using `heart` before injection?
8. Did setup/enable throw or time out?
9. Did runtime selection reject the requested isolation/capability policy?

Use boot status, trust outcome and runtime record separately. A `SUCCESS` loader status is not the same thing as “signed”; signed integrity is not the same thing as successful plugin startup.

## 3. Database failure

Check the `Database` JSON value first. Each object key is the alias. The URI scheme and optional `engine` decide the manager path. SurrealDB configuration also has a namespace and database. Log lines display alias and protocol; avoid adding full credential-bearing URIs to diagnostics.

If `Database` parsing fails, boot may skip configured aliases then attempt defaults. That can leave a subsystem without its preferred backend. Confirm manager initialization logs and `DatabaseManager.healthCheck()` output rather than assuming configuration succeeded.

For Core data storage, inspect `CoreDataEngine`, `CoreDataAlias`, and `core.dataBackend` configuration. Explicit backend selections fail if the configured engine/alias isn't connected; durable policies cannot be silently fulfilled by memory. With Cross-Host enabled, file-local SQLite/embedded SurrealDB defaults are skipped/rejected.

### SurrealDB `table does not exist`

SurrealDB 3.x requires table-definition behavior to be considered explicitly before a table is selected on a fresh database. In this baseline, audit and error occurrence stores ensure their own schemaless table before public operations. The Core data adapter maintains a separate schema/catalogue. A store-level schema ensure and Core data adapter schema are not interchangeable.

When this error appears, record the actual alias plus namespace/database, trace the call from application bootstrap to schema init to read/write, and reproduce in a fresh isolated namespace. Do not fix a test by creating a production table ad hoc unless that creation is the actual supported lifecycle path.

## 4. HTTP and command problems

Check whether the server is initialized, which routers are mounted, the host/port, and whether you are on the primary shard/worker. `APIPort` defaults to `3000`; `APIHost` defaults to `0.0.0.0`. Core HTTP mount registration requires server initialization. Plugin routes must use the recognized `BaseRoute` path and authentication/authorization appropriate to their endpoints.

For commands, verify loader registration succeeded, application sync completed, requirements passed, the guild/global sync target is correct and Discord propagation has completed. Validate `allowInDm`, permissions, role/user restrictions and cooldown behavior independently.

## 5. Token subsystem

The first-party token handler reads `TokenMasterSecret` and rejects it if missing or shorter than 32 characters. Token claims and rotation/revocation depend on the configured storage backend. `TokenTTL`, `TokenMaxTTL`, `TokenIssuer` and `TokenAudience` affect token policy. Changing master secret or version state can invalidate existing tokens; plan rotation deliberately.

## 6. Cache symptoms

A process-local cache is not shared across workers. A Redis-backed namespace can be shared only if all workers resolve to the same server/database/keyspace and their namespace conventions agree. Don't interpret local fallback presence as durable cross-host state. See [Cache](CACHE.md).

## 7. Cross-Host failure

Verify:

- `CROSS_HOST=true` and `CROSS_HOST_ROLE` is either `orchestrator` or `worker`.
- Orchestrator has `CROSS_HOST_CLUSTER_SECRET` configured.
- `Database` includes an accessible Redis alias: `crosshost` is preferred; `main` is the fallback if it is Redis.
- Worker can reach `CROSS_HOST_ORCHESTRATOR_URL` on the configured HTTP port.
- Machine IDs are unique; Core/plugin versions satisfy the selected compatibility mode.
- Firewall, TLS/mTLS and certificate paths are correct.
- Heartbeats are received and assignment generations are current.

Workers may be registered but assigned zero shards; in that state the Discord login is intentionally skipped until shards are assigned. Inspect the control-plane membership/assignment logs rather than interpreting a quiet worker as necessarily failed.

## 8. Updater problems

Run a dry-run plan before forced changes. Inspect whether the result was allowed, which files will be overwritten/added/kept, whether local edits are dirty, the plugin decision list and backup state. Check GitHub credentials/rate limit where necessary, repository/branch selection and plugin manifest path. Do not run arbitrary `UpdaterPostUpdateCmd` values from untrusted config.

## 9. Preserve useful diagnostic evidence

When reporting an incident, include the commit/tag, Node version, deployment mode, plugin ID, relevant boot stage, connection alias/engine (not full URI), stable error code, sanitized stack and exact reproduction. Remove tokens, passwords, personal data and private filesystem paths unless they are strictly necessary and safe to share.
