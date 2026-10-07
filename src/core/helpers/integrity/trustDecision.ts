/**
 * Phase 1C / 2E — Trust decision foundation.
 *
 * Cryptographic validity (signature + integrity tree) is NOT the same as
 * "may execute". This module records an explicit trust outcome after integrity
 * verification, using the existing flat public-key configuration.
 *
 * Phase 2E: a present-but-invalid signed artifact MUST hard-reject.
 * Bypass is only for the absence of a signed artifact under explicit policy.
 */

import type { IntegrityStatus } from '#core/loader/types.js';

/** Where the verifying public key was resolved from. */
export type SignerKeySource =
    | 'plugin-map'
    | 'wildcard'
    | 'global'
    | 'builtin'
    | 'none';

/**
 * Trust outcomes for the loader pipeline.
 * `untrusted` is reserved for future signer-present-but-policy-denied cases
 * (revocation / deny lists). evaluateTrust does not emit it yet.
 */
export type TrustOutcome =
    /** Signature + integrity OK and key accepted under current flat policy. */
    | 'trusted'
    /** Operator-controlled unsigned path (allowUnCertifiedPlugins / whitelist). */
    | 'bypassed'
    /** Integrity failed or missing and no bypass applies — or signed artifact failed. */
    | 'rejected'
    /** Reserved: key present but policy denies (future deny/revocation lists). */
    | 'untrusted';

export interface TrustDecision {
    readonly outcome: TrustOutcome;
    readonly integrityStatus: IntegrityStatus;
    readonly signerKeySource: SignerKeySource;
    readonly reason: string;
    /** True when the loader may proceed to dependency resolution and load. */
    readonly mayExecute: boolean;
    /**
     * True when a signed artifact (.nvx) was present on disk for this plugin folder.
     * When true and integrity failed, bypass is forbidden.
     */
    readonly signedArtifactPresent: boolean;
}

export interface EvaluateTrustInput {
    readonly integrityStatus: IntegrityStatus;
    readonly integrityPassed: boolean;
    /**
     * Whether manifest.nvx existed (regardless of verification outcome).
     * Presence + failure ⇒ hard reject; never bypass.
     */
    readonly signedArtifactPresent: boolean;
    readonly allowUncertified: boolean;
    readonly folderWhitelisted: boolean;
    readonly signerKeySource: SignerKeySource;
    readonly folderName: string;
}

/**
 * Classify key source for diagnostics (does not change which key was used).
 */
export function classifySignerKeySource(
    pluginId: string | undefined,
    pluginKeys: Record<string, string>,
    globalKey: string | undefined,
    builtinKey: string,
    resolvedKey: string,
): SignerKeySource {
    if (pluginId && pluginKeys[pluginId] && pluginKeys[pluginId] === resolvedKey) {
        return 'plugin-map';
    }
    if (pluginKeys['*'] && pluginKeys['*'] === resolvedKey) {
        return 'wildcard';
    }
    if (globalKey && globalKey.trim() === resolvedKey) {
        return 'global';
    }
    if (resolvedKey === builtinKey) {
        return 'builtin';
    }
    return 'none';
}

/**
 * Explicit trust decision after integrity verification attempt.
 *
 * Rules (Phase 2E):
 * 1. integrityPassed + signed status → trusted
 * 2. signedArtifactPresent + !integrityPassed → rejected (NO bypass)
 * 3. !signedArtifactPresent + allowUncertified|whitelist → bypassed
 * 4. otherwise → rejected
 */
export function evaluateTrust(input: EvaluateTrustInput): TrustDecision {
    if (input.integrityPassed && input.integrityStatus === 'signed') {
        return {
            outcome: 'trusted',
            integrityStatus: 'signed',
            signerKeySource: input.signerKeySource,
            reason: `Signed artifact verified; signer key source=${input.signerKeySource}.`,
            mayExecute: true,
            signedArtifactPresent: true,
        };
    }

    // CRITICAL: present-but-invalid signed artifact never falls back to bypass
    if (input.signedArtifactPresent && !input.integrityPassed) {
        return {
            outcome: 'rejected',
            integrityStatus: 'failed',
            signerKeySource: input.signerKeySource,
            reason:
                `Signed artifact present but verification failed for '${input.folderName}'. ` +
                `Bypass/whitelist cannot downgrade a failed signed package to unsigned execution.`,
            mayExecute: false,
            signedArtifactPresent: true,
        };
    }

    if (input.allowUncertified || input.folderWhitelisted) {
        const why = input.folderWhitelisted
            ? `folder '${input.folderName}' is on whitelistedPlugins`
            : 'allowUnCertifiedPlugins is enabled';
        return {
            outcome: 'bypassed',
            integrityStatus: 'bypassed',
            signerKeySource: input.signerKeySource,
            reason: `BYPASS: ${why}. No signed artifact; metadata is not cryptographically authenticated.`,
            mayExecute: true,
            signedArtifactPresent: false,
        };
    }

    return {
        outcome: 'rejected',
        integrityStatus: 'failed',
        signerKeySource: input.signerKeySource,
        reason: 'No signed artifact and bypass is not enabled.',
        mayExecute: false,
        signedArtifactPresent: false,
    };
}
