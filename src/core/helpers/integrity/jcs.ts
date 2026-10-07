/**
 * Phase 2E — RFC 8785 JSON Canonicalization Scheme (JCS) for signed payloads.
 * Deterministic UTF-8 JSON serialization for cryptographic signing.
 */

/** Escape a JSON string per RFC 8785 / ECMA-404. */
function escapeJsonString(s: string): string {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x22 || c === 0x5c) {
            out += `\\${s[i]}`;
        } else if (c === 0x08) out += '\\b';
        else if (c === 0x0c) out += '\\f';
        else if (c === 0x0a) out += '\\n';
        else if (c === 0x0d) out += '\\r';
        else if (c === 0x09) out += '\\t';
        else if (c < 0x20) {
            out += `\\u${c.toString(16).padStart(4, '0')}`;
        } else {
            out += s[i];
        }
    }
    return `${out}"`;
}

function canonicalizeValue(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error('JCS: non-finite numbers are not allowed');
        }
        // ECMAScript NumberToJSON
        return JSON.stringify(value);
    }
    if (typeof value === 'string') return escapeJsonString(value);
    if (Array.isArray(value)) {
        const parts = value.map((v) => canonicalizeValue(v));
        return `[${parts.join(',')}]`;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        const parts: string[] = [];
        for (const k of keys) {
            const v = obj[k];
            if (v === undefined) continue;
            parts.push(`${escapeJsonString(k)}:${canonicalizeValue(v)}`);
        }
        return `{${parts.join(',')}}`;
    }
    throw new Error(`JCS: unsupported type ${typeof value}`);
}

/**
 * Canonicalize a JSON-compatible value per RFC 8785 JCS.
 * Returns UTF-8 string suitable for hashing/signing.
 */
export function canonicalizeJcs(value: unknown): string {
    return canonicalizeValue(value);
}

export const CANONICALIZATION_VERSION = 1 as const;
