# Error model and occurrence persistence

## 1. Error layers

Zene has several error-facing mechanisms with distinct purposes:

- `NovaError` and subclasses provide a stable code/category/severity and client-safe message for known domain failures.
- Global error capture/bridges observe unhandled process/framework errors and can publish framework events.
- Error occurrence storage records sanitized, coalesced application errors for operator review.
- Logger output contains diagnostic details and stack traces where configured.

Do not treat the stored occurrence record as a complete stack trace archive, and do not expose the internal error message directly to an end user by default.

## 2. `ErrorOccurrenceInput` and record shape

```ts
type ErrorSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type ErrorCategory = 'auth' | 'token' | 'permission' | 'gateway' | 'validation' | 'internal' | 'db' | 'plugin' | 'http' | 'unknown';

interface ErrorOccurrenceInput {
  code: string;
  category: ErrorCategory | string;
  severity: ErrorSeverity;
  message: string;
  context?: Record<string, unknown>;
}

interface ErrorOccurrence {
  id: string;
  code: string;
  category: string;
  severity: ErrorSeverity;
  message: string;
  context: Record<string, string | number | boolean | null>;
  count: number;
  firstSeen: number;
  lastSeen: number;
}
```

Timestamps are Unix seconds. Occurrences are stored in SurrealDB table `error_occurrences` at the `main` connection alias in the current implementation. The store calls an idempotent schema ensure before public writes and reads because a fresh Surreal database may not have the table defined. This schema is independent of SQL/Mongo migrations.

## 3. APIs

`src/core/errors/index.ts` exports:

- `record(input): Promise<ErrorOccurrence | null>`
- `recordFromError(err): Promise<ErrorOccurrence | null>`
- `list(filter?): Promise<ErrorOccurrence[]>`
- `getById(id): Promise<ErrorOccurrence | null>`
- `NovaError`, the global catcher types and occurrence types.

`recordFromError` maps a `NovaError` to its code/category/severity/user message/details. Unknown errors become `INTERNAL.UNKNOWN`, category `internal`, severity `error`, with a bounded message. It does not mean the original arbitrary error object is safe to serialize in full.

`record()` returns null when storage did not produce an occurrence. On success it emits `error.recorded` and can publish bounded metadata to the optional Cross-Host index. Index publishing is best-effort; storage is the canonical occurrence record.

## 4. Coalescing

`ErrorCoalesceWindowSec` defaults to 60 seconds; invalid/less-than-one values fall back to 60 and the store clamps valid values to a maximum of 3600. The store searches for an occurrence with matching `code` and a `lastSeen` within the window, selects the newest hit and updates count, last-seen time, message/context/severity/category. If there is no hit, it generates a random hex ID and inserts a new record.

Coalescing is a compact occurrence summary, not a lossless event stream. Distinct errors that share a code may be folded into one row within the window. Choose stable, meaningful error codes and don't overuse a single generic code for unrelated failures.

Application IDs are not blindly derived from the Surreal native `id`. The shared record helper removes reserved `id` from CONTENT and stores an application `logicalKey` in addition to the compatible `key` field. A native Surreal `RecordId` object is not automatically a string key.

## 5. Input sanitization

- `code` is truncated to 128 characters.
- `category` is converted to string and truncated to 64 characters.
- `message` is truncated to 512 characters.
- Context is limited to an explicit key allowlist: operational counters/IDs, names, guild/user/plugin/role/device IDs, paths/methods, codes/status/routes, target/actor fields and related bounded metadata.
- Context strings are capped at 256 characters.
- Only string, number, boolean and null survive in persisted context.

Don't put tokens, DB credentials, raw requests or arbitrary object graphs in error messages/context. Sanitization is an allowlist, not a license to include secrets in values.

## 6. Query filters

`ErrorListFilter` supports `code`, `category`, `severity`, `from`, `to` and `limit`. The store orders by descending `lastSeen`; limit defaults to 50 and is clamped to 1–100,000. Time filters use seconds matching stored timestamps. A dashboard/API caller should validate user input and impose a practical upper bound for interactive requests.

## 7. Audit/storage failures

Audit and error storage are deliberately separate. Audit may be configured to fail closed with `AuditFailClosed`; error occurrence `record` currently returns null when its underlying store reports a failure. Callers must check nullable results if persistence is required. Do not turn null into a successful write and do not dereference a nullable result without narrowing it.

When debugging missing-table issues, inspect schema ensure, connection alias, actual namespace/database, and operation ordering. Creating a table in a test without using the application initializer can hide a production bootstrap defect.
