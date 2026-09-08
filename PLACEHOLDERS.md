# Zene Placeholders

Human reference for the placeholder system. Plugin authors should also read the **System Prompt - AI - Plugin.md** (authoring contract).

## Expansion order

1. **Environment** — after secrets assimilate into the vault, before vault lock  
2. **Config + lang** — on every load/reload of files under `configuration/`  
3. **Zod + rules** — validation always runs on the **expanded** object  

Every reload re-reads **raw** disk content, expands from scratch, then validates. Expanded values are never carried across reloads.

## Forms

| Form | Meaning | Disk |
|------|---------|------|
| `${env:KEY}` / `${secret:KEY}` | Required vault/env value | Placeholder stays on disk |
| `${env:KEY?}` / `${secret:KEY?}` | Optional; soft-miss → field **absent** | Placeholder stays on disk |
| `${rand:hex:32}` (untagged) | One-time random; **persisted once** under global `configuration/` only | Rewritten to concrete value on first expand |
| `${rand:hex:32#tag}` (tagged) | Once per process; **stable across reloads**; re-roll only on process restart (per-process, not fleet-shared) | Placeholder stays |
| `${rand:hex:32@shared}` / `${rand:hex:32@shared:name}` | Generated once per **fleet boot** by primary/standalone; same value on every shard | Placeholder stays; value in env (`ZENE_BOOT_SHARED_RAND`) |
| `${rand:base64:N}` / `#tag` / `@shared` | Same rules as hex for each mode | Same |
| `%%key%%` | Core `placeholders` map + custom keys | Stays on disk |
| `%%emoji_*%%` | Emoji map | Resolved at **runtime** (lang/middleware), not at config load |

**Rand modes (summary):**

1. **Untagged** — persist-once on disk under global `configuration/` only (never into plugin templates).
2. **`#tag` process-stable** — generate once per process; stable across config/lang/env reloads; re-roll only on process restart; not shared across shards.
3. **`@shared` fleet-shared** — primary generates once at boot, injects into env for all shards; re-rolls only on full fleet restart; treated as secret by redaction.

Untagged rand is **never** written into `src/plugins/*/data/` templates. Shard workers **must not** generate `@shared` locally if the boot blob is missing — hard fail.

## Two registries

| Registry | Contents | Who may see it |
|----------|----------|----------------|
| **RAW** | Placeholders intact | Dashboard/API (`getRaw` / `GET …/config`) |
| **RUNTIME** | Fully expanded (secrets baked in) | In-memory only — plugins via `config.get()`; **never** serialized or logged |

Redacted view: `GET …/config/redacted` — expanded structure with secret-looking fields masked as `***`.

## Fail-closed

In production (`NODE_ENV=production` or unset), unresolved required `${env:}` / `${secret:}` **fails the load**.  
In development, a warning is logged and the token may remain.

Optional `?` forms never fail-closed.

## Related

- [SETUP.md](../SETUP.md) — first-run  
- [System Prompt - AI - Plugin.md](../System%20Prompt%20-%20AI%20-%20Plugin.md) — authoring contract  
- [ENV Reference.md](../ENV%20Reference.md) — environment variables

## SecretManager and process.env

Secrets are stored in `process.env` as the source of truth. The vault no longer encrypts values in memory or scrubs sensitive keys from the environment. Shard children inherit `DiscordToken`, `ZENE_BOOT_SHARED_RAND`, and other keys by normal process inheritance.

Any plugin or dependency can read `process.env.DiscordToken` (and other keys) directly. That is intentional: isolation was traded for a correct sharding flow. Treat third-party plugins as fully trusted with respect to environment access.

## Architecture note (Phase 3)

`expandValue` / `expandProcessEnv` in `src/core/placeholder/index.ts` should remain **pure with respect to input values** (string in → expanded string out). Side effects (writing back to `process.env`, logging) stay at the call edge (`expandProcessEnv`, boot pipeline), not inside recursive expand of nested objects. New placeholder kinds should not call Discord or network APIs during expand.
