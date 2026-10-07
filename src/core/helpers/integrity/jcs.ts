/**
 * Phase 2E — RFC 8785 JSON Canonicalization Scheme (JCS).
 * Deterministic UTF-8 JSON serialization for cryptographic signing.
 */

/** Reject lone surrogates and invalid Unicode in strings. */
function assertValidUnicodeString(s: string): void {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            // High surrogate must be followed by low surrogate
            if (i + 1 >= s.length) {
                throw new Error('JCS: lone high surrogate at end of string');
            }
            const low = s.charCodeAt(i + 1);
            if (low < 0xdc00 || low > 0xdfff) {
                throw new Error('JCS: lone high surrogate without low surrogate');
            }
            i++; // consume low
        } else if (c >= 0xdc00 && c <= 0xdfff) {
            throw new Error('JCS: lone low surrogate');
        }
    }
}

/** Escape a JSON string per RFC 8785 / ECMA-404. */
function escapeJsonString(s: string): string {
    assertValidUnicodeString(s);
    let out = '"';
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x22 || c === 0x5c) {
            out += `\\${s[i]!}`;
        } else if (c === 0x08) out += '\\b';
        else if (c === 0x0c) out += '\\f';
        else if (c === 0x0a) out += '\\n';
        else if (c === 0x0d) out += '\\r';
        else if (c === 0x09) out += '\\t';
        else if (c < 0x20) {
            out += `\\u${c.toString(16).padStart(4, '0')}`;
        } else if (c >= 0xd800 && c <= 0xdbff) {
            // Valid surrogate pair — emit as-is (UTF-16 in JS string); JSON uses \u escapes optional
            const low = s.charCodeAt(++i);
            out += s[i - 1]! + s[i]!;
            void low;
        } else {
            out += s[i]!;
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
    if (typeof value === 'bigint') {
        throw new Error('JCS: bigint is not allowed');
    }
    if (typeof value === 'symbol' || typeof value === 'function') {
        throw new Error(`JCS: unsupported type ${typeof value}`);
    }
    if (Array.isArray(value)) {
        const parts = value.map((v) => canonicalizeValue(v));
        return `[${parts.join(',')}]`;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        // Detect own enumerable keys; Object.keys does not retain duplicates (JSON.parse collapses them)
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

/**
 * Parse stored JCS text and require re-canonicalization to be byte-identical.
 * Rejects noncanonical encodings. JSON.parse collapses duplicate keys — we
 * additionally detect duplicate keys via a pre-parse scan of object literals
 * at the top level of the signed payload structure by tracking raw key occurrences
 * in a simple brace-aware scan for the outermost object.
 */
export function parseAndRequireCanonicalJcs(stored: string): unknown {
    // Reject lone surrogates in the raw string before parse
    assertValidUnicodeString(stored);

    // Duplicate key detection on the outermost object (security-sensitive payloads are objects)
    assertNoDuplicateJsonKeys(stored);

    let parsed: unknown;
    try {
        parsed = JSON.parse(stored);
    } catch (err: unknown) {
        throw new Error(
            `JCS: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const recanonicalized = canonicalizeJcs(parsed);
    if (recanonicalized !== stored) {
        throw new Error(
            'JCS: stored signed_payload is not in canonical form (re-canonicalization mismatch).',
        );
    }
    return parsed;
}

/**
 * Lightweight duplicate-key detector for JSON object text.
 * Scans string for object member keys and flags repeats within the same object depth.
 * Not a full JSON parser; sufficient to reject malicious duplicate-property payloads
 * that JSON.parse would silently collapse.
 */
export function assertNoDuplicateJsonKeys(text: string): void {
    // Stack of key sets per object depth
    const stack: Array<Set<string>> = [];
    let i = 0;
    let inString = false;
    let escape = false;

    const readString = (): string => {
        // assumes text[i] === '"'
        i++;
        let s = '';
        while (i < text.length) {
            const c = text[i]!;
            if (escape) {
                s += c;
                escape = false;
                i++;
                continue;
            }
            if (c === '\\') {
                escape = true;
                i++;
                continue;
            }
            if (c === '"') {
                i++;
                return s;
            }
            s += c;
            i++;
        }
        throw new Error('JCS: unterminated string while scanning for duplicate keys');
    };

    while (i < text.length) {
        const c = text[i]!;
        if (inString) {
            // shouldn't reach — strings consumed by readString
            i++;
            continue;
        }
        if (c === '"') {
            // Could be a key or a value string. Peek: after string, if ':' at this depth → key
            const start = i;
            const str = readString();
            // skip whitespace
            while (i < text.length && /\s/.test(text[i]!)) i++;
            if (text[i] === ':' && stack.length > 0) {
                const top = stack[stack.length - 1]!;
                if (top.has(str)) {
                    throw new Error(`JCS: duplicate object key '${str}'`);
                }
                top.add(str);
            }
            void start;
            continue;
        }
        if (c === '{') {
            stack.push(new Set());
            i++;
            continue;
        }
        if (c === '}') {
            stack.pop();
            i++;
            continue;
        }
        if (c === '[') {
            // arrays don't track keys; push sentinel empty set? no — only objects
            i++;
            continue;
        }
        if (c === ']') {
            i++;
            continue;
        }
        i++;
    }
}

export const CANONICALIZATION_VERSION = 1 as const;
