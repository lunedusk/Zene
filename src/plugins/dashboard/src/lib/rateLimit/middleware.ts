



import type { Response, NextFunction } from 'express';
import type { DashRequest } from '../authz.js';
import { err } from '../http.js';
import { LocalRateLimiter, ruleForRisk, type RouteRiskClass } from './rateLimitPolicy.js';
import { distributedAllow } from './distributedStore.js';

const limiter = new LocalRateLimiter();

export function rateLimit(risk: RouteRiskClass) {
    const rule = ruleForRisk(risk);
    return (req: DashRequest, res: Response, next: NextFunction): void => {
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

        const run = async (): Promise<void> => {
            const decision = rule.distributed
                ? await distributedAllow(key, rule)
                : { allowed: limiter.allow(key, rule), remaining: 0, backend: 'local' as const };
            if (!decision.allowed) {
                res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
                err(res, 429, 'rate_limited', 'Too many requests', {
                    risk,
                    windowMs: rule.windowMs,
                    backend: decision.backend,
                });
                return;
            }
            next();
        };

        void run().catch((e: unknown) => {
            next(e instanceof Error ? e : new Error('rate_limit_error'));
        });
    };
}


export function getRateLimiterForTests(): LocalRateLimiter {
    return limiter;
}
