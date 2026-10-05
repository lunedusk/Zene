/**
 * Signed, expiring, non-indexable preview tokens.
 * Preview tokens are NOT dashboard sessions and grant only scoped draft visibility.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export interface PreviewClaims {
    readonly overrideId: string;
    readonly targetKind: string;
    readonly targetKey: string;
    readonly authorUserId: string;
    readonly exp: number;
    readonly iat: number;
    readonly nonce: string;
}

function b64url(buf: Buffer): string {
    return buf.toString('base64url');
}

function fromB64url(s: string): Buffer {
    return Buffer.from(s, 'base64url');
}

export function hashPreviewToken(token: string): string {
    return createHmac('sha256', 'preview-token-hash').update(token).digest('hex');
}

export function mintPreviewToken(secret: string, claims: Omit<PreviewClaims, 'nonce' | 'iat'> & { iat?: number }): {
    token: string;
    claims: PreviewClaims;
    tokenHash: string;
} {
    const full: PreviewClaims = {
        ...claims,
        iat: claims.iat ?? Math.floor(Date.now() / 1000),
        nonce: b64url(randomBytes(16)),
    };
    const payload = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
    const sig = createHmac('sha256', secret).update(payload).digest();
    const token = `${payload}.${b64url(sig)}`;
    return { token, claims: full, tokenHash: hashPreviewToken(token) };
}

export type PreviewValidation =
    | { ok: true; claims: PreviewClaims }
    | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function validatePreviewToken(secret: string, token: string, nowSec: number = Math.floor(Date.now() / 1000)): PreviewValidation {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { ok: false, reason: 'malformed' };
    }
    const [payload, sigB64] = parts;
    const expected = createHmac('sha256', secret).update(payload).digest();
    let actual: Buffer;
    try {
        actual = fromB64url(sigB64);
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return { ok: false, reason: 'bad_signature' };
    }
    let claims: PreviewClaims;
    try {
        claims = JSON.parse(fromB64url(payload).toString('utf8')) as PreviewClaims;
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
        return { ok: false, reason: 'expired' };
    }
    if (typeof claims.overrideId !== 'string' || typeof claims.targetKind !== 'string') {
        return { ok: false, reason: 'malformed' };
    }
    return { ok: true, claims };
}
