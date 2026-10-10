# Cache

Zene exposes caching through Core managers and helpers. Cache behavior depends on the resolved backend (in-process and/or Redis when configured).

## Layers

- **Process-local caches** — live only in the current Node process; not shared across Cross-Host workers
- **Shared backends** — Redis (or other configured shared stores) when an alias is connected

Always namespace keys by plugin and feature. Do not assume another worker can see process-local entries.

## Backend resolution

Cache backends follow database alias configuration. See [Database.md](Database.md) and [ENV Reference.md](ENV%20Reference.md) for alias setup.

## Operational guidance

- Set TTLs appropriate to the data sensitivity
- Invalidate on permission, config, and membership changes that affect authorization
- Treat cache as advisory unless a subsystem documents stronger guarantees
- Rate-limit and admin surfaces that clear caches should require Core authorization
