# Plugin author guide

This guide is for humans building Zene plugins. For AI-assisted work, also see [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md).

## Plugin identity

Each plugin has a stable id, version metadata, and optional dependencies declared in its manifest. Third-party plugins should use the public SDK rather than importing `#core/*`.

## Layout

Follow the loader-sensitive directory conventions used by existing plugins (commands, events, handlers, routes, configuration, language files). Default exports and file placement matter; the loader is path-sensitive.

## Lifecycle

Plugins move through setup/enable/disable/unload paths managed by Core. Register resources through supported APIs so cleanup remains generation-scoped.

## Commands and interactions

Use the framework command bases and builders (discord.js v14). Handle acknowledgement timing, permissions, cooldowns, and localization keys that exist in your language files.

## Events and handlers

Implement `BaseEvent` (or the current event base) with correct listener signatures. Clean up listeners on unload. Null-check dynamic handler lookups.

## HTTP routes

Register routes through Core HTTP registration. Validate params and query strings. Do not expose privileged operations without Core authorization.

## Data and privacy

Use the public data APIs for durable user/guild data. Classify personal data correctly. Do not open raw database clients from third-party plugins.

## Integrity

Production plugins should be packed and verified. Understand trust versus signature verification before relying on bypasses.

## Testing

Use the repository scripts (`npm run slim-build`, targeted `tsx` tests) and isolate durable test data. Never point tests at production databases.
