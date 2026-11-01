




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

/**
 * Choose a preview signing secret.
 * Prefer DASH_PREVIEW_SECRET only when it is a non-empty string of length >= 16;
 * otherwise fall back to BETTER_AUTH_SECRET under the same rule.
 * Empty/short primary values must not block fallback.
 */
export function selectPreviewSecret(
    dashPreviewSecret: string | undefined,
    betterAuthSecret: string | undefined,
): string | null {
    if (typeof dashPreviewSecret === 'string' && dashPreviewSecret.length >= 16) {
        return dashPreviewSecret;
    }
    if (typeof betterAuthSecret === 'string' && betterAuthSecret.length >= 16) {
        return betterAuthSecret;
    }
    return null;
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


/** Subset of override fields required for preview authorization policy. */
export interface PreviewRecordIdentity {
    readonly overrideId: string;
    readonly targetKind: string;
    readonly targetKey: string;
    readonly previewTokenHash?: string;
    readonly previewExpiresAt?: number;
}

export type PreviewAuthorizationFailure =
    | 'malformed_token'
    | 'bad_signature'
    | 'expired_token'
    | 'missing_record'
    | 'identity_mismatch'
    | 'revoked'
    | 'missing_stored_expiry'
    | 'expired_session';

export type PreviewAuthorizationResult =
    | { ok: true; claims: PreviewClaims; endsAtMs: number }
    | { ok: false; reason: PreviewAuthorizationFailure };

/**
 * Pure authorization policy shared by anonymous and authenticated preview paths.
 * Production resolveActivePreview delegates here so tests can exercise the same rules.
 */
export function evaluatePreviewAuthorization(input: {
    tokenValidation: PreviewValidation;
    record: PreviewRecordIdentity | null;
    tokenHash: string;
    nowMs?: number;
}): PreviewAuthorizationResult {
    const nowMs = input.nowMs ?? Date.now();
    if (!input.tokenValidation.ok) {
        if (input.tokenValidation.reason === 'expired') return { ok: false, reason: 'expired_token' };
        if (input.tokenValidation.reason === 'bad_signature') return { ok: false, reason: 'bad_signature' };
        return { ok: false, reason: 'malformed_token' };
    }
    const claims = input.tokenValidation.claims;
    if (
        typeof claims.overrideId !== 'string' ||
        !claims.overrideId ||
        typeof claims.targetKind !== 'string' ||
        !claims.targetKind ||
        typeof claims.targetKey !== 'string' ||
        !claims.targetKey ||
        typeof claims.exp !== 'number'
    ) {
        return { ok: false, reason: 'malformed_token' };
    }

    const rec = input.record;
    if (!rec) return { ok: false, reason: 'missing_record' };

    if (
        rec.overrideId !== claims.overrideId ||
        rec.targetKind !== claims.targetKind ||
        rec.targetKey !== claims.targetKey
    ) {
        return { ok: false, reason: 'identity_mismatch' };
    }

    if (typeof rec.previewTokenHash !== 'string' || !rec.previewTokenHash) {
        return { ok: false, reason: 'revoked' };
    }
    if (rec.previewTokenHash !== input.tokenHash) {
        return { ok: false, reason: 'revoked' };
    }

    if (typeof rec.previewExpiresAt !== 'number' || !Number.isFinite(rec.previewExpiresAt)) {
        return { ok: false, reason: 'missing_stored_expiry' };
    }

    const signedEndsAtMs = claims.exp * 1000;
    const endsAtMs = Math.min(signedEndsAtMs, rec.previewExpiresAt);
    if (nowMs >= endsAtMs) {
        return { ok: false, reason: 'expired_session' };
    }

    return { ok: true, claims, endsAtMs };
}
