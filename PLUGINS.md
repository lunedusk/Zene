# Plugin author guide

This guide explains how to build a plugin that Zene can discover and operate. Its examples use the Core base-class path where supported. The published SDK has a distinct contract; review [SDK reference](SDK_REFERENCE.md) before targeting isolated runtimes.

## 1. Identity and manifest

A Core `PluginManifest` is defined in `src/core/bases/Plugin.ts`. Its visible type includes:

```ts
interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly dependencies?: string[];
  readonly zene_version?: string | string[];
  readonly node_version?: string;
  readonly priority?: number;
  readonly nodeDependencies?: Record<string, string>;
  readonly ignoreHash?: readonly string[];
  readonly emoji?: string;
  readonly icon?: string;
}
```

The signed artifact contains canonicalized authority metadata; the `PluginManifest` interface is a runtime-facing shape, not a guarantee that every field in a raw `manifest.json` is authenticated. Signed `.nvx` artifacts take precedence, and a present-but-invalid signed artifact must not fall back to an unsigned JSON manifest. See [Integrity and trust](INTEGRITY.md).

Use a stable, unique `id`. The dependency list identifies plugin IDs that must resolve before this plugin. Do not rely on priority to override dependency edges: dependencies load first; priority orders independent roots. Version constraints are checked by discovery/manifest validation.

## 2. Directory layout

The current Core loaders look for JavaScript files in these paths under each plugin directory:

```text
plugins/
└── example-plugin/
    ├── manifest.nvx            # preferred signed artifact, when distributed
    ├── manifest.json           # bypass/legacy path when allowed by trust policy
    ├── index.js                # required entrypoint
    ├── package.json            # optional npm dependencies
    ├── configuration/
    │   └── config.json5        # example; conventions depend on config loader
    ├── lang/
    │   └── en_core.json5       # example; conventions depend on language loader
    └── src/
        ├── commands/**/*.js
        ├── events/**/*.js
        ├── handlers/**/*.js
        ├── middleware/**/*.js  # exact loader path/source contract must be checked
        └── routes/**/*.js
```

The loader searches `.js` files for commands, events and routes, and uses the compiled plugin entrypoint at `index.js`. Write TypeScript during development if your build emits the expected JavaScript layout. Do not assume Core imports `.ts` files directly in production.

Loader-recognized surfaces are not all equivalent. A plugin can supply a `BasePlugin` entrypoint and separate command/event/handler/middleware/route classes. Some surfaces are only loaded by the in-process hook path; isolated runtime registrations use host messages and SDK bridge bindings.

## 3. Minimal `BasePlugin`

```js
import { BasePlugin } from '@your-build-path/zene-core'; // resolve the actual import supported by your plugin build

export default class ExamplePlugin extends BasePlugin {
  manifest = {
    id: 'example-plugin',
    name: 'Example Plugin',
    version: '1.0.0',
    description: 'A minimal example',
  };

  async onSetup() {
    // Register long-lived services/resources that should exist during setup.
    // Core has injected `heart` before this hook runs.
  }

  async onEnable() {
    this.log.info('Example plugin enabled');
  }

  async onDisable() {
    // Release custom resources if they are not already owned by the lifecycle registry.
  }
}
```

The import in the example is intentionally descriptive, not a hard-coded package export guarantee. The repository's Core source aliases target its own generated layout; public third-party imports should be chosen from the actual SDK package or packaging contract.

`BasePlugin` has a protected `heart` getter that throws before Core injection. `_injectCore` is a one-time loader hook and rejects a second injection. `state` and `isEnabled` reflect the base instance state. `onSetup` and `onDisable` have defaults; `onEnable` is required by the abstract class.

## 4. Commands

`BaseCommand` is constructed with `IHeart`, exposes `data` (normally a `SlashCommandBuilder`) and `config`, and requires `execute(ChatInputCommandInteraction): Promise<void>`. The loader:

1. recursively finds `.js` files in `src/commands`;
2. imports the module and expects its default export to extend `BaseCommand`;
3. constructs an instance with the current Heart;
4. validates `data.name`, applies command permission defaults;
5. registers command data, execution and optional autocomplete;
6. runs the command middleware pipeline and the optional `onBeforeExecute` hook;
7. calls `execute`, then `onAfterExecute` if execution succeeds; thrown errors are passed to `onError`.

A command `config` can include `cooldown`, `devOnly`, `permissionLevel`, `roleIds`, `userIds`, Discord user/client permission arrays, `allowInDm`, `denyMessage`, `autoDefer` (`boolean | 'ephemeral'`) and requirements. Review the full `CommandConfig` and command registration logic before relying on a setting for security.

Example:

```js
import { SlashCommandBuilder } from 'discord.js';
import { BaseCommand } from '...';

export default class PingCommand extends BaseCommand {
  data = new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot can respond');

  config = { autoDefer: false };

  async execute(interaction) {
    await interaction.reply({ content: 'Pong!', ephemeral: true });
  }
}
```

`onError` attempts to load the Core user-facing error message and falls back to a placeholder-based message. If overriding it, log the error safely and respond without leaking internal stack traces or secrets.

## 5. Events

A `BaseEvent<TArgs>` exposes `name`, `once`, optional requirements and access metadata (`permissionLevel`, role/user allow lists, user/client Discord permissions, `allowInDm`, `denyMessage`), plus optional maps for button, modal and select-menu handlers. The `execute(...args)` method is required. The event loader evaluates requirements, registers component interaction handlers, and hooks the named event into `heart.system.events`.

Example:

```js
import { BaseEvent } from '...';

export default class ReadyEvent extends BaseEvent {
  name = 'system.ready';
  once = true;

  async execute(client) {
    this.heart.log.info(`Ready as ${client.user.tag}`);
  }
}
```

Use exact event names from [Events](EVENTS.md). `system.ready` is not a generic promise that all application-level work is finished; it represents the event emitted by the framework when its ready condition is reached. Review actual boot order if your event depends on a subsystem.

The base event class's `once` behavior is implemented by the loader. Note that the current event loader's one-shot branch registers `execute` directly, whereas the normal branch wraps the callback with a guild-gate check; do not assume gate handling is identical across both code paths without testing. This detail is worth retaining when auditing security-sensitive event behavior.

## 6. Handlers

`BaseHandler` has public `name`, optional `version`, `description` and requirements; protected getters expose `heart`, `log`, `config`, and `events`. It provides async `onInitialize()` and `onTeardown()` hooks with no-op defaults. The handler registry indexes handlers by plugin ID and name and can list summary/detailed metadata.

Use handlers to encapsulate reusable plugin services rather than using global mutable state. Verify how a handler is discovered, initialized and torn down in `src/core/loader/handler.ts` before depending on timing.

## 7. Routes

`BaseRoute` constructs an Express router with `{ strict: false, mergeParams: true }`, requires `basePath`, and requires a `register()` method. Its protected `asyncHandler()` converts rejected promises into Express `next(error)` flow. Route files must default-export a subclass of `BaseRoute`; `RouteLoader` mounts the router under a path normalized from `basePath`.

Treat routes as externally reachable unless the deployment network and middleware prove otherwise. Apply authentication, authorization, validation, request size/time limits, and safe error responses. The type itself does not make an endpoint authenticated.

## 8. Middleware

The Core `BaseMiddleware` contract has a name, `order` (default 100), phases (default `['command']`), optional registration requirements and an async `run(ctx)` returning `'next' | 'stop'`. `MiddlewareContext` carries `heart`, `pluginId`, `phase`, and optional interaction, route request/response, event payload and metadata. `MiddlewareLoader` and `runMiddlewarePipeline` define the actual phase execution order.

Middleware should be fast, deterministic, and explicit when stopping execution. Do not swallow exceptions unless the policy for that middleware intentionally converts the failure into a denial or skip.

## 9. Requirements and capabilities

`RegisterRequirements` supports:

- deployment mode (`standalone`, `sharded`, `crosshost`) and aliases such as `crossHost`, `crossHostRole`, `isSharded`, `standalone`, `modes`;
- exact environment expectations and truthy environment requirements;
- Node version requirements;
- required plugin IDs and provider categories;
- custom asynchronous `when`, `all`, and `any` predicates.

`mode` controls whether failed requirements skip a component softly or throw in strict mode. Requirements are host-evaluated eligibility metadata, **not a permission grant** and not a cryptographic authorization mechanism.

## 10. Core Heart usage

A plugin may receive the `IHeart` object and use the domains described in [Architecture](ARCHITECTURE.md). Examples include `heart.system.events`, `heart.assets.config`, `heart.assets.lang`, `heart.permissions.hasBit`, `heart.cache.ns`, `heart.registry.registerCommand`, `heart.net.http`, `heart.db.surreal`, and `heart.paginator`. Availability differs by boot stage. Some members expose powerful global managers and should only be used in plugins that the operator trusts.

Prefer higher-level Core/SDK operations over direct driver calls where available. Direct database access bypasses the Core data registry's ownership, privacy and schema policy. Direct HTTP/server manager access may bypass route-specific authentication. Access to `heart.assets.secrets` exposes environment configuration that must be handled as sensitive.

## 11. Configuration and language files

Plugin configuration and language loaders synchronize plugin files into the runtime model. Config loading can apply defaults, validation and reload support. Language loading stores translation namespaces and compiles interpolation/placeholder expressions. Consult [Loader](LOADER.md) and [Placeholders](PLACEHOLDERS.md) for merge precedence, validation, fallback and reload details.

Do not store credentials in ordinary plugin configuration. A config reader returning a read-only view is not a substitute for input validation or secret handling.

## 12. Dependencies and build outputs

Plugin `manifest.dependencies` is the plugin dependency graph. `nodeDependencies` and `package.json` dependencies are npm package dependencies. They are not interchangeable. The dependency loader merges declared dependency versions and uses a selected install backend, after authenticated dependency-closure verification. A trusted signed dependency lock may cause the loader to skip network installation at boot.

A plugin that ships compiled JavaScript must ensure all referenced assets, package files and imports exist in the artifact. Include only necessary runtime files; never package `.env`, local database files, signing private keys or build secrets.

## 13. Persistence and privacy

For plugin-owned arbitrary data, prefer the Core data SDK and register a data type with an explicit scope, personal-data flag, privacy classification, retention statement and storage policy. Subject-scoped methods validate required identifiers. Cross-plugin access is limited by owner and privacy classification.

The SDK data bridge exposes `registerType`, `access`, `write`, `export`, and subject-scoped `delete`; the Core registry's whole-user and whole-guild sweeps are Core-authorized privacy operations, not a general plugin deletion privilege. See [Data shapes and privacy](DATA_SHAPES.md).

## 14. Cross-Host plugin messaging

The Core `heart.crossHost` service and SDK `crossHost` domain are not fully identical. Cross-Host availability depends on runtime role and the control plane. The SDK provides `isAvailable`, `machineId`, `peers`, `send`, `request`, `on` and `off`. Message payloads should be explicit, bounded, versionable and validated. Never assume delivery is durable or exactly once unless the protocol implementation guarantees it.

## 15. Lifecycle-safe patterns

- Register event listeners with plugin/runtime ownership when using the SDK.
- Store unsubscribe callbacks and remove listeners when the plugin no longer needs them.
- Use named tasks and cancel them during teardown.
- Avoid untracked intervals/timeouts and open sockets.
- Check a plugin's enabled/teardown state before performing delayed side effects.
- Keep handlers idempotent when they can be invoked by retries or distributed messages.
- Never retain assumptions about a stale runtime generation after reload.
- Ensure commands/routes validate user-supplied data and authorize every privileged effect.

## 16. Testing a plugin

At minimum test import/build, manifest validity, requirement evaluation, command payloads and permission conditions, success/error paths, data ownership, resource cleanup on disable/unload, and behavior when optional services are unavailable. When isolated, also test protocol serialization and bridge registration. See [Testing](TESTING.md).
