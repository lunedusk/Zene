# Data shapes

This page points to authoritative TypeScript definitions rather than duplicating the entire type graph.

## Where to look

| Concern | Primary location |
|---------|------------------|
| Plugin manifest | Plugin loader / manifest types under `src/core` |
| Core data records / subjects | `src/core/data/types.ts` |
| Audit records | `src/core/audit/types.ts` |
| Error occurrences | `src/core/errors` types |
| Public SDK contracts | `packages/zene-sdk/src` and `src/sdk` |
| Database config | `src/core/database/index.ts` (`DbConfig`) |
| Surreal connect options | `src/core/database/surreal.ts` (`SurrealConnectOptions`) |

## Core data record

Logical durable records include `typeId`, `key`, `subject`, `value`, `ownerPluginId`, and `updatedAt`. Subjects may include `userId`, `guildId`, and/or `pluginId` depending on scope. Optional subject fields must remain absent when unused (not set to `undefined` in persisted JSON).

## SDK boundary

Public SDK types must not re-export Core manager classes or `#core/*` paths. Prefer the published `@lunedusk/zene-sdk` package for third-party authors.
