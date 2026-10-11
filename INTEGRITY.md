# Artifact integrity and plugin trust

## 1. Two different questions

Integrity verification asks whether the plugin artifact matches the authenticated content and signer rules. Trust/authorization asks whether the resulting artifact is allowed to execute under the current operator policy. Runtime isolation asks where it executes. SDK capabilities determine which host operations the plugin can invoke through controlled bridges. All are separate decisions.

A signature does not prove that code is benign; it establishes artifact authenticity under the selected key. Unsigned/bypassed status is not equivalent to signed/trusted status. Conversely, choosing a stronger runtime does not repair a failed signature or dependency closure.

## 2. Discovery and artifact selection

`src/core/loader/discovery.ts` scans plugin directories and routes each through `resolvePluginIntegrity()` from `src/core/loader/integrityGate.ts`. The gate prefers `manifest.nvx` when present. If a signed artifact exists but verification fails, the loader rejects it and does not fall back to `manifest.json`. An unsigned JSON path is available only when the trust policy allows bypass and the signed-artifact failure rule does not prohibit it.

When a plugin is rejected, authenticated plugin context is cleared to avoid stale trust state. Once a manifest is available, Core evaluates Core/Node version requirements and uses authenticated metadata where available. Duplicate plugin IDs are handled as reject-all conflicts: the loader removes the conflicting discovery entry and marks that ID failed rather than choosing first or last based on directory order.

## 3. Trust outcomes and bypass

The SDK session trust type includes `trusted`, `bypassed`, `legacy`, and `unknown`. The Core pipeline also has richer internal verification/authorization states; do not assume the smaller SDK enum captures every internal reason.

`allowUnCertifiedPlugins` defaults to false. `whitelistedPlugins` is a comma-separated directory/folder-name allowlist in discovery. The public key resolver supports per-plugin keys and a wildcard key from `PluginPublicKeys`, otherwise `PublicKey`, otherwise the built-in public key. `PublicKey` is a public verification key; signing requires private key material and should never use a public key as if it were secret.

Treat turning on the uncertified-plugin option as a security-policy change. Unsigned code may run with the authority of whatever runtime/services it receives. Restrict who can change that setting and who can place files under `plugins/`.

## 4. Authenticated metadata and dependency closure

Signed package metadata can authenticate identity/version, dependencies, Node/Core version constraints, dependency information, runtime requirements, provider declarations and integrity file inventory depending on the artifact profile. Core canonicalizes metadata rather than blindly trusting every raw field in `manifest.json`.

The dependency loader verifies dependency closure before attempting installs. When a trusted authenticated dependency lock is present, Core can skip a network install at boot. Do not claim reproducible build guarantees just from `nodeDependencies`: the dependency loader comments explicitly distinguish authenticated-lock behavior from a complete signed-lock reproducibility contract.

## 5. Key configuration

Relevant inputs include:

- `PublicKey`: default verification key override; public material, not a signing secret.
- `PluginPublicKeys`: JSON object mapping plugin identifiers (or `*`) to public keys.
- `allowUnCertifiedPlugins`: boolean that weakens the default rejection posture when enabled.
- `whitelistedPlugins`: comma-separated plugin directory names accepted by the bypass allowlist path.
- `PrivateKey` and `PLUGIN_SIGNING_KEY`: signing key inputs consulted by manifest packing code; handle as sensitive.

The packer and runtime loader have distinct responsibilities. Rotating a key requires a planned overlap/rollout strategy for artifacts signed by old and new keys. Review `src/core/helpers/integrity/publicKey.ts`, `src/scripts/manifestPacker.ts`, `src/core/helpers/integrity/trustDecision.ts`, `authenticatedContext.ts`, `verificationPipeline.ts`, `dependencyClosure.ts`, `artifactMaterialization.ts`, and `integrityGate.ts` before changing key logic.

## 6. Materialization and TOCTOU considerations

For execution, RuntimeManager materializes authenticated signed files when authenticated file metadata is available. Otherwise it snapshots the directory for execution. That separates the executed artifact from later mutations to the discovery directory, but the trust profile still depends on how the snapshot was accepted.

Keep all path handling rooted, reject traversal, ensure the entrypoint belongs to the authorized inventory, and test malformed digests, missing files and unexpected filesystem entries. Do not bypass materialization to solve a hot-reload bug without re-evaluating the artifact mutation threat.

## 7. Operational checklist

- Keep private signing keys out of `.env` files stored in source control and out of generated plugin bundles.
- Treat plugin installation/update as code deployment.
- Keep public keys and private keys separate.
- Validate the exact artifact you distribute, including entrypoint and runtime dependencies.
- Ensure signer key selection is deterministic and observable without logging secret material.
- Do not accept manifest fallback after a signed artifact failed verification.
- Reject duplicate IDs and dependency cycles/missing dependencies.
- Keep trust bypass explicit and auditable.
- Test behavior on tampered files, malformed manifests, unknown signer, wrong version, bad dependency closure and stale authenticated context.
- Re-check the runtime security boundary independently of the integrity result.
