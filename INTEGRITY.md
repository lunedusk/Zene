# Integrity

Zene package integrity signs and verifies plugin (and core) file trees so tampered code cannot load unnoticed.

## Canonical signed artifact (Phase 1A)

Plugin packages use the `.nvx` envelope:

```text
NCPLUG magic (6 bytes)
  + Ed25519 signature over FlatBuffer payload
  + FlatBuffer ZeneManifest (canonical metadata + integrity file tree)
```

### Signed canonical metadata

| Field | Role |
|-------|------|
| `id`, `name`, `version` | Identity |
| `description`, `author` | Descriptive |
| `dependencies` | Plugin dependency graph (boot order) |
| `zene_version`, `node_version` | Compatibility gates |
| `node_dependencies` | npm package ranges installed at preload |
| **`priority`** | Boot order among independent plugins (authenticated on new packs) |
| `integrity.files[]` | Path + hash + size for every included file |
| `integrity.ignore_hash[]` | Paths excluded from hashing (signed) |
| `integrity.algorithm`, `timestamp` | Hash algorithm + pack time |

**`priority` (Phase 1A):** New packs always write `priority` into the signed FlatBuffer (including `0`). Values are **integers** (pack, packer, and bypass parsers **reject** non-integers; they do not silently truncate) (all first-party manifests use whole numbers; FlatBuffer field is `int`; pack truncates finite numbers to int). Fractional priorities are not part of the public contract. `PackageManager.unpackAndVerify` returns `priority` only when the table carries the field (`hasPriority()`). Legacy `.nvx` artifacts packed before Phase 1A lack the field; discovery treats priority as undefined and sorts with `?? 0` **without claiming the value was signed**. Repack all first-party plugins after upgrading.

Display-only fields `emoji` / `icon` may appear on `manifest.json` and the class manifest; they are **not** part of the signed FlatBuffer in Phase 1A.

### Source of truth for boot order

```text
signed .nvx → unpackAndVerify → DiscoveredPlugin.manifest.priority
  → sortDependencies (deps topo + ascending priority)
```

The plugin class’s `readonly manifest` is **not** the authority for discovery sort. Unsigned bypass uses `manifest.json` only when verification fails/missing and the operator allows uncertified plugins.

## What is hashed

`IntegrityScanner.discoverFiles` walks a package root and records SHA hashes for every included file.

**Excluded directory names** (entire subtree skipped): `.git`, `node_modules`, `.data`, `logs`, `configuration`.

**Phase 1A — `dist` directories are included.** Plugin root `dist/`, nested `dist/`, and dashboard-style `dist/` trees are walked. Files under those trees still obey the normal file exclusions (so `dist/.env`, `dist/*.map`, `dist/*.tmp`, etc. are **not** hashed). Pack and verify use the **same** scanner policy.

**Still excluded by extension or basename:** `.log`, `.tmp`, `.map`, `.env`, `.bin`, `.nc` (basename match covers Node's `path.extname('.env') === ''` case).

Files whose names start with `manifest` (e.g. `manifest.json`, `manifest.nvx`) are not self-hashed.

Under any path segment named `data`, **only** these subtrees are included:

| Path | Why |
|------|-----|
| `data/schema/**` | Schemas dynamically imported for config/lang validation |
| `data/rules/**` | Validation rule modules dynamically imported the same way |

Everything else under `data/` is **not** hashed so normal runtime mutation does not fail verify.

`ignoreHash` / `ignore_hash` paths listed in the signed integrity payload are skipped during pack and verify.

## Import guard

`src/core/validation/resolve.ts` calls `assertDataCodePath` before any dynamic `import()` of a module path that contains `/data/`. Paths that are not under `/data/schema/` or `/data/rules/` throw; the failure is not swallowed by the import error handler.

## Pack and verify

- `PackageManager.pack` / `unpackAndVerify` (`manifest.nvx`) use the same scanner.
- `IntegrityManager.generate` / `verify` (`manifest.bin`) likewise.
- After changing schema, rules, **or any `dist` asset**, **repack** signed plugins so manifests include the new hashes.
- Symlinks are ignored (warned) and never hashed.

## Unsigned / bypass risk

If a plugin has no valid `manifest.nvx` verification and unsigned loading is allowed (whitelist / `allowUncertified`), files are loaded from `manifest.json` **without** cryptographic guarantees. Bypass may supply `priority` and `ignoreHash` from JSON; those values are **not** authenticated. Production should keep unsigned plugins disabled.

Signed metadata is never overridden by a concurrent `manifest.json` when verification succeeds.

## Legacy artifacts

| Artifact | Behavior |
|----------|----------|
| New `.nvx` (with priority field) | Full Phase 1A contract; priority authenticated |
| Legacy `.nvx` (no priority field) | Signature still verified; file tree still checked; priority treated as unspecified (`?? 0` at sort) |
| Failed signature / tampering | Rejected (or bypass only if operator allows) |

## Related code

- `src/core/helpers/integrity/scanner.ts`
- `src/core/helpers/integrity/manifest.ts`
- `src/core/helpers/integrity/manager.ts`
- `src/core/flatbuffer/manifest.fbs`
- `src/core/validation/resolve.ts`
- `src/core/loader/integrityGate.ts`
- `src/core/loader/discovery.ts`
- `src/scripts/manifestPacker.ts`

## Operational note

After upgrading to Phase 1A, run the packer for every first-party plugin before shipping signed releases. Existing on-disk `.nvx` without `priority` remain loadable as legacy until repacked.


## Canonical metadata layer (Phase 1B)

**CURRENT / IMPLEMENTED**

Signed and bypass plugin metadata are normalized through `src/core/helpers/integrity/canonicalMetadata.ts` before packing and after verification:

```text
raw PluginManifest / JSON
    → canonicalPluginMetadata (authority + normalized fields)
    → FlatBuffer + signature  (pack)
verified FlatBuffer
    → canonicalPluginMetadata
    → PluginManifest runtime projection  (unpack / signedMetadata / gate)
```

Authority values:

| Authority | Meaning |
|-----------|---------|
| `signed` | New `.nvx` with authenticated priority field |
| `legacy-signed` | Signature OK; priority field absent (pre–Phase 1A) |
| `bypass-unsigned` | Operator allow-list / allowUncertified JSON path |

Deterministic normalization: sorted dependencies, sorted `nodeDependencies` keys, sorted `ignoreHash` paths, integer priority enforcement.

**NOT YET** (later phases): hierarchical trust, provider metadata in the signed set, dashboard surface signing, external SDK package.

Emoji/icon remain **runtime-only** and are not part of the canonical signed set.
