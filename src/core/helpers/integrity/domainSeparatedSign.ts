/**
 * Phase 2E — Explicit domain-separated signing input for v2 canonical payloads.
 *
 * The canonical cryptographic message is NOT the raw FlatBuffer serialization.
 * FlatBuffer is the transport envelope; the signed target is:
 *
 *   ZENE-NCPLUG-V2 || NUL || Ed25519 || NUL || jcs-v{N} || NUL || canonical UTF-8 bytes
 *
 * Legacy artifacts (no signed_payload field) continue to use signature-over-FB.
 */

import { sign, verify, type KeyObject } from 'node:crypto';
import { CANONICALIZATION_VERSION } from './jcs.js';

export const V2_SIGNING_DOMAIN = 'ZENE-NCPLUG-V2' as const;
export const V2_SIGNATURE_ALGORITHM = 'Ed25519' as const;

/**
 * Build the exact byte sequence that Ed25519 signs/verifies for a v2 artifact.
 */
export function buildV2SigningInput(canonicalUtf8Payload: string | Buffer): Buffer {
    const jcs =
        typeof canonicalUtf8Payload === 'string'
            ? Buffer.from(canonicalUtf8Payload, 'utf8')
            : canonicalUtf8Payload;
    const parts = [
        Buffer.from(V2_SIGNING_DOMAIN, 'utf8'),
        Buffer.from([0]),
        Buffer.from(V2_SIGNATURE_ALGORITHM, 'utf8'),
        Buffer.from([0]),
        Buffer.from(`jcs-v${CANONICALIZATION_VERSION}`, 'utf8'),
        Buffer.from([0]),
        jcs,
    ];
    return Buffer.concat(parts);
}

export function signV2CanonicalPayload(
    canonicalUtf8Payload: string,
    privateKey: KeyObject,
): Buffer {
    const input = buildV2SigningInput(canonicalUtf8Payload);
    return sign(null, input, privateKey);
}

export function verifyV2CanonicalPayload(
    canonicalUtf8Payload: string,
    signature: Buffer,
    publicKey: KeyObject,
): boolean {
    const input = buildV2SigningInput(canonicalUtf8Payload);
    return verify(null, input, publicKey, signature);
}
