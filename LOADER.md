# Plugin loader

## Discovery and order

The loader discovers plugins from configured roots, validates manifests, applies integrity/trust gates, and orders boot using dependency and priority rules derived from authenticated metadata when available.

## Loading surfaces

For each accepted plugin, Core loads the surfaces declared by the plugin layout, such as:

- commands and interactions
- events
- handlers
- HTTP routes
- configuration and language defaults

## Failure behavior

- Integrity or trust rejection prevents execution
- Invalid configuration or language keys fail according to validation gates
- Dependency cycles and conflicts fail deterministically
- Unload removes active definitions and generation-scoped resources; durable user data is not deleted solely because a plugin unloaded

See [INTEGRITY.md](INTEGRITY.md) and [PLUGINS.md](PLUGINS.md).
