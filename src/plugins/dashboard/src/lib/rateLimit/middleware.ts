/**
 * Phase 2C — Rate-limit Express middleware wired to risk classification.
 */

import type { Response, NextFunction } from 'express';
import type { DashRequest } from '../authz.js';
import { err } from '../http.js';
import { LocalRateLimiter, ruleForRisk, type RouteRiskClass } from './rateLimitPolicy.js';

const limiter = new LocalRateLimiter();

export function rateLimit(risk: RouteRiskClass) {
    const rule = ruleForRisk(risk);
    return (req: DashRequest, res: Response, next: NextFunction): void => {
        if (rule.distributed) {
            // Production Redis adapter deferred; enforce local best-effort and document.
            // Cluster-wide guarantees are NOT claimed.
        }
        const userId = req.dashSession?.payload.userId;
        const sessionId = req.dashSession?.payload.jti;
        const ip =
            (typeof req.headers['x-forwarded-for'] === 'string'
                ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
                : undefined) ||
            req.ip ||
            'unknown';
        const key = limiter.buildKey(rule, {
            ip,
            user: userId,
            session: typeof sessionId === 'string' ? sessionId : undefined,
            route: req.path,
            operation: risk,
            guild: typeof req.params.guildId === 'string' ? req.params.guildId : undefined,
        });
        if (!limiter.allow(key, rule)) {
            res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
            err(res, 429, 'rate_limited', 'Too many requests', { risk, windowMs: rule.windowMs });
            return;
        }
        next();
    };
}

/** Exposed for tests */
export function getRateLimiterForTests(): LocalRateLimiter {
    return limiter;
}
