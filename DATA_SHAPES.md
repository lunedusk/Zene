# Data contracts, types, and privacy operations

This guide catalogs the significant data contracts maintained by Core and the published SDK. TypeScript source is authoritative for exact optionality and version-specific fields; this guide explains what the contracts mean and how they interact.

## 1. Shared concepts

- **Plugin ID:** stable owner identity for plugin artifacts and their data types.
- **Runtime ID and generation:** identify one running instance of a plugin and guard against stale messages/bindings after reload.
- **Scope:** subject boundary associated with a data type, such as a user, guild, plugin, server, global or system scope.
- **Privacy class:** `public`, `internal`, `personal`, `sensitive`, or `secret`.
- **Data type:** Core-registered schema-like metadata describing ownership, privacy, scope and storage policy.
- **Subject:** the identity fields against which an access/write/delete request is constrained.
- **Logical record key:** the application-defined identifier for a record. This is distinct from a database engine's native primary/record ID.

## 2. Core data types

Authoritative definitions: `src/core/data/types.ts`.

### `DataScope`

```ts
type DataScope = 'user' | 'guild' | 'plugin' | 'server' | 'global' | 'system';
```

`user` requires `subject.userId`. `guild` and `server` require `subject.guildId`. `plugin` requires `subject.pluginId`. `global` and `system` do not require one of those three fields at scope-validation time, but that does not authorize unrestricted plugin-wide deletion.

### `PrivacyClass`

```ts
type PrivacyClass = 'public' | 'internal' | 'personal' | 'sensitive' | 'secret';
```

Only `public` types may be read by a plugin other than the owner. Export rules additionally deny `secret` and allow cross-plugin export only for `public` personal data. The type owner may read/write/export according to policy; the owner check is not an all-purpose permission system for external APIs.

### `DataStorageEngine` and `DataStoragePolicy`

```ts
type DataStorageEngine = 'memory' | 'sqlite' | 'postgres' | 'mongo' | 'surreal' | 'redis';
type DurableDataStorageEngine = Exclude<DataStorageEngine, 'memory'>;

interface DataStoragePolicy {
  engine: DataStorageEngine;
  alias?: string;
  requireDurable?: boolean;
  requireSubjectDelete?: boolean;
}
```

An explicit engine means the active adapter must match that durable engine. Memory does not satisfy a durable request. `requireDurable` and `requireSubjectDelete` enforce adapter capability flags. An alias constraint must match the adapter's actual connection alias.

### `DataTypeDefinition`

Core type definitions include `id`, `ownerPluginId`, `schema`, `scope`, `personalData`, `privacyClass`, optional `retention`, optional `storage`, and the deprecated `storageMapping` form. New code should use `storage`. IDs are validated against a restricted identifier expression and reject empty values, slash and `..` patterns.

The registry stores active type definitions separately from its retained privacy catalogue. Unregistering a plugin removes active definitions but does not delete persisted records or erase catalogue metadata; that allows Core-authorized deletion to continue after plugin unload.

### `DataSubject`, `DataRecord` and access requests

```ts
interface DataSubject {
  userId?: string;
  guildId?: string;
  pluginId?: string;
}

interface DataRecord {
  typeId: string;
  key: string;
  subject: DataSubject;
  value: unknown;
  ownerPluginId: string;
  updatedAt: number;
}
```

Access filtering currently supports an optional exact `key`; arbitrary structured query operators are not accepted by the public contract. When fetching by key, the registry checks that the record subject equals the requested subject before returning its value.

`DataAccessRequest` carries `typeId`, `subject`, optional query and `requesterPluginId`. `DataWriteRequest` additionally has `key` and `value`. The requester identity must be derived from the Core/SDK session, not accepted as an arbitrary plugin-supplied privilege claim.

### Data export/delete results

`DataExportResult` carries `typeId`, `records`, and `exportedAt` (timestamp milliseconds). `DataDeleteResult` carries the type ID and deleted-record count. Core data adapters support per-key operations, subject query/delete, whole-type deletion for Core-authorized plugin wipes, and a separate privacy catalogue.

## 3. Authorization matrix

The default policy in `src/core/data/policy.ts` currently implements:

| Operation | Owner plugin | Other plugin |
|---|---|---|
| Read/access | Allowed after scope/subject validation | Allowed only for `public` data |
| Write | Allowed | Denied |
| Export | Denied if class is `secret`; otherwise allowed by owner rules | Allowed only for `public` personal data; secret is denied |
| Subject delete | Allowed after scope/subject validation and adapter capability checks | Denied |
| Delete a user's personal data across all registered types | Core-only registry operation | Not available through general SDK API |
| Delete a guild/server's scoped data across the catalogue | Core-only registry operation | Not available through general SDK API |
| Delete all records for a plugin's types | Owner-authorized Core registry operation | Cannot wipe another plugin's data |

The user-global delete iterates retained catalogue entries flagged `personalData`. Guild/server deletion iterates entries whose scope is `guild` or `server`. These operations require adapter support for subject deletes. The registry rejects a subject delete that has no subject fields; whole-type deletion is a separate Core operation.

## 4. SDK data input types

The public package `@lunedusk/zene-sdk` defines similar, deliberately platform-neutral contracts:

- `DataScope`, `PrivacyClass`, `PluginId`, `PluginIdentity` and `SdkSessionContext` in `packages/zene-sdk/src/types.ts`.
- `DataTypeRegistration` and `DataSubjectInput` in `packages/zene-sdk/src/data.ts`.
- `SdkBridgeData` in `packages/zene-sdk/src/bridge.ts`, exposed through `PluginSdk.data`.

A registration contains `id`, optional `schema`, `scope`, `personalData`, `privacyClass`, optional `retention`, and optional storage settings. Subject input accepts optional `userId`, `guildId`, `pluginId`; the Core registry enforces fields required by the declared type's scope.

The SDK methods are:

- `registerType(definition): Promise<void>`
- `access(typeId, subject, query?): Promise<readonly unknown[]>`
- `write(typeId, key, subject, value): Promise<void>`
- `export(typeId, subject): Promise<{ typeId; records; exportedAt }>`
- `delete(typeId, subject): Promise<number>`

The public helper functions (`registerDataType`, `accessData`, `writeData`, `exportData`, `deleteData`) accept a bridge and perform authorization checks. Non-SDK exceptions from access/write/export/delete are wrapped into operation-specific `SdkError` codes. They do not turn failures into success.

## 5. Surreal record key contract

`src/core/database/surrealRecord.ts` defines `SurrealRecordCtor`, `resolveSurrealRecordCtor`, `contentWithoutReservedId`, CRUD helpers and `readLogicalKey`. A stored record's native database identity may be a `RecordId` object. Application identity reading prefers `logicalKey`, then `key`, then string `id`; it does not blindly stringify every native ID object as an application key.

`contentWithoutReservedId(data, logicalKey)` copies the payload, sets `logicalKey`, and deletes the `id` property because Surreal record IDs have special semantics. Table names must be explicitly allowlisted by the caller. Record identifiers are passed as query parameters rather than interpolated into SQL text.

## 6. Audit contract

Authoritative definitions: `src/core/audit/types.ts`.

- `AuditActorType`: `user | api_key | system`.
- `AuditOutcome`: `success | fail`.
- `AuditSurface`: `discord | http | cli | system | dashboard`.
- `AuditTargetType`: `user | guild | plugin | role | token_device | config | other`.
- `AuditRecordInput`: actor, action, target, outcome and optional reason/meta/surface/requestId/targetRef/before/after.
- `AuditRecord`: generated hex ID, actor/action/target/outcome, nullable reason, allowlisted scalar metadata, Unix-second `createdAt`, nullable surface/requestId/targetRef/before/after.

Audit records are written to the `audit_entries` Surreal table at `main`, after an idempotent schema ensure. Filters include actor, action, outcome, surface, request ID, time bounds and limit. Metadata sanitization allows a specific field-name list, excludes secret-like key names, limits strings, and discards arbitrary value structures.

## 7. Error occurrence contract

Authoritative definitions: `src/core/errors/types.ts` and `NovaError.ts`.

`ErrorOccurrenceInput` includes `code`, `category`, `severity`, `message` and optional arbitrary context; the store sanitizes context into scalar values. Severities: `debug | info | warn | error | fatal`. Common categories include `auth`, `token`, `permission`, `gateway`, `validation`, `internal`, `db`, `plugin`, `http`, `unknown`.

Persisted occurrences have an application ID, code/category/severity/message/context, `count`, `firstSeen`, and `lastSeen` (Unix seconds). Equivalent recent occurrences can be coalesced within `ErrorCoalesceWindowSec` (default 60, clamped to 1–3600 seconds). Context keys are allowlisted and string values capped at 256 characters; messages are capped at 512 characters. The table is `error_occurrences`.

## 8. Event data

`EventArgsMap` in `src/core/manager/events/EventBus.ts` types Core framework events and bridges Discord.js enum events under `discord.<name>`. It includes boot/shutdown, config/lang/emoji reload, permission/guild gate readiness, plugin lifecycle, command sync/handling, sharding, Cross-Host worker/assignment/heartbeat/claim/snapshot/identify/index events, and persisted `audit.recorded`/`error.recorded` payloads. See [Events](EVENTS.md) for the payload-by-event table.

## 9. Cross-Host control types

The Cross-Host model in `src/core/crosshost/types.ts` includes worker registration/challenge data, desired state (`zeneVersion` and plugin ID/version set), `WorkerView`, snapshot documents/envelopes, assignment and identify-grant messages, heartbeat and worker stats, update instructions/acks, audit/error index records and distributed query request/response shapes. These are internal protocol contracts unless separately exported by the SDK. Validate serialized messages using the protocol schemas rather than treating TypeScript interfaces as runtime validation.

## 10. Manifest, runtime and SDK-session types

- `PluginManifest` — plugin identity/version, dependencies, compatibility constraints, priority and npm dependency declarations.
- `PluginBootStatus` — discovery/preload/boot progress, separate from integrity status.
- `RuntimePolicy` — preferred/minimum/allowed isolation, fallback choice.
- `RuntimeSelectionResult` — selected isolation level or rejection code/reason.
- `SdkSessionContext` — plugin ID, runtime ID/generation, SDK/contract version, trust outcome and authorized flag.
- `SdkErrorBody` — stable code/message and optional scalar detail map.

Refer to `src/core/runtime/types.ts`, `src/core/loader/types.ts`, `packages/zene-sdk/src/types.ts`, and [Runtime](RUNTIME.md) for details.

## 11. Privacy engineering guidance

A type registry does not automatically make the value payload schema safe. Define what is collected, validate payload shape, minimize fields, scope every record, document retention and make export/deletion semantics testable. Do not mark data `public` simply to simplify cross-plugin reads. Avoid putting secrets in `context`, audit `meta`, error `message`, event payloads or logs.
