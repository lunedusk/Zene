# Errors

Zene distinguishes framework error reporting, persisted error occurrences, and user-facing localized errors.

## Persistence

Error occurrences are stored through Core (`src/core/errors/store.ts`) when the Surreal `main` backend is available. Logical occurrence ids are application keys; CONTENT does not use a conflicting Surreal reserved `id` field.

Coalescing updates can increment counts for matching codes inside a time window.

## Public error boundary

Storage and data-platform failures surface stable codes such as `DATA_PERSISTENCE_FAILURE` without raw driver messages, connection strings, or payload dumps. Internal logs should carry safe operation names and error class names only.

## API and localization

User-facing command errors should use language keys and established error helpers rather than leaking stack traces to Discord channels.
