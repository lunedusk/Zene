# `@lunedusk/zene-sdk`

The public, typed plugin SDK for Zene. It defines a framework-neutral contract that Core can satisfy through a host-installed, generation-scoped bridge. It deliberately does not import Core's private source modules or create a global mutable bridge registry.

The published package targets Node.js `>=20`. Its main entrypoint is framework-neutral; Discord-specific type helpers and command contracts are available from the `@lunedusk/zene-sdk/discord` subpath. `discord.js` is an optional peer dependency for consumers that use that Discord-specific entrypoint.

## Install and import

For an external project, install the version compatible with the Zene Core/runtime that will host the plugin:

```bash
npm install @lunedusk/zene-sdk
```

Import the main entrypoint for the platform-neutral contract:

```ts
import {
  SDK_VERSION,
  getSdkCompatibilityInfo,
  createPluginSdk,
  type PluginIdentity,
} from '@lunedusk/zene-sdk';
```

Discord-specific contracts can be imported without adding Discord-specific dependencies to the framework-neutral SDK entrypoint:

```ts
import type { SdkDiscordRootCommand } from '@lunedusk/zene-sdk/discord';
```

The concrete exports of the `./discord` subpath are defined in `src/discord/index.ts`; check those definitions for the deployed SDK version.

## Runtime requirement: host bridge

The SDK package is a **contract and client surface**, not a standalone permission system or a plugin host. `createPluginSdk(identity, bridge)` takes the host-provided `SdkBridge` explicitly. The published package does not expose a global bridge lookup; how the host obtains and passes that bridge is a host/runtime integration concern. A plugin cannot gain authority merely by constructing a `PluginIdentity`, declaring capabilities, or importing SDK functions. The Core runtime is responsible for installing the bridge with the correct plugin ID, runtime ID, generation, trust outcome, and authorized status.

Consequences:

- Importing the package outside an authorized Zene plugin runtime does not create a working host bridge by itself.
- The plugin identity ID must match the host bridge session's plugin ID.
- Runtime/generation mismatches are errors, not a reason to reuse stale registrations.
- A signed or declared capability requirement is metadata for host policy; it is not proof that the host granted the capability.
- Resources and registrations must be released when the plugin runtime generation is disabled or unloaded.

## Available contract families

The root entrypoint exports SDK version/compatibility helpers, identity and session types, `SdkError`, the host-provided `SdkBridge` interfaces, `PluginSdk` / `createPluginSdk`, typed data operations, dashboard contributions, and Cross-Host helpers. Other bridge domains include logging, config, events, providers, resources, HTTP routers, commands, scheduling, cooldowns, permissions, features, locale, emoji, cache, diagnostics, and guild-name resolution.

The canonical detailed reference lives in the repository root at [`SDK_REFERENCE.md`](../../SDK_REFERENCE.md). It documents the contracts and calls out limitations of the bridge. For Core's distinct trusted plugin surface, read [`CORE_API_REFERENCE.md`](../../CORE_API_REFERENCE.md) and [the plugin author guide](../../PLUGINS.md).

## Compatibility

Use `getSdkCompatibilityInfo()` and `isSdkContractCompatible()` rather than hardcoding assumptions about a future version. `SDK_VERSION`, `SDK_COMPAT_RANGE`, and `SDK_CONTRACT_VERSION` are exported version contract values; their exact type aliases and compatibility algorithm are defined in `src/version.ts`.

The root package and SDK package have independent version numbers. A compatible SDK semver alone does not guarantee that a specific Zene host enables every SDK operation: host bridge support, runtime policy, trust state, and feature configuration still apply.

## Development inside the Zene repository

The monorepo uses a local package dependency. Build the package from its directory when changing the SDK:

```bash
npm run build --prefix packages/zene-sdk
```

The package's own `rebuild` and `pack:artifact` scripts clean/rebuild the distribution before packaging. Use the root repository's relevant build and tests as well when changing the Core host adapter or runtime bridge. Do not edit generated `dist` output as the source of truth.

## License

The package metadata declares `PolyForm-Noncommercial-1.0.0`; check the included license and current package metadata before redistribution or commercial use.
