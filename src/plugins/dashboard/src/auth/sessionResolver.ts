






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

export type SessionAuthority = 'legacy_dash' | 'better_auth' | 'none';

export interface ResolvedDashboardSession {
    readonly authority: SessionAuthority;
    readonly identity: BridgedAuthIdentity | null;
    readonly authorization: AuthorizationBridgeResult | null;
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











export async function resolveSessionIdentity(req: SessionIdentityRequest): Promise<{
    authority: SessionAuthority;
    identity: BridgedAuthIdentity | null;
}> {

    if (betterAuthResolver) {
        try {
            const ba = await betterAuthResolver(req);
            if (ba) {
                return { authority: 'better_auth', identity: ba };
            }
        } catch {

        }
    }



    if (isLegacyAuthAllowed()) {
        const fromAttachment = identityFromDashSessionAttachment(req);
        if (fromAttachment) {
            return { authority: 'legacy_dash', identity: fromAttachment };
        }
    }


    const token =
        readBearer(req) ??
        (typeof req.headers['x-dash-session'] === 'string' ? req.headers['x-dash-session'] : null) ??
        readCookie(req, 'dash_session');

    if (token) {


        return { authority: 'none', identity: null };
    }

    return { authority: 'none', identity: null };
}




export async function resolveAuthenticatedRequest(req: SessionIdentityRequest): Promise<ResolvedDashboardSession> {
    const { authority, identity } = await resolveSessionIdentity(req);
    if (!identity) {
        return { authority: 'none', identity: null, authorization: null };
    }
    const authorization = await bridgeAuthToZeneAuthorization(identity);
    return { authority, identity, authorization };
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
