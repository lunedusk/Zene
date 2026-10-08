/**
 * Login adapters (Better Auth / Discord OAuth / legacy) → Core Dashboard session.
 * Core session remains the only authorization authority after login.
 */

import {
    establishDashboardSession,
    logoutDashboardSession,
    revokeDashboardSession,
    getDashboardSessionRecord,
    sessionCookieHeader,
    type DashboardPrincipal,
    type DashboardSessionRecord,
} from './authContext.js';

export interface LoginIdentityInput {
    readonly userId: string;
    readonly providerUserId?: string;
    readonly roles?: readonly string[];
    readonly bits?: readonly string[];
    readonly guildIds?: readonly string[];
    readonly isEnvOwner?: boolean;
    readonly authorizedScopes?: readonly string[];
    readonly previousSessionId?: string;
    readonly ttlMs?: number;
}

export interface EstablishedCoreLogin {
    readonly sessionId: string;
    readonly record: DashboardSessionRecord;
    readonly setCookie: string;
    readonly previousSessionId?: string;
}

/**
 * Establish or rotate the authoritative Core session after a successful adapter login.
 */
export function establishCoreSessionFromLogin(
    input: LoginIdentityInput,
): EstablishedCoreLogin {
    const now = Date.now();
    const principalBase: Omit<DashboardPrincipal, 'sessionId'> = {
        provider: 'discord',
        providerUserId: input.providerUserId ?? input.userId,
        userId: input.userId,
        roles: input.roles ?? [],
        bits: input.bits ?? [],
        guildIds: input.guildIds ?? [],
        isEnvOwner: input.isEnvOwner ?? false,
        authorizedScopes: input.authorizedScopes ?? ['identify'],
        authenticatedAt: now,
    };
    const established = establishDashboardSession({
        principal: {
            ...principalBase,
            sessionId: input.previousSessionId,
        },
        ttlMs: input.ttlMs,
        authorizedScopes: principalBase.authorizedScopes,
    });
    const maxAgeSec = Math.max(
        1,
        Math.floor((established.record.expiresAt - Date.now()) / 1000),
    );
    return {
        sessionId: established.sessionId,
        record: established.record,
        setCookie: sessionCookieHeader(established.sessionId, maxAgeSec),
        previousSessionId: established.previousSessionId,
    };
}

/**
 * Ensure a Core session exists for an adapter identity (e.g. Better Auth session id).
 * If a Core session already exists for that id, return it; otherwise create a new Core session
 * (rotation) and return the new id — callers must set the Core cookie.
 */
export function ensureCoreSessionForAdapterIdentity(input: {
    adapterSessionId: string;
    userId: string;
    providerUserId?: string;
    bits?: readonly string[];
    guildIds?: readonly string[];
    isEnvOwner?: boolean;
    authorizedScopes?: readonly string[];
    expiresAt?: number;
}): EstablishedCoreLogin {
    const existing = getDashboardSessionRecord(input.adapterSessionId);
    if (existing && !existing.revoked) {
        const maxAgeSec = Math.max(
            1,
            Math.floor((existing.expiresAt - Date.now()) / 1000),
        );
        return {
            sessionId: existing.sessionId,
            record: existing,
            setCookie: sessionCookieHeader(existing.sessionId, maxAgeSec),
        };
    }
    const ttlMs =
        input.expiresAt !== undefined
            ? Math.max(1_000, input.expiresAt - Date.now())
            : undefined;
    return establishCoreSessionFromLogin({
        userId: input.userId,
        providerUserId: input.providerUserId,
        bits: input.bits,
        guildIds: input.guildIds,
        isEnvOwner: input.isEnvOwner,
        authorizedScopes: input.authorizedScopes,
        previousSessionId: input.adapterSessionId,
        ttlMs,
    });
}

export function logoutCoreDashboardSession(sessionId: string): void {
    logoutDashboardSession(sessionId);
}

export function revokeCoreDashboardSession(sessionId: string): boolean {
    return revokeDashboardSession(sessionId);
}
