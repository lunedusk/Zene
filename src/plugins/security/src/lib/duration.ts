const UNIT_MS: Record<string, number> = {
    s: 1_000,
    sec: 1_000,
    secs: 1_000,
    second: 1_000,
    seconds: 1_000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
    w: 604_800_000,
    week: 604_800_000,
    weeks: 604_800_000,
};

const TOKEN_RE = /(\d+)\s*([a-zA-Z]+)/g;

/**
 * Parse human duration strings such as "10m", "1h30m", "2 days", "90".
 * Bare numbers are treated as seconds.
 * Returns null when the input is empty or unparseable.
 */
export function parseDurationMs(input: string | null | undefined): number | null {
    if (input == null) return null;
    const raw = input.trim().toLowerCase();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
        const secs = Number(raw);
        if (!Number.isFinite(secs) || secs <= 0) return null;
        return secs * 1_000;
    }

    let total = 0;
    let matched = false;
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(raw)) !== null) {
        const amount = Number(m[1]);
        const unit = m[2] ?? '';
        const factor = UNIT_MS[unit];
        if (!factor || !Number.isFinite(amount) || amount < 0) return null;
        total += amount * factor;
        matched = true;
    }

    if (!matched || total <= 0) return null;
    return total;
}

/** Discord timeout max is 28 days. */
export const MAX_TIMEOUT_MS = 28 * 86_400_000;

/** Soft upper bound for tempban scheduling (90 days). */
export const MAX_TEMPBAN_MS = 90 * 86_400_000;

export function clampTimeoutMs(ms: number): number {
    return Math.min(Math.max(1_000, ms), MAX_TIMEOUT_MS);
}

export function clampTempbanMs(ms: number): number {
    return Math.min(Math.max(60_000, ms), MAX_TEMPBAN_MS);
}

export function formatDurationMs(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    if (ms < 86_400_000) {
        const h = Math.floor(ms / 3_600_000);
        const m = Math.round((ms % 3_600_000) / 60_000);
        return m > 0 ? `${h}h${m}m` : `${h}h`;
    }
    const d = Math.floor(ms / 86_400_000);
    const h = Math.round((ms % 86_400_000) / 3_600_000);
    return h > 0 ? `${d}d${h}h` : `${d}d`;
}
