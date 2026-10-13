/**
 * CSRF protection for cookie-authenticated Dashboard mutations.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { DashboardAuthError } from './authContext.js';

export function issueCsrfToken(csrfSecret: string, sessionId: string): string {
    const payload = `${sessionId}.${Date.now()}`;
    const sig = createHmac('sha256', csrfSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

export function validateCsrfToken(input: {
    csrfSecret: string;
    sessionId: string;
    token: string | undefined;
    maxAgeMs?: number;
}): void {
    if (!input.token) {
        throw new DashboardAuthError('csrf_failure', 'Missing CSRF token');
    }
    const parts = input.token.split('.');
    if (parts.length < 3) {
        throw new DashboardAuthError('csrf_failure', 'Malformed CSRF token');
    }
    const sig = parts.pop()!;
    const ts = parts.pop()!;
    const sid = parts.join('.');
    if (sid !== input.sessionId) {
        throw new DashboardAuthError('csrf_failure', 'CSRF session mismatch');
    }
    const issued = Number(ts);
    if (!Number.isFinite(issued)) {
        throw new DashboardAuthError('csrf_failure', 'Invalid CSRF timestamp');
    }
    const maxAge = input.maxAgeMs ?? 3_600_000;
    if (Date.now() - issued > maxAge) {
        throw new DashboardAuthError('csrf_failure', 'CSRF token expired');
    }
    const payload = `${sid}.${ts}`;
    const expected = createHmac('sha256', input.csrfSecret)
        .update(payload)
        .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new DashboardAuthError('csrf_failure', 'CSRF token invalid');
    }
}

/**
 * Exact-origin check for cookie-authenticated mutations.
 * Empty allowlist fails closed (never silently disables protection).
 * Prefer Origin; Referer is accepted only when Origin is absent and parses to an allowed origin.
 */
export function validateOrigin(input: {
    origin: string | undefined;
    referer: string | undefined;
    allowedOrigins: readonly string[];
}): void {
    if (input.allowedOrigins.length === 0) {
        throw new DashboardAuthError(
            'origin_failure',
            'No allowed origins configured for dashboard mutations',
        );
    }
    const origin = input.origin?.trim();
    if (origin && input.allowedOrigins.includes(origin)) return;
    if (!origin && input.referer) {
        try {
            const u = new URL(input.referer);
            const refOrigin = `${u.protocol}//${u.host}`;
            if (input.allowedOrigins.includes(refOrigin)) return;
        } catch {
            /* fall through */
        }
    }
    throw new DashboardAuthError('origin_failure', 'Origin not allowed');
}

/** Resolve configured dashboard allowed origins (exact match). */
export function resolveDashboardAllowedOrigins(): string[] {
    const fromEnv = [
        process.env.DashboardAllowedOrigins ?? '',
        process.env.ApiPublicUrl ?? '',
        process.env.DashboardPublicUrl ?? '',
    ]
        .join(',')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((raw) => {
            try {
                const u = new URL(raw);
                return `${u.protocol}//${u.host}`;
            } catch {
                return raw;
            }
        });
    // Deduplicate
    return [...new Set(fromEnv)];
}
