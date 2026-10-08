/**
 * Dashboard session resolution — Core session is authoritative.
 * Better Auth / legacy paths are adapters that cannot authorize without Core.
 */

import type { Request } from 'express';
import {
    bridgedIdentityFromLegacyDashSession,
    buildBridgedIdentity,
    bridgeAuthToZeneAuthorization,
    type AuthorizationBridgeResult,
} from './authorizationBridge.js';
import type { BridgedAuthIdentity } from './types.js';
import { AUTH_MIGRATION_PHASE } from './betterAuthBoundary.js';
import { isLegacyAuthAllowed } from './betterAuthSchema.js';
import {
    getDashboardSessionRecord,
    DASHBOARD_SESSION_COOKIE,
    type DashboardSessionRecord,
    logoutCoreDashboardSession,
    invalidateRealtimeForSession,
} from '#core/dashboard/index.js';

export type SessionAuthority = 'core' | 'legacy_dash' | 'better_auth' | 'none';

export interface ResolvedDashboardSession {
    readonly authority: SessionAuthority;
    readonly identity: BridgedAuthIdentity | null;
    readonly authorization: AuthorizationBridgeResult | null;
    readonly coreSession: DashboardSessionRecord | null;
}

export type SessionIdentityRequest = {
    headers: {
        authorization?: string | string[];
        cookie?: string | string[];
        'x-dash-session'?: string | string[];
        [key: string]: string | string[] | undefined;
    };
    dashSession?: {
        payload: { userId: string; exp?: number; jti?: string };
    };
};

function readBearer(req: SessionIdentityRequest): string | null {
    const h = req.headers.authorization;
    if (typeof h === 'string' && h.toLowerCase().startsWith('bearer ')) {
        const t = h.slice(7).trim();
        return t.length > 0 ? t : null;
    }
    return null;
}

function readCookie(req: SessionIdentityRequest, name: string): string | null {
    const raw = req.headers.cookie;
    if (!raw || typeof raw !== 'string') return null;
    for (const part of raw.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === name) return decodeURIComponent(rest.join('=') || '');
    }
    return null;
}

function readOpaqueSessionId(req: SessionIdentityRequest): string | null {
    return (
        readCookie(req, DASHBOARD_SESSION_COOKIE.name) ??
        readCookie(req, 'dash_session') ??
        (typeof req.headers['x-dash-session'] === 'string'
            ? req.headers['x-dash-session']
            : null) ??
        readBearer(req)
    );
}

function identityFromCoreSession(rec: DashboardSessionRecord): BridgedAuthIdentity {
    return buildBridgedIdentity({
        authUserId: rec.principal.userId,
        discordUserId: rec.principal.providerUserId,
        session: {
            sessionId: rec.sessionId,
            userId: rec.principal.userId,
            expiresAt: rec.expiresAt,
            provider: 'discord',
        },
    });
}

let betterAuthResolver:
    | ((req: SessionIdentityRequest) => Promise<BridgedAuthIdentity | null>)
    | null = null;

export function registerBetterAuthSessionResolver(
    fn: ((req: SessionIdentityRequest) => Promise<BridgedAuthIdentity | null>) | null,
): void {
    betterAuthResolver = fn;
}

export function getAuthMigrationPhase(): number {
    return AUTH_MIGRATION_PHASE;
}

function identityFromDashSessionAttachment(
    dash: SessionIdentityRequest,
): BridgedAuthIdentity | null {
    const userId = dash.dashSession?.payload?.userId;
    if (!userId || typeof userId !== 'string') return null;
    const expRaw = dash.dashSession?.payload?.exp;
    const exp =
        typeof expRaw === 'number'
            ? expRaw * (expRaw < 1e12 ? 1000 : 1)
            : Date.now() + 3_600_000;
    return bridgedIdentityFromLegacyDashSession({
        userId,
        sessionId: dash.dashSession?.payload?.jti ?? `legacy:${userId}`,
        expiresAt: exp,
    });
}

/**
 * Resolve session identity. Core opaque session is the only authoritative path.
 * Better Auth / legacy may surface identity only when a matching Core session exists
 * (or, during controlled legacy window, legacy attachment is marked but authorization
 * still requires Core via resolveAuthenticatedRequest).
 */
export async function resolveSessionIdentity(req: SessionIdentityRequest): Promise<{
    authority: SessionAuthority;
    identity: BridgedAuthIdentity | null;
    coreSession: DashboardSessionRecord | null;
}> {
    const opaque = readOpaqueSessionId(req);
    if (opaque) {
        const core = getDashboardSessionRecord(opaque);
        if (core) {
            return {
                authority: 'core',
                identity: identityFromCoreSession(core),
                coreSession: core,
            };
        }
    }

    // Better Auth adapter: identity only accepted if Core session also present for same id
    if (betterAuthResolver) {
        try {
            const ba = await betterAuthResolver(req);
            if (ba) {
                // BA adapter identity is accepted only when a Core session already exists
                // (created at login via establishCoreSessionFromLogin / ensureCoreSessionForAdapterIdentity).
                const core =
                    getDashboardSessionRecord(ba.session.sessionId) ??
                    // Also accept if Core rotated to a new id but request carries Core cookie (handled above)
                    null;
                if (core && !core.revoked) {
                    return {
                        authority: 'better_auth',
                        identity: identityFromCoreSession(core),
                        coreSession: core,
                    };
                }
                return { authority: 'none', identity: null, coreSession: null };
            }
        } catch {
            /* fall through */
        }
    }

    if (isLegacyAuthAllowed()) {
        const fromAttachment = identityFromDashSessionAttachment(req);
        if (fromAttachment) {
            const core = getDashboardSessionRecord(fromAttachment.session.sessionId);
            if (core && !core.revoked) {
                return {
                    authority: 'legacy_dash',
                    identity: identityFromCoreSession(core),
                    coreSession: core,
                };
            }
            // Legacy attachment without prior Core login establishment cannot authorize
            return { authority: 'none', identity: null, coreSession: null };
        }
    }

    return { authority: 'none', identity: null, coreSession: null };
}

export async function resolveAuthenticatedRequest(
    req: SessionIdentityRequest,
): Promise<ResolvedDashboardSession> {
    const { authority, identity, coreSession } = await resolveSessionIdentity(req);
    if (!identity || !coreSession) {
        return {
            authority: 'none',
            identity: null,
            authorization: null,
            coreSession: null,
        };
    }
    const authorization = await bridgeAuthToZeneAuthorization(identity);
    return { authority, identity, authorization, coreSession };
}

export function identityFromBetterAuthUser(input: {
    authUserId: string;
    sessionId: string;
    expiresAt: number;
    discordUserId?: string;
    email?: string | null;
}): BridgedAuthIdentity {
    return buildBridgedIdentity({
        authUserId: input.authUserId,
        discordUserId: input.discordUserId,
        session: {
            sessionId: input.sessionId,
            userId: input.authUserId,
            expiresAt: input.expiresAt,
            provider: 'better_auth',
        },
    });
}

/** @deprecated Request type helper — prefer SessionIdentityRequest */
export type { Request };


/** Logout: revoke Core session and invalidate realtime resources. */
export function logoutDashboardRequest(sessionId: string): void {
    invalidateRealtimeForSession(sessionId);
    logoutCoreDashboardSession(sessionId);
}
