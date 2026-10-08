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

export function validateOrigin(input: {
    origin: string | undefined;
    referer: string | undefined;
    allowedOrigins: readonly string[];
}): void {
    if (input.allowedOrigins.length === 0) return;
    const origin = input.origin;
    if (origin && input.allowedOrigins.includes(origin)) return;
    if (input.referer) {
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
