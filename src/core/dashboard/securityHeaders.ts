/**
 * Dashboard security header defaults.
 */

import type { Request, Response, NextFunction } from 'express';

export function dashboardSecurityHeaders(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader(
            'Strict-Transport-Security',
            'max-age=31536000; includeSubDomains',
        );
    }
    next();
}

export function corsAllowlist(
    allowedOrigins: readonly string[],
): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader(
                'Access-Control-Allow-Headers',
                'Content-Type, X-CSRF-Token',
            );
            res.setHeader(
                'Access-Control-Allow-Methods',
                'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            );
        }
        // Never wildcard with credentials
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    };
}
