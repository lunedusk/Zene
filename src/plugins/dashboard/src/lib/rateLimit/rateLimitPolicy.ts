/**
 * Phase 2C — Rate-limit classification policy (pure). Complements authorization; does not replace it.
 */

export type RouteRiskClass =
    | 'public_read'
    | 'authenticated_read'
    | 'mutation'
    | 'authentication'
    | 'sensitive_mutation'
    | 'administrative'
    | 'realtime_subscription'
    | 'export'
    | 'data_deletion';

export interface RateLimitRule {
    readonly risk: RouteRiskClass;
    readonly windowMs: number;
    readonly max: number;
    readonly dimensions: readonly ('ip' | 'session' | 'user' | 'guild' | 'route' | 'operation')[];
    readonly distributed: boolean;
}

export const RATE_LIMIT_RULES: readonly RateLimitRule[] = [
    { risk: 'public_read', windowMs: 60_000, max: 120, dimensions: ['ip', 'route'], distributed: true },
    { risk: 'authenticated_read', windowMs: 60_000, max: 300, dimensions: ['user', 'route'], distributed: false },
    { risk: 'mutation', windowMs: 60_000, max: 60, dimensions: ['user', 'route'], distributed: true },
    { risk: 'authentication', windowMs: 60_000, max: 20, dimensions: ['ip', 'route'], distributed: true },
    { risk: 'sensitive_mutation', windowMs: 60_000, max: 15, dimensions: ['user', 'operation'], distributed: true },
    { risk: 'administrative', windowMs: 60_000, max: 30, dimensions: ['user', 'route'], distributed: true },
    { risk: 'realtime_subscription', windowMs: 60_000, max: 10, dimensions: ['user'], distributed: true },
    { risk: 'export', windowMs: 3_600_000, max: 5, dimensions: ['user', 'operation'], distributed: true },
    { risk: 'data_deletion', windowMs: 3_600_000, max: 3, dimensions: ['user', 'operation'], distributed: true },
] as const;

export function ruleForRisk(risk: RouteRiskClass): RateLimitRule {
    const r = RATE_LIMIT_RULES.find((x) => x.risk === risk);
    if (!r) {
        return { risk, windowMs: 60_000, max: 60, dimensions: ['user'], distributed: false };
    }
    return r;
}

/** In-memory token bucket for foundation / unit tests. Distributed limits need Redis in production. */
export class LocalRateLimiter {
    private readonly hits = new Map<string, number[]>();

    allow(key: string, rule: RateLimitRule): boolean {
        const now = Date.now();
        const windowStart = now - rule.windowMs;
        const arr = (this.hits.get(key) ?? []).filter((t) => t >= windowStart);
        if (arr.length >= rule.max) {
            this.hits.set(key, arr);
            return false;
        }
        arr.push(now);
        this.hits.set(key, arr);
        return true;
    }

    buildKey(rule: RateLimitRule, dims: Partial<Record<'ip' | 'session' | 'user' | 'guild' | 'route' | 'operation', string>>): string {
        const parts = rule.dimensions.map((d) => `${d}:${dims[d] ?? '*'}`);
        return `${rule.risk}|${parts.join('|')}`;
    }
}

/** Sensitive ops that should also require sudo when session model is active. */
export const SUDO_REQUIRED_OPERATIONS = [
    'owner.change',
    'permissions.mutate',
    'security.settings',
    'secret.provider',
    'data_rights.delete',
    'fleet.control',
    'credentials.change',
] as const;
