# Security audit records

## 1. Purpose

The Core audit store records privileged or security-relevant actions in a structured form. It is distinct from ordinary logs, error occurrence reporting and metrics:

- **Audit record:** who performed which action, on which target, with what outcome.
- **Application log:** diagnostic context for operators.
- **Error occurrence:** repeated error identity/count/severity/message/context.
- **Metric:** aggregate counters/timings for operational behavior.

Use audit records for actions that need an attributable history, such as token issue/revocation, permission/role modifications, guild/plugin access gating, admin reloads, cache actions, updater apply and plugin enable/disable.

## 2. Types

Authoritative declarations are in `src/core/audit/types.ts`.

```ts
type AuditActorType = 'user' | 'api_key' | 'system';
type AuditOutcome = 'success' | 'fail';
type AuditSurface = 'discord' | 'http' | 'cli' | 'system' | 'dashboard';
type AuditTargetType = 'user' | 'guild' | 'plugin' | 'role' | 'token_device' | 'config' | 'other';
```

`AuditRecordInput` requires `actorType`, `actorId`, `action`, `target`, and `outcome`. Optional values include `reason`, `meta`, `surface`, `requestId`, `targetRef`, `before`, and `after`.

`AuditRecord` includes generated `id`, actor/action/target fields, outcome, nullable reason, sanitized `meta`, `createdAt` in Unix seconds, nullable surface and request ID, nullable target ref, and nullable sanitized before/after fields.

The `AuditActionCode` union includes common actions such as `token.issue`, `token.refresh`, `token.revoke_device`, `token.revoke_all`, permission-bit and role changes, guild/plugin blocking/unblocking, config/lang/emoji reloads, cache pop, updater apply and plugin enable/disable. The `action` field accepts a string as well, so the union is not a runtime allowlist by itself.

## 3. Write API and result behavior

`src/core/audit/index.ts` exports:

- `record(input): Promise<AuditRecord | null>`
- `list(filter?): Promise<AuditRecord[]>`
- `getById(id): Promise<AuditRecord | null>`
- types and sanitizers (`sanitizeAuditFields`, `sanitizeAuditMeta`)

The store creates a random 16-byte hex application ID, timestamps the entry in seconds, sanitizes input fields, ensures the `audit_entries` Surreal table with `DEFINE TABLE IF NOT EXISTS ... SCHEMALESS`, and persists through the shared Surreal record helper. The store uses the `main` alias in the current implementation. The alias is not the Surreal namespace/database name.

After a successful write, Core emits `audit.recorded`. In Cross-Host worker-index mode, it can publish bounded metadata to the optional shared audit index. Index publishing errors are best-effort and do not roll back the already persisted audit record.

On storage failure, `record()` logs the action/actor/target context. With `AuditFailClosed=false` (default), it returns `null`; with `AuditFailClosed=true`, it rethrows the write failure. Sensitive actions should make an explicit decision about whether a missing audit record is allowed to coexist with the business operation.

## 4. Filters and retention implications

`AuditListFilter` supports `actorId`, `actorType`, `action`, `outcome`, `surface`, `requestId`, `from`, `to`, and `limit`. Results are ordered by descending `createdAt`. The store clamps the limit to a minimum of 1 and maximum of 100,000, defaulting to 50 when the value is not a finite number.

This is query pagination by limit rather than a guaranteed cursor-based stream. For a high-volume audit archive, add a deliberate paging/index/retention design instead of issuing a 100,000-row request for every report.

## 5. Metadata sanitization

The sanitizer only retains allowed field names such as `count`, `name`, IDs, action/status fields, `requestId`, `path`, `method`, `code`, `version`, `scope`, `outcome`, and selected operational attributes. Keys matching a secret-backstop expression—token, secret, password, authorization, cookie, credential, API key, private/bearer/session terms—are rejected even if they otherwise match the allowlist. Strings are truncated to 256 characters. Only string, number, boolean and null values survive.

`targetRef` accepts a constrained target type, ID and optional label. IDs/labels are bounded when the write input is normalized. `before` and `after` maps are similarly sanitized. Empty sanitized maps become null.

Do not depend on this sanitizer to cleanse secrets hidden inside an arbitrary string. Never pass credentials, raw request bodies, private keys or token values as audit metadata.

## 6. Guidelines for callers

- Record an explicit outcome; don't report a failed action as success merely because a later cleanup step ran.
- Keep `actorId` stable and interpretable without putting secrets in it.
- Use `requestId`/tracking identifiers for correlation, not credentials.
- Prefer typed `targetRef` over an opaque target description when possible, and keep legacy `target` meaning consistent.
- Record a minimal allowlisted before/after summary rather than full entity documents.
- Decide and test the `AuditFailClosed` policy for each operation category.
- Verify the record was actually persisted before telling an operator that an action was audited.
- Avoid using the audit store as a replacement for transaction logs or domain event sourcing.

## 7. Cross-Host index

The optional Cross-Host index stores summary metadata such as kind, application record ID, machine/shard, timestamp, bounded summary, and optional action/surface/severity. It is intended for distributed discovery/query, not as the canonical full record. Read operations that need exact actor/meta/before/after information should fetch the durable audit record from the owning/shared store.
