# Events

## EventBus

Core provides an EventBus used by plugins and services for internal pub/sub. Prefer the public SDK event helpers from an injected bridge when writing third-party plugins.

Typical operations:

- subscribe / unsubscribe
- emit
- generation-scoped cleanup on unload

## Discord events

Discord gateway events are bridged through the client and plugin event loaders (`BaseEvent` patterns). Required intents must be enabled for the events you handle.

## Cross-Host

Not every process role receives every Discord event. Detect Cross-Host availability before assuming a local listener observes all guild traffic. See [CROSS_HOST.md](CROSS_HOST.md).
