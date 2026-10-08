/**
 * Bounded local rate limiter for OAuth/session/API (fallback when Redis absent).
 */

export interface RateLimitResult {
    readonly allowed: boolean;
    readonly remaining: number;
    readonly retryAfterMs: number;
}

interface Bucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(input: {
    key: string;
    limit: number;
    windowMs: number;
}): RateLimitResult {
    const now = Date.now();
    let b = buckets.get(input.key);
    if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + input.windowMs };
        buckets.set(input.key, b);
    }
    if (b.count >= input.limit) {
        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, b.resetAt - now),
        };
    }
    b.count += 1;
    return {
        allowed: true,
        remaining: Math.max(0, input.limit - b.count),
        retryAfterMs: 0,
    };
}

export function clearRateLimits(): void {
    buckets.clear();
}
