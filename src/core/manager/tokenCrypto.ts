import { createHmac, timingSafeEqual } from 'node:crypto';

export function b64Encode(input: string): string {
    return Buffer.from(input, 'utf-8').toString('base64url');
}

export function b64Decode(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf-8');
}

export function hmacSign(data: string, secret: Buffer): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
}

export function packVersion(globalVersion: number, deviceVersion: number): string {
    return `${globalVersion}:${deviceVersion}`;
}

const SAFE_EQUAL_MIN_PAD = 64;

export function safeEqual(a: string, b: string): boolean {
    const padLen = Math.max(a.length, b.length, SAFE_EQUAL_MIN_PAD);
    const bufA = Buffer.from(a.padEnd(padLen, '\x00'), 'utf-8');
    const bufB = Buffer.from(b.padEnd(padLen, '\x00'), 'utf-8');
    return timingSafeEqual(bufA, bufB) && a.length === b.length;
}

/** Derive per-user signing key from master key material + token version. */
export function signingKey(masterKeyBuf: Buffer, userId: string, tokenVersion: string): Buffer {
    return createHmac('sha256', masterKeyBuf).update(`${userId}:${tokenVersion}`).digest();
}

/** HKDF-style master key buffer from the configured master secret. */
export function deriveMasterKey(masterSecret: string): Buffer {
    return createHmac('sha256', 'token-manager-v2').update(masterSecret).digest();
}

export interface SignedTokenParts {
    readonly body: string;
    readonly signature: string;
    readonly userId: string;
    readonly payloadJson: string;
}

export function assembleToken(userId: string, payloadJson: string, key: Buffer): string {
    const userPart = b64Encode(userId);
    const payloadPart = b64Encode(payloadJson);
    const body = `R${userPart}_${payloadPart}`;
    const signature = hmacSign(body, key);
    return `${body}.${signature}`;
}

export function splitToken(token: string): {
    body: string;
    providedSig: string;
    userPart: string;
    payloadPart: string;
} {
    if (typeof token !== 'string' || !token.startsWith('R')) {
        throw new Error('INVALID_FORMAT:Token must be a string starting with R');
    }
    const dotIdx = token.lastIndexOf('.');
    if (dotIdx === -1) {
        throw new Error('INVALID_FORMAT:Token missing signature separator');
    }
    const body = token.slice(0, dotIdx);
    const providedSig = token.slice(dotIdx + 1);
    if (!providedSig) {
        throw new Error('INVALID_FORMAT:Token has empty signature');
    }
    const underscoreIdx = body.indexOf('_');
    if (underscoreIdx === -1) {
        throw new Error('INVALID_FORMAT:Token missing _ separator');
    }
    return {
        body,
        providedSig,
        userPart: body.slice(1, underscoreIdx),
        payloadPart: body.slice(underscoreIdx + 1),
    };
}
