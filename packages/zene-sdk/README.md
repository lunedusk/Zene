# @lunedusk/zene-sdk

Public typed SDK for Zene plugins.

This package is a **contract and client surface** only. Runtime authority is provided by a Zene Core host through a private adapter that installs a generation-scoped SDK bridge.

Plugins depend on this package — not on Zene Core source paths.

```ts
import { createPluginSdk, SDK_VERSION } from '@lunedusk/zene-sdk';
```

Discord-specific command/interaction types:

```ts
import type { SdkDiscordRootCommand } from '@lunedusk/zene-sdk/discord';
```

See the Zene repository for host integration. Documentation consolidation is tracked separately.
