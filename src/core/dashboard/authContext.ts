/**
 * Core-authoritative Dashboard identity, session, and principal contracts.
 * Client payloads never establish identity or permissions.
 */

import { createHash, randomBytes } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DashboardAuth');

export type DashboardAuthProvider = 'discord';

export interface DashboardPrincipal {
    readonly provider: DashboardAuthProvider;
    readonly providerUserId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly roles: readonly string[];
    readonly bits: readonly string[];
    readonly guildIds: readonly string[];
    readonly isEnvOwner: boolean;
    readonly authorizedScopes: readonly string[];
    readonly authenticatedAt: number;
}

export interface DashboardSessionRecord {
    readonly sessionId: string;
    /** SHA-256 of sessionId for storage indexing when needed */
    readonly sessionIdHash: string;
    readonly principal: DashboardPrincipal;
    readonly provider: DashboardAuthProvider;
    readonly issuedAt: number;
    readonly lastSeenAt: number;
    readonly expiresAt: number;
    readonly authenticatedAt: number;
    readonly authorizedScopes: readonly string[];
    readonly revoked: boolean;
    readonly version: number;
    readonly csrfSecret: string;
}

export interface DashboardAuthContext {
    readonly principal: DashboardPrincipal;
    readonly requestId: string;
    readonly origin?: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
}

/** sessionId → record */
const sessions = new Map<string, DashboardSessionRecord>();
/** legacy compatibility map used by older helpers */
const legacyCtx = new Map<string, DashboardAuthContext>();

export function hashSessionId(sessionId: string): string {
    return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

export function createOpaqueSessionId(): string {
    return randomBytes(32).toString('base64url');
}

export function createCsrfSecret(): string {
    return randomBytes(24).toString('base64url');
}

export function putDashboardSession(
    sessionId: string,
    ctx: DashboardAuthContext,
): void {
    if (ctx.principal.sessionId !== sessionId) {
        throw new Error('sessionId mismatch');
    }
    legacyCtx.set(sessionId, ctx);
    const existing = sessions.get(sessionId);
    const record: DashboardSessionRecord = {
        sessionId,
        sessionIdHash: hashSessionId(sessionId),
        principal: {
            provider: ctx.principal.provider ?? 'discord',
            providerUserId: ctx.principal.providerUserId ?? ctx.principal.userId,
            userId: ctx.principal.userId,
            sessionId,
            roles: ctx.principal.roles,
            bits: ctx.principal.bits,
            guildIds: ctx.principal.guildIds,
            isEnvOwner: ctx.principal.isEnvOwner,
            authorizedScopes: ctx.principal.authorizedScopes ?? ['identify'],
            authenticatedAt: ctx.principal.authenticatedAt ?? ctx.issuedAt,
        },
        provider: 'discord',
        issuedAt: ctx.issuedAt,
        lastSeenAt: Date.now(),
        expiresAt: ctx.expiresAt,
        authenticatedAt: ctx.issuedAt,
        authorizedScopes: ctx.principal.authorizedScopes ?? ['identify'],
        revoked: false,
        version: (existing?.version ?? 0) + 1,
        csrfSecret: existing?.csrfSecret ?? createCsrfSecret(),
    };
    sessions.set(sessionId, record);
}

export function establishDashboardSession(input: {
    principal: Omit<DashboardPrincipal, 'sessionId'> & { sessionId?: string };
    ttlMs?: number;
    authorizedScopes?: readonly string[];
}): { sessionId: string; record: DashboardSessionRecord; previousSessionId?: string } {
    const previousSessionId = input.principal.sessionId;
    const sessionId = createOpaqueSessionId();
    const now = Date.now();
    const ttl = input.ttlMs ?? 1000 * 60 * 60 * 12;
    const scopes = input.authorizedScopes ?? input.principal.authorizedScopes ?? ['identify'];
    const principal: DashboardPrincipal = {
        ...input.principal,
        sessionId,
        provider: input.principal.provider ?? 'discord',
        providerUserId: input.principal.providerUserId ?? input.principal.userId,
        authorizedScopes: scopes,
        authenticatedAt: input.principal.authenticatedAt ?? now,
    };
    const record: DashboardSessionRecord = {
        sessionId,
        sessionIdHash: hashSessionId(sessionId),
        principal,
        provider: 'discord',
        issuedAt: now,
        lastSeenAt: now,
        expiresAt: now + ttl,
        authenticatedAt: principal.authenticatedAt,
        authorizedScopes: scopes,
        revoked: false,
        version: 1,
        csrfSecret: createCsrfSecret(),
    };
    sessions.set(sessionId, record);
    legacyCtx.set(sessionId, {
        principal,
        requestId: sessionId,
        issuedAt: now,
        expiresAt: record.expiresAt,
    });
    if (previousSessionId && previousSessionId !== sessionId) {
        revokeDashboardSession(previousSessionId);
    }
    log.debug(`Session established user=${principal.userId}`);
    return { sessionId, record, previousSessionId };
}

export function getDashboardSessionRecord(
    sessionId: string,
): DashboardSessionRecord | undefined {
    const s = sessions.get(sessionId);
    if (!s) return undefined;
    if (s.revoked) return undefined;
    if (Date.now() > s.expiresAt) {
        sessions.delete(sessionId);
        legacyCtx.delete(sessionId);
        return undefined;
    }
    return s;
}

export function touchDashboardSession(sessionId: string): void {
    const s = sessions.get(sessionId);
    if (!s || s.revoked) return;
    sessions.set(sessionId, { ...s, lastSeenAt: Date.now() });
}

export function getDashboardSession(
    sessionId: string,
): DashboardAuthContext | undefined {
    const rec = getDashboardSessionRecord(sessionId);
    if (!rec) return undefined;
    return {
        principal: rec.principal,
        requestId: sessionId,
        issuedAt: rec.issuedAt,
        expiresAt: rec.expiresAt,
    };
}

export function revokeDashboardSession(sessionId: string): boolean {
    const s = sessions.get(sessionId);
    if (!s) {
        legacyCtx.delete(sessionId);
        return false;
    }
    sessions.set(sessionId, { ...s, revoked: true });
    legacyCtx.delete(sessionId);
    return true;
}

export function clearDashboardSession(sessionId: string): void {
    revokeDashboardSession(sessionId);
    sessions.delete(sessionId);
    legacyCtx.delete(sessionId);
}

export function logoutDashboardSession(sessionId: string): void {
    clearDashboardSession(sessionId);
}

export function principalHasBits(
    principal: DashboardPrincipal,
    required: readonly string[],
    mode: 'all' | 'any' = 'all',
): boolean {
    if (required.length === 0) return true;
    if (principal.isEnvOwner) return true;
    const set = new Set(principal.bits);
    if (mode === 'any') return required.some((b) => set.has(b));
    return required.every((b) => set.has(b));
}

export function assertDashboardAuthorized(
    ctx: DashboardAuthContext,
    requiredBits: readonly string[],
): void {
    if (!principalHasBits(ctx.principal, requiredBits, 'all')) {
        throw new DashboardAuthError('forbidden', 'Dashboard authorization denied');
    }
}

export class DashboardAuthError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = 'DashboardAuthError';
        this.code = code;
    }
}

/** Secure cookie attribute defaults for opaque session id */
export const DASHBOARD_SESSION_COOKIE = {
    name: '__Host-zene_dash_session',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    // no Domain attribute for __Host-
};

export function sessionCookieHeader(sessionId: string, maxAgeSec: number): string {
    return [
        `${DASHBOARD_SESSION_COOKIE.name}=${sessionId}`,
        `Path=${DASHBOARD_SESSION_COOKIE.path}`,
        'HttpOnly',
        'Secure',
        `SameSite=${DASHBOARD_SESSION_COOKIE.sameSite}`,
        `Max-Age=${maxAgeSec}`,
    ].join('; ');
}
