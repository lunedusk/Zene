# Placeholder and interpolation reference

## 1. Purpose and implementation areas

Placeholders allow configuration/language strings and environment values to resolve runtime data without hand-copying constants. The primary code is `src/core/placeholder/index.ts`, with shared boot-random behavior in `sharedBootRand.ts`, config/language integration in the loader/managers and source registration for config/emoji data.

The placeholder engine operates on nested plain objects and arrays where supported. It generally preserves non-plain objects instead of recursively rewriting arbitrary class instances. Placeholder expansion can be used in config/language paths and in environment values during boot; exact supported tokens should be checked against the parser functions in the installed revision before being used as an API contract.

## 2. Expansion lifecycle

At boot, the boot pipeline materializes selected defaults, assimilates environment configuration, then expands environment placeholders before locking the secret access path and running shared startup preparation. Config and language loaders expand raw input on load/reload and validate the resulting runtime object. Config/language reloads are separate from arbitrary environment mutation.

The config and language managers maintain raw and runtime representations so reload can re-read raw disk values and expand from the original string rather than expanding already-expanded values again. Untagged random values that need persistence can be recorded and written back into `.env`/`.env.local` by the helper. This can mutate a local config file; protect files and review generated diffs.

## 3. Known token families

The implementation resolves placeholder sources through registered providers, environment/secret access, configuration sources, emoji values and shared random data. It contains support paths for `env`/`secret` lookups, optional/required missing behavior, tagged/shared random values and value encodings such as hex/base64/base64url. Exact accepted syntax and delimiter behavior are parser-defined; do not infer a token grammar from examples alone.

Examples commonly used in repository config/lang contexts include environment-backed values and emoji references such as `%%emoji_cross%%`. Treat these as examples of documented repository conventions, not a promise that every context or every API supports all placeholder kinds.

## 4. Missing values and fail-closed behavior

`ExpandOptions` controls such behaviors as soft misses, required unresolved values, persistence of untagged random values and emoji resolution in the specific caller. In production-like mode the default unresolved-required behavior is more conservative than development. The environment expander performs multiple passes because one value can refer to another value that only resolves in a later pass.

When an unresolved required placeholder is an error, don't hide it by substituting a misleading string. Fix the source key or mark the value intentionally optional if the operation can handle absence safely. A missing secret should not be replaced with a fake secret-like value just to allow boot.

## 5. Environment expansion and persistence

`expandProcessEnv()` scans keys present in `process.env` and SecretManager, expands values that contain recognized placeholder markers, and returns expanded keys plus persisted random replacements. It can write persisted random substitutions to `.env` and `.env.local` if those files exist. Ensure those paths are writable only by the expected operator account and are excluded from version control.

`redactExpandedForApi()` masks values recognized as shared boot random values and strings in keys matching a sensitive-name expression. Treat it as defense in depth; don't return raw environment/config structures over HTTP and rely only on redaction.

## 6. Authoring rules

- Keep literal user-facing language in localization files and avoid embedding secrets in translations.
- Use known placeholder syntax from current source/first-party plugin examples.
- Validate config after expansion, not before only.
- Do not build circular placeholder graphs.
- Keep random-value persistence intentional: persistent values are configuration mutations, not temporary generated values.
- Avoid exposing resolved secret values through dashboards or debug logs.
- Make required versus optional semantics clear to operators.
- Test missing variables, nested objects, arrays, escaped markers, multi-pass references and reload behavior.

## 7. Troubleshooting

If a placeholder remains unresolved, inspect the raw value, exact key casing, whether the source is registered in the active context, whether the loader opted into that placeholder category and whether the value was blank at expansion time. If a value expands once but becomes corrupted on reload, confirm the code starts from raw data rather than already-expanded runtime state. If API redaction leaves a value visible, remove it from the response entirely and extend the redaction tests rather than assuming all secret patterns are known.
