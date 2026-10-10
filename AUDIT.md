# Audit records

Zene records security-relevant actions through the Core audit store (`src/core/audit`).

## Record model

Logical fields (application level) include:

| Field | Description |
|-------|-------------|
| `id` | Application audit id (hex string) |
| `actorType` / `actorId` | Who performed the action |
| `action` | Action name |
| `target` | Target summary |
| `outcome` | `success` or `fail` |
| `reason` | Optional reason |
| `meta` | Sanitized metadata map |
| `createdAt` | Unix seconds |
| `surface` | Optional surface tag |
| `requestId` | Optional correlation id |
| `targetRef` | Optional structured target |
| `before` / `after` | Optional field maps |

SurrealDB persistence uses the shared record helpers (`src/core/database/surrealRecord.ts`). The application id is stored as `key` / `logicalKey`. Surreal’s native record `id` is not used as a conflicting CONTENT field.

## Behavior

- Writes are append-style inserts of new logical ids
- Meta and field maps are sanitized before persistence
- List filters support actor, action, outcome, surface, request id, and time bounds
- Reads normalize legacy shapes that still expose string `id` or `key`

## Configuration

Audit storage uses the Core Surreal `main` alias when that backend is available. Database connection details are documented in [Database.md](Database.md).
