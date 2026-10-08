







import {
    BETTER_AUTH_TARGET_VERSION,
    DEFAULT_SESSION_POLICY,
    type BetterAuthBoundaryConfig,
} from './betterAuthBoundary.js';
import {
    identityFromBetterAuthUser,
    registerBetterAuthSessionResolver,
    type SessionIdentityRequest,
} from './sessionResolver.js';
import type { Request } from 'express';
import type { BridgedAuthIdentity } from './types.js';
import { resolveBetterAuthNativeDatabase } from './betterAuthDatabase.js';
import {
    establishCoreSessionFromLogin,
    logoutCoreDashboardSession,
    invalidateRealtimeForSession,
    type EstablishedCoreLogin,
} from '#core/dashboard/index.js';

export interface BetterAuthServerHandle {
    readonly version: typeof BETTER_AUTH_TARGET_VERSION;
    readonly migrationPhase: 2;

    readonly handler: (req: Request, res: unknown) => Promise<void> | void;
    readonly getSession: (req: SessionIdentityRequest) => Promise<BridgedAuthIdentity | null>;

    readonly api: BetterAuthApiSurface;
}

export type BetterAuthInitResult =
    | { ok: true; handle: BetterAuthServerHandle }
    | {
          ok: false;
          reason: 'PACKAGE_MISSING' | 'MISCONFIGURED' | 'ADAPTER_REQUIRED' | 'INVALID_EXPORT' | 'DATABASE_UNAVAILABLE';
          message: string;
      };

interface BetterAuthSessionView {
    session?: { id: string; userId: string; expiresAt: Date | string | number; token?: string };
    user?: { id: string; email?: string | null; name?: string | null };
}


export type BetterAuthSignResult = {
    redirect?: boolean;
    token?: string;
    url?: string;
    user?: { id: string; email?: string | null; name?: string | null };
    session?: { id: string; token?: string; userId?: string };
};


export type BetterAuthSignResultWithHeaders = {
    headers: Headers;
    response: BetterAuthSignResult;
};

export interface BetterAuthApiSurface {
    getSession: (ctx: {
        headers: Headers;
        query?: { disableCookieCache?: boolean };
    }) => Promise<BetterAuthSessionView | null>;
    signUpEmail?: (ctx: {
        body: { email: string; password: string; name: string };
        returnHeaders?: boolean;
        asResponse?: boolean;
    }) => Promise<BetterAuthSignResult | BetterAuthSignResultWithHeaders | null>;
    signInEmail?: (ctx: {
        body: { email: string; password: string };
        returnHeaders?: boolean;
        asResponse?: boolean;
    }) => Promise<BetterAuthSignResult | BetterAuthSignResultWithHeaders | null>;
    signOut?: (ctx: { headers: Headers }) => Promise<unknown>;
}

interface BetterAuthInstance {
    handler: (req: Request, res: unknown) => Promise<void> | void;
    api?: Partial<BetterAuthApiSurface> & {
        getSession?: (ctx: { headers: Headers }) => Promise<BetterAuthSessionView | null>;
    };
}

type BetterAuthFactory = (options: Record<string, unknown>) => BetterAuthInstance;

async function loadBetterAuthFactory(): Promise<BetterAuthFactory | null> {
    try {
        const dynamicImport = new Function(
            'specifier',
            'return import(specifier)',
        ) as (specifier: string) => Promise<unknown>;
        const mod: unknown = await dynamicImport('better-auth');
        if (!mod || typeof mod !== 'object') return null;
        const factory = (mod as { betterAuth?: unknown }).betterAuth;
        if (typeof factory !== 'function') return null;
        return factory as BetterAuthFactory;
    } catch {
        return null;
    }
}

function headersFromSessionRequest(req: SessionIdentityRequest): Headers {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    return headers;
}





export async function createBetterAuthServer(input: {
    config: BetterAuthBoundaryConfig;

    database?: unknown;
}): Promise<BetterAuthInitResult> {
    if (!input.config.secret || input.config.secret.length < 16) {
        return { ok: false, reason: 'MISCONFIGURED', message: 'Better Auth secret must be >= 16 chars' };
    }
    if (!input.config.baseURL) {
        return { ok: false, reason: 'MISCONFIGURED', message: 'baseURL required' };
    }

    let database = input.database;
    if (!database) {
        try {
            const native = await resolveBetterAuthNativeDatabase();
            database = native.handle;
        } catch (e) {
            return {
                ok: false,
                reason: 'DATABASE_UNAVAILABLE',
                message: e instanceof Error ? e.message : 'native_database_unavailable',
            };
        }
    }

    const factory = await loadBetterAuthFactory();
    if (!factory) {
        return {
            ok: false,
            reason: 'PACKAGE_MISSING',
            message: `better-auth@${BETTER_AUTH_TARGET_VERSION} not resolvable at runtime`,
        };
    }

    let auth: BetterAuthInstance;
    try {
        auth = factory({
            database,
            baseURL: input.config.baseURL,
            secret: input.config.secret,
            trustedOrigins: [...input.config.trustedOrigins],
            emailAndPassword: {
                enabled: true,
                minPasswordLength: 8,
            },
            session: {
                expiresIn: input.config.session.expiresInSeconds,
                updateAge: input.config.session.updateAgeSeconds,
                cookieCache: {
                    enabled: input.config.session.cookieCacheEnabled,
                },
            },
            socialProviders: input.config.discord
                ? {
                      discord: {
                          clientId: input.config.discord.clientId,
                          clientSecret: input.config.discord.clientSecret,
                      },
                  }
                : undefined,
        });
    } catch (e) {
        return {
            ok: false,
            reason: 'INVALID_EXPORT',
            message: e instanceof Error ? e.message : 'betterAuth factory failed',
        };
    }

    if (typeof auth.handler !== 'function') {
        return { ok: false, reason: 'INVALID_EXPORT', message: 'betterAuth instance missing handler' };
    }
    if (!auth.api || typeof auth.api.getSession !== 'function') {
        return { ok: false, reason: 'INVALID_EXPORT', message: 'betterAuth instance missing api.getSession' };
    }

    const getSession = async (req: SessionIdentityRequest): Promise<BridgedAuthIdentity | null> => {
        try {
            const sess = await auth.api!.getSession!({ headers: headersFromSessionRequest(req) });
            if (!sess?.session?.userId || !sess.user?.id) return null;
            const rawExp = sess.session.expiresAt;
            const expiresAt =
                rawExp instanceof Date
                    ? rawExp.getTime()
                    : typeof rawExp === 'number'
                      ? rawExp
                      : typeof rawExp === 'string'
                        ? Date.parse(rawExp) || Date.now() + DEFAULT_SESSION_POLICY.expiresInSeconds * 1000
                        : Date.now() + DEFAULT_SESSION_POLICY.expiresInSeconds * 1000;
            return identityFromBetterAuthUser({
                authUserId: sess.user.id,
                sessionId: sess.session.id,
                expiresAt,
            });
        } catch {
            return null;
        }
    };

    const wrapSignIn = (
        fn: NonNullable<BetterAuthApiSurface['signInEmail']>,
    ): NonNullable<BetterAuthApiSurface['signInEmail']> => {
        return async (ctx) => {
            const result = await fn(ctx);
            try {
                const body =
                    result && typeof result === 'object' && 'response' in result
                        ? (result as BetterAuthSignResultWithHeaders).response
                        : (result as BetterAuthSignResult | null);
                const userId = body?.user?.id ?? body?.session?.userId;
                const adapterSessionId = body?.session?.id;
                if (userId) {
                    completeBetterAuthLogin({
                        userId,
                        adapterSessionId,
                    });
                }
            } catch {
                /* Core session establishment failure must not hide BA result */
            }
            return result;
        };
    };

    const wrapSignOut = (
        fn: NonNullable<BetterAuthApiSurface['signOut']>,
    ): NonNullable<BetterAuthApiSurface['signOut']> => {
        return async (ctx) => {
            let coreId: string | undefined;
            try {
                const sess = await auth.api!.getSession!({ headers: ctx.headers });
                if (sess?.session?.id) {
                    const { getDashboardSessionRecord } = await import('#core/dashboard/index.js');
                    const core = getDashboardSessionRecord(sess.session.id);
                    coreId = core?.sessionId ?? sess.session.id;
                }
            } catch {
                /* ignore */
            }
            const result = await fn(ctx);
            completeBetterAuthLogout(coreId);
            return result;
        };
    };

    const api: BetterAuthApiSurface = {
        getSession: (ctx) => auth.api!.getSession!(ctx),
        signUpEmail:
            typeof auth.api.signUpEmail === 'function'
                ? (ctx) => auth.api!.signUpEmail!(ctx)
                : undefined,
        signInEmail:
            typeof auth.api.signInEmail === 'function'
                ? wrapSignIn((ctx) => auth.api!.signInEmail!(ctx))
                : undefined,
        signOut:
            typeof auth.api.signOut === 'function'
                ? wrapSignOut((ctx) => auth.api!.signOut!(ctx))
                : undefined,
    };

    registerBetterAuthSessionResolver(getSession);

    return {
        ok: true,
        handle: {
            version: BETTER_AUTH_TARGET_VERSION,
            migrationPhase: 2,
            handler: auth.handler,
            getSession,
            api,
        },
    };
}



export function markAuthMigrationPhase2(): void {
}

/**
 * Call after successful Better Auth sign-in / OAuth callback.
 * Establishes the authoritative Core dashboard session.
 */
export function completeBetterAuthLogin(input: {
    userId: string;
    providerUserId?: string;
    adapterSessionId?: string;
    bits?: readonly string[];
    guildIds?: readonly string[];
    isEnvOwner?: boolean;
    expiresAt?: number;
}): EstablishedCoreLogin {
    return establishCoreSessionFromLogin({
        userId: input.userId,
        providerUserId: input.providerUserId ?? input.userId,
        bits: input.bits,
        guildIds: input.guildIds,
        isEnvOwner: input.isEnvOwner,
        previousSessionId: input.adapterSessionId,
        ttlMs:
            input.expiresAt !== undefined
                ? Math.max(1_000, input.expiresAt - Date.now())
                : undefined,
        authorizedScopes: ['identify'],
    });
}

/** Call after Better Auth signOut — revoke Core session and realtime. */
export function completeBetterAuthLogout(coreSessionId: string | undefined): void {
    if (!coreSessionId) return;
    invalidateRealtimeForSession(coreSessionId);
    logoutCoreDashboardSession(coreSessionId);
}
