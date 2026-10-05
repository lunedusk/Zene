/**
 * Phase 4 — Distributed rate-limit store (Redis when available; fail-closed for security risks).
 */

import type { RateLimitRule, RouteRiskClass } from './rateLimitPolicy.js';
import { LocalRateLimiter } from './rateLimitPolicy.js';

export type RateLimitDecision = {
    readonly allowed: boolean;
    readonly remaining: number;
    readonly backend: 'redis' | 'local' | 'fail_closed';
};

export interface RateLimitStore {
    allow(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

/** Risks that must never fail open when distributed backend is down. */
export const FAIL_CLOSED_RISKS: ReadonlySet<RouteRiskClass> = new Set([
    'authentication',
    'sensitive_mutation',
    'administrative',
    'data_deletion',
    'export',
]);

type RedisLike = {
    incr(key: string): Promise<number>;
    pexpire(key: string, ms: number): Promise<number>;
    pttl?(key: string): Promise<number>;
};

let redisClient: RedisLike | null = null;
const local = new LocalRateLimiter();

export function setDistributedRateLimitRedis(client: RedisLike | null): void {
    redisClient = client;
}

export function getDistributedRateLimitRedis(): RedisLike | null {
    return redisClient;
}

/**
 * Rebind from Redis registry without requiring process restart.
 * Call on connect/reconnect lifecycle events.
 */
export function rebindRateLimitRedisFromRegistry(
    tryGet: (alias: string) => { main: RedisLike } | null,
): boolean {
    for (const alias of ['crosshost', 'main', 'default']) {
        const clients = tryGet(alias);
        if (clients?.main) {
            setDistributedRateLimitRedis(clients.main);
            return true;
        }
    }
    setDistributedRateLimitRedis(null);
    return false;
}

/**
 * Atomic window counter. Redis INCR + PEXPIRE on first hit.
 * If Redis missing: local for non-security; fail-closed for security risks.
 */
export async function distributedAllow(
    key: string,
    rule: RateLimitRule,
): Promise<RateLimitDecision> {
    if (redisClient) {
        try {
            const redisKey = `zene:rl:${key}`;
            const count = await redisClient.incr(redisKey);
            if (count === 1) {
                await redisClient.pexpire(redisKey, rule.windowMs);
            }
            const allowed = count <= rule.max;
            return {
                allowed,
                remaining: Math.max(0, rule.max - count),
                backend: 'redis',
            };
        } catch {
            // fall through to fail-closed / local
        }
    }

    if (FAIL_CLOSED_RISKS.has(rule.risk) && rule.distributed) {
        return { allowed: false, remaining: 0, backend: 'fail_closed' };
    }

    const allowed = local.allow(key, rule);
    return {
        allowed,
        remaining: allowed ? 1 : 0,
        backend: 'local',
    };
}

export class DistributedRateLimitService {
    async check(
        rule: RateLimitRule,
        dims: Partial<Record<'ip' | 'session' | 'user' | 'guild' | 'route' | 'operation', string>>,
    ): Promise<RateLimitDecision> {
        const key = local.buildKey(rule, dims);
        return distributedAllow(key, rule);
    }
}

export const rateLimitService = new DistributedRateLimitService();
