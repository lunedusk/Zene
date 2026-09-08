import type { BlacklistEntry, BlacklistKind } from './types.js';

const MAX_PATTERN_LEN = 200;
const MAX_REGEX_LEN = 120;

/** Reject obviously catastrophic regex constructs. */
export function isSafeRegexPattern(pattern: string): boolean {
    if (pattern.length > MAX_REGEX_LEN) return false;
    if (/\(\?[^)]*\)/.test(pattern)) return false; // no groups with options we don't want
    // nested quantifiers / unbounded repeats
    if (/(\+|\*|\{\d+,?\})\{/.test(pattern)) return false;
    if (/(\+|\*)\+/.test(pattern)) return false;
    if (/\.\*[^\n]{0,5}\.\*/.test(pattern)) return false;
    try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, 'iu');
        return true;
    } catch {
        return false;
    }
}

export function normalizeBlacklistPattern(kind: BlacklistKind, raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (kind === 'regex') {
        if (trimmed.length > MAX_REGEX_LEN) return null;
        if (!isSafeRegexPattern(trimmed)) return null;
        return trimmed;
    }
    if (trimmed.length > MAX_PATTERN_LEN) return null;
    if (kind === 'word') return trimmed.toLowerCase();
    // link: store hostname or full substring lowercased
    return trimmed.toLowerCase();
}

export function matchWordBlacklist(content: string, entries: readonly BlacklistEntry[]): string | null {
    if (!content || entries.length === 0) return null;
    const lower = content.toLowerCase();
    for (const e of entries) {
        if (e.kind !== 'word') continue;
        if (e.pattern && lower.includes(e.pattern)) return e.pattern;
    }
    return null;
}

export function matchLinkBlacklist(content: string, entries: readonly BlacklistEntry[]): string | null {
    if (!content || entries.length === 0) return null;
    const urls = content.match(/https?:\/\/[^\s<>\]]+/gi) ?? [];
    if (urls.length === 0) {
        // also check bare domains
        const lower = content.toLowerCase();
        for (const e of entries) {
            if (e.kind !== 'link') continue;
            if (e.pattern && lower.includes(e.pattern)) return e.pattern;
        }
        return null;
    }
    for (const url of urls) {
        const lower = url.toLowerCase();
        for (const e of entries) {
            if (e.kind !== 'link') continue;
            if (e.pattern && lower.includes(e.pattern)) return e.pattern;
        }
    }
    return null;
}

export function matchRegexBlacklist(content: string, entries: readonly BlacklistEntry[]): string | null {
    if (!content || entries.length === 0) return null;
    for (const e of entries) {
        if (e.kind !== 'regex') continue;
        try {
            const re = new RegExp(e.pattern, 'iu');
            if (re.test(content)) return e.pattern;
        } catch {
            continue;
        }
    }
    return null;
}
