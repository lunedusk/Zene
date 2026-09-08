# Audit Registry

Append-only action log for privileged operations. Persisted on SurrealDB (heart.db.surreal.get('main'), table audit_entries). Under Cross-Host this must be a remote Surreal endpoint shared across workers.

## Record shape (V2 / core migration version 4)

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Opaque hex id |
| `actorType` | `user` \| `api_key` \| `system` | |
| `actorId` | string | Discord id, key label, or `system` |
| `action` | string | e.g. `token.issue`, `perm.role.create` |
| `target` | string | Legacy flat target string (compat) |
| `outcome` | `success` \| `fail` | |
| `reason` | string \| null | |
| `meta` | object | **Allowlisted** scalar fields only |
| `createdAt` | number | Unix seconds |
| `surface` | `discord` \| `http` \| `cli` \| `system` \| `dashboard` \| null | Optional source surface |
| `requestId` | string \| null | Correlation / request id |
| `targetRef` | `{ type, id, label? }` \| null | Structured target |
| `before` | object \| null | Secret-safe field snapshot |
| `after` | object \| null | Secret-safe field snapshot |

### Secret-safe `meta` / `before` / `after`

Sanitization is **allowlist-primary** (`src/core/audit/redact.ts`):

1. Only keys on the explicit allowlist are kept.
2. Values must be `string` (max 256 chars), `number`, `boolean`, or `null`.
3. Unknown keys are **dropped by default** (not stored).
4. A secret-name **denylist** regex is a **backstop only** (e.g. keys matching `token`, `secret`, `password`, `authorization`, `cookie`, …).

It is impossible to log an arbitrary secret-bearing field by passing it in `meta` / `before` / `after` without first adding that key to the allowlist in code review.

## Storage

- Table / collection: `audit_entries` on Surreal `main` (record id = opaque hex `id`).
- Legacy SQL/mongo migrations for `audit_entries` remain for historical installs but are no longer the runtime path.
- Error coalescing store: Surreal table `error_occurrences` (same `main` alias).

Forward-only; existing rows remain valid with null V2 fields.

## Emission

Wired at action sites (token issue/refresh/revoke, permission bits/roles, gates, admin reload/cache-pop, updater apply). Non-blocking: failed writes log and continue (`AuditFailClosed` default false).

Event bus: typed `audit.recorded`.

## Read surface

| Surface | Gate |
|---------|------|
| `GET /api/audit`, `GET /api/audit/:id` | `bot.audit.view` |
| `/admin audit-list`, `audit-get` | Owner admin gate |

Filters may include `surface` and `requestId` where supported by the store list API.

Reading the audit log is not itself audited.

## Related

- [ERRORS.md](ERRORS.md)
- [INTEGRITY.md](INTEGRITY.md)
- [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md)
EOF

## Export

`GET /api/dash/admin/audit/export?format=json|csv` (bit **bot.audit.view**) — rows pass through allowlist redaction (`sanitizeAuditMeta` / `sanitizeAuditFields`) before serialization.