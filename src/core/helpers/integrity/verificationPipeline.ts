/**
 * Phase 2E — Explicit verification → trust → execution authorization pipeline.
 * These stages MUST NOT be conflated.
 */

import type { MetadataAuthority } from './canonicalMetadata.js';
import { deriveSignerFingerprint } from './signedPayload.js';

/** Stage A — cryptographic / structural verification of the artifact. */
export type VerificationStatus =
    | 'valid'
    | 'invalid'
    | 'malformed'
    | 'legacy';

export interface VerificationResult {
    readonly status: VerificationStatus;
    readonly message: string;
    /** Present only when signature material verified against a key. */
    readonly verifiedPublicKeyPem?: string;
    readonly signerFingerprint?: string;
    readonly authority?: MetadataAuthority;
    readonly treeRootDigest?: string;
}

/** Stage B — trust decision (policy over verified identity). */
export type TrustOutcome =
    | 'trusted'
    | 'bypassed'
    | 'rejected'
    | 'unknown-signer';

export interface TrustResult {
    readonly outcome: TrustOutcome;
    readonly verificationStatus: VerificationStatus;
    readonly signerFingerprint?: string;
    readonly message: string;
}

/** Stage C — may this artifact execute under current operator policy? */
export type ExecutionAuthorization = 'allowed' | 'denied';

export interface AuthorizationResult {
    readonly authorization: ExecutionAuthorization;
    readonly trust: TrustResult;
    readonly message: string;
}

export function verificationValid(input: {
    publicKeyPem: string;
    treeRootDigest: string;
    authority: MetadataAuthority;
}): VerificationResult {
    return {
        status: 'valid',
        message: 'Signature and integrity tree verified.',
        verifiedPublicKeyPem: input.publicKeyPem,
        signerFingerprint: deriveSignerFingerprint(input.publicKeyPem),
        authority: input.authority,
        treeRootDigest: input.treeRootDigest,
    };
}

export function verificationLegacy(input: {
    publicKeyPem: string;
    treeRootDigest: string;
}): VerificationResult {
    return {
        status: 'legacy',
        message: 'Legacy signed artifact (pre–schema v2).',
        verifiedPublicKeyPem: input.publicKeyPem,
        signerFingerprint: deriveSignerFingerprint(input.publicKeyPem),
        authority: 'legacy-signed',
        treeRootDigest: input.treeRootDigest,
    };
}

export function verificationInvalid(message: string): VerificationResult {
    return { status: 'invalid', message };
}

export function verificationMalformed(message: string): VerificationResult {
    return { status: 'malformed', message };
}

/**
 * Trust policy: known signer + valid/legacy verification → trusted.
 * Bypass is NEVER "trusted".
 */
/**
 * Pipeline trust evaluator. Signed/invalid verification NEVER becomes bypassed.
 * Authoritative path for production loaders is trustDecision.evaluateTrust;
 * this function remains for staged verification→trust composition only.
 */
export function evaluatePipelineTrust(input: {
    verification: VerificationResult;
    knownSignerFingerprints: ReadonlySet<string>;
    bypassEnabled: boolean;
}): TrustResult {
    const v = input.verification;
    // CRITICAL: invalid/malformed signed verification cannot be bypassed
    if (v.status === 'malformed' || v.status === 'invalid') {
        return {
            outcome: 'rejected',
            verificationStatus: v.status,
            message:
                v.message +
                ' (signed/verification failure is never bypassed)',
        };
    }

    if (v.status === 'valid' || v.status === 'legacy') {
        const fp = v.signerFingerprint;
        if (!fp || !input.knownSignerFingerprints.has(fp)) {
            if (input.bypassEnabled) {
                return {
                    outcome: 'bypassed',
                    verificationStatus: v.status,
                    signerFingerprint: fp,
                    message: 'Unknown signer; bypass enabled.',
                };
            }
            return {
                outcome: 'unknown-signer',
                verificationStatus: v.status,
                signerFingerprint: fp,
                message: 'Signer fingerprint not in trusted key set.',
            };
        }
        return {
            outcome: 'trusted',
            verificationStatus: v.status,
            signerFingerprint: fp,
            message:
                v.status === 'legacy'
                    ? 'Trusted legacy signed artifact.'
                    : 'Trusted signed artifact.',
        };
    }

    return {
        outcome: 'rejected',
        verificationStatus: v.status,
        message: 'Unhandled verification status.',
    };
}

/**
 * Execution authorization. Bypassed ≠ trusted.
 * Untrusted/bypassed get restricted profile (caller enforces capability denial).
 */
export function evaluateExecutionAuthorization(input: {
    trust: TrustResult;
    allowBypassedExecution: boolean;
}): AuthorizationResult {
    if (input.trust.outcome === 'trusted') {
        return {
            authorization: 'allowed',
            trust: input.trust,
            message: 'Trusted plugin authorized to execute.',
        };
    }
    if (input.trust.outcome === 'bypassed' && input.allowBypassedExecution) {
        return {
            authorization: 'allowed',
            trust: input.trust,
            message:
                'Bypassed (NOT trusted) plugin authorized under restricted profile.',
        };
    }
    return {
        authorization: 'denied',
        trust: input.trust,
        message: `Execution denied: trust=${input.trust.outcome}`,
    };
}


/** @deprecated Use evaluatePipelineTrust — never bypasses verification failures. */
export function evaluateTrust(
    input: Parameters<typeof evaluatePipelineTrust>[0],
): TrustResult {
    return evaluatePipelineTrust(input);
}
