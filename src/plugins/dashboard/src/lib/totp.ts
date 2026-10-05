




import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
    const buf = randomBytes(bytes);
    return base32Encode(buf);
}

export function base32Encode(buf: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
}

export function base32Decode(input: string): Buffer {
    const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of cleaned) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx < 0) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter & 0xffffffff, 4);
    const hmac = createHmac('sha1', secret).update(buf).digest();
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const code =
        ((hmac[offset]! & 0x7f) << 24) |
        ((hmac[offset + 1]! & 0xff) << 16) |
        ((hmac[offset + 2]! & 0xff) << 8) |
        (hmac[offset + 3]! & 0xff);
    const str = String(code % 10 ** digits);
    return str.padStart(digits, '0');
}

export function generateTotp(
    secretBase32: string,
    options?: { stepSeconds?: number; digits?: number; nowMs?: number },
): string {
    const step = options?.stepSeconds ?? 30;
    const digits = options?.digits ?? 6;
    const now = options?.nowMs ?? Date.now();
    const counter = Math.floor(now / 1000 / step);
    return hotp(base32Decode(secretBase32), counter, digits);
}

export function verifyTotp(
    secretBase32: string,
    code: string,
    options?: { stepSeconds?: number; digits?: number; window?: number; nowMs?: number },
): boolean {
    if (!code || !/^\d{6,8}$/.test(code)) return false;
    const step = options?.stepSeconds ?? 30;
    const digits = options?.digits ?? 6;
    const window = options?.window ?? 1;
    const now = options?.nowMs ?? Date.now();
    const counter = Math.floor(now / 1000 / step);
    const secret = base32Decode(secretBase32);
    const expectedLen = digits;
    const provided = Buffer.from(code.padStart(expectedLen, '0'));
    for (let w = -window; w <= window; w++) {
        const candidate = Buffer.from(hotp(secret, counter + w, digits));
        if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) {
            return true;
        }
    }
    return false;
}

export function buildOtpAuthUri(input: {
    secretBase32: string;
    accountName: string;
    issuer?: string;
}): string {
    const issuer = encodeURIComponent(input.issuer ?? 'Dashboard');
    const account = encodeURIComponent(input.accountName);
    return `otpauth://totp/${issuer}:${account}?secret=${input.secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}


const lastAcceptedCounter = new Map<string, number>();

export function verifyTotpWithReplayProtection(
    userId: string,
    secretBase32: string,
    code: string,
    options?: { stepSeconds?: number; window?: number; nowMs?: number },
): boolean {
    const step = options?.stepSeconds ?? 30;
    const now = options?.nowMs ?? Date.now();
    const counter = Math.floor(now / 1000 / step);
    if (!verifyTotp(secretBase32, code, options)) return false;
    const last = lastAcceptedCounter.get(userId);

    if (last !== undefined && counter <= last && options?.window === 0) {
        return false;
    }

    const exact = generateTotp(secretBase32, { ...options, nowMs: now });
    if (exact === code) {
        lastAcceptedCounter.set(userId, counter);
    }
    return true;
}

export function clearTotpReplayStateForTests(): void {
    lastAcceptedCounter.clear();
}
