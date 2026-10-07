import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { PackageManager } from '#core/helpers/integrity/manifest.js';
import {
    canonicalFromBypassJson,
    toPluginManifest,
} from '#core/helpers/integrity/canonicalMetadata.js';
import { evaluateTrust } from '#core/helpers/integrity/trustDecision.js';
import {
    evaluateExecutionAuthorization,
    verificationValid,
    verificationLegacy,
    verificationInvalid,
} from '#core/helpers/integrity/verificationPipeline.js';
import { deriveSignerFingerprint } from '#core/helpers/integrity/signedPayload.js';
import {
    setAuthenticatedPluginContext,
    getAuthenticatedPluginContext,
} from '#core/helpers/integrity/authenticatedContext.js';
import { setAuthenticatedRuntimeFloor } from '#core/runtime/authenticatedPolicy.js';
import { setAuthenticatedProviderDeclarations } from '#core/provider/declarations.js';
import { resolvePluginPublicKeyWithSource } from '#core/helpers/integrity/publicKey.js';
import { SemVer } from '#core/utils/semver.js';
import { NodeVersion } from '#core/utils/nodever.js';
import type { PluginManifest } from '#core/bases/Plugin.js';
import type { IntegrityGateOptions, IntegrityGateResult, IntegrityStatus } from './types.js';

const log = getLogger('IntegrityGate');

/**
 * Bypass / unsigned manifest.json parser.
 * Explicit operator-controlled path only — values are NOT cryptographically authenticated.
 * Must not be used to override a successfully verified signed artifact.
 * Authority fields go through canonicalMetadata; emoji/icon remain runtime-only overlays.
 */
function parseManifestJson(raw: Record<string, unknown>): PluginManifest {
    const canonical = canonicalFromBypassJson(raw);
    const base = toPluginManifest(canonical);
    return {
        ...base,
        emoji: typeof raw.emoji === 'string' ? raw.emoji : undefined,
        icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    };
}

/**
 * Resolve plugin manifest from signed .nvx or unsigned manifest.json bypass.
 * Version gates (zene / node) are applied here so discovery stays free of crypto.
 */
export async function resolvePluginIntegrity(
    pluginDir: string,
    folderName: string,
    options: IntegrityGateOptions,
): Promise<IntegrityGateResult> {
    const nvxPath = path.join(pluginDir, 'manifest.nvx');
    const jsonPath = path.join(pluginDir, 'manifest.json');

    let manifest: PluginManifest | null = null;
    let integrityPassed = false;
    let status: IntegrityStatus = 'failed';

    const { key: publicKey, source: signerKeySource } =
        resolvePluginPublicKeyWithSource(folderName);
    // Prefer gate options resolver when provided (tests / alternate key maps).
    const verifyKey = options.resolvePublicKey
        ? options.resolvePublicKey(folderName)
        : publicKey;

    const hasNvx = await fs
        .access(nvxPath)
        .then(() => true)
        .catch(() => false);

    if (hasNvx) {
        try {
            manifest = await PackageManager.unpackAndVerify(
                pluginDir,
                verifyKey,
                'manifest.nvx',
            );
            integrityPassed = true;
            status = 'signed';
        } catch (verifyError: unknown) {
            const err = verifyError as Error;
            log.warn(`[${folderName}] INTEGRITY FAILURE: ${err.message}`);
            status = 'failed';
            manifest = null;
        }
    }

    const isWhitelisted = options.whitelistedSet.has(folderName);
    const trust = evaluateTrust({
        integrityStatus: status,
        integrityPassed,
        signedArtifactPresent: hasNvx,
        allowUncertified: options.allowUncertified,
        folderWhitelisted: isWhitelisted,
        signerKeySource,
        folderName,
    });

    if (!trust.mayExecute) {
        log.error(`[${folderName}] TRUST REJECTED: ${trust.reason}`);
        return { manifest: null, status: trust.integrityStatus, rejected: true, trust };
    }

    // Phase 2E: signed present + failed must never load manifest.json
    if (!integrityPassed && hasNvx) {
        log.error(`[${folderName}] Signed artifact failed; refusing unsigned fallback.`);
        return {
            manifest: null,
            status: 'failed',
            rejected: true,
            trust,
        };
    }

    if (!integrityPassed) {
        log.warn(`[${folderName}] ${trust.reason}`);

        const jsonRaw = await fs.readFile(jsonPath, 'utf-8').catch(() => {
            throw new Error('Missing manifest.json fallback. Cannot load bypassed plugin.');
        });

        const parsed: unknown = JSON.parse(jsonRaw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Invalid manifest.json: Expected a JSON object.');
        }

        manifest = parseManifestJson(parsed as Record<string, unknown>);
        status = 'bypassed';

        if (!manifest.id || !manifest.name || !manifest.version) {
            throw new Error('Invalid manifest.json: Missing required fields (id, name, version).');
        }
    }

    if (!manifest) {
        return { manifest: null, status, rejected: true, trust };
    }

    // Phase 2E: authorization + context. Prefer v2 payload context from unpackAndVerify.
    {
        const existing = getAuthenticatedPluginContext(manifest.id);
        const fingerprint =
            integrityPassed && typeof verifyKey === 'string'
                ? deriveSignerFingerprint(verifyKey)
                : existing?.signerFingerprint;

        // Map TrustDecision.outcome to authorization trust (untrusted is reserved, never emitted).
        const pipelineTrust: 'trusted' | 'bypassed' | 'rejected' | 'unknown-signer' =
            trust.outcome === 'trusted'
                ? 'trusted'
                : trust.outcome === 'bypassed'
                  ? 'bypassed'
                  : 'rejected';

        const verification = integrityPassed
            ? status === 'signed'
                ? verificationValid({
                      publicKeyPem: typeof verifyKey === 'string' ? verifyKey : 'unknown',
                      treeRootDigest: existing?.integrityRootDigest ?? 'verified-tree',
                      authority: existing?.profile === 'v2-authenticated' ? 'signed' : 'legacy-signed',
                  })
                : verificationLegacy({
                      publicKeyPem: typeof verifyKey === 'string' ? verifyKey : 'unknown',
                      treeRootDigest: 'verified-tree',
                  })
            : verificationInvalid(trust.reason);

        // Bypass only when no signed artifact was present; never after signed failure.
        const allowBypass =
            !hasNvx && (options.allowUncertified || isWhitelisted);

        const auth = evaluateExecutionAuthorization({
            trust: {
                outcome: pipelineTrust,
                verificationStatus: verification.status,
                signerFingerprint: fingerprint,
                message: trust.reason,
            },
            allowBypassedExecution: allowBypass,
        });

        if (auth.authorization !== 'allowed') {
            log.error(`[${folderName}] AUTHORIZATION DENIED: ${auth.message}`);
            return {
                manifest: null,
                status: trust.integrityStatus,
                rejected: true,
                trust,
            };
        }

        if (existing?.profile === 'v2-authenticated' && existing.signedPayload) {
            // Keep authenticated v2 payload as authority; refresh trust/authorization only
            setAuthenticatedPluginContext(manifest.id, {
                ...existing,
                trustOutcome: pipelineTrust,
                authorization: auth.authorization,
                signerFingerprint: fingerprint ?? existing.signerFingerprint,
            });
            if (existing.minimumIsolation) {
                setAuthenticatedRuntimeFloor(manifest.id, {
                    minimumIsolation: existing.minimumIsolation,
                    requiredCapabilities: [...existing.requiredCapabilities],
                });
            }
            setAuthenticatedProviderDeclarations(manifest.id, [...existing.providerDeclarations]);
        } else if (!integrityPassed) {
            setAuthenticatedPluginContext(manifest.id, {
                pluginId: manifest.id,
                profile: 'bypassed-unsigned',
                authority: 'bypass-unsigned',
                trustOutcome: 'bypassed',
                authorization: auth.authorization,
                requiredCapabilities: [],
                providerDeclarations: [],
                dependencyLock: { packageManager: 'none', dependencies: {} },
            });
        } else {
            // Legacy signed (no v2 payload in artifact)
            setAuthenticatedPluginContext(manifest.id, {
                pluginId: manifest.id,
                profile: 'legacy-signed',
                authority: 'legacy-signed',
                signerFingerprint: fingerprint,
                trustOutcome: pipelineTrust,
                authorization: auth.authorization,
                requiredCapabilities: [],
                providerDeclarations: [],
                dependencyLock: {
                    packageManager: 'none',
                    dependencies: { ...(manifest.nodeDependencies ?? {}) },
                },
            });
        }
    }

    if (manifest.zene_version) {
        let zeneOk = false;
        try {
            zeneOk = SemVer.satisfies(options.coreVersion, manifest.zene_version as string | string[]);
        } catch {
            zeneOk = false;
        }
        if (!zeneOk) {
            log.warn(
                `[${manifest.id}] Incompatible Core Version. Plugin requires ${JSON.stringify(manifest.zene_version)}, but core is v${options.coreVersion}. Skipping.`,
            );
            return { manifest, status, rejected: true };
        }
    }

    if (manifest.node_version && !NodeVersion.satisfies(manifest.node_version)) {
        const currentNode = NodeVersion.current().toString();
        log.warn(
            `[${manifest.id}] Incompatible Node.js version. ` +
                `Plugin requires ${manifest.node_version}, but runtime is v${currentNode}. Skipping.`,
        );
        return { manifest, status, rejected: true };
    }

    return { manifest, status, rejected: false, trust };
}
