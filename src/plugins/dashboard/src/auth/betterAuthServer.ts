/**
 * Phase 4 — Better Auth server factory.
 *
 * Runtime-loads `better-auth@1.7.x`. Database is the native driver for the same
 * Dashboard SQL backend (sqliteDB / pg pool) — not a second identity database.
 * Authorization remains Zene-only after session resolution.
 */

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

export interface BetterAuthServerHandle {
    readonly version: typeof BETTER_AUTH_TARGET_VERSION;
    readonly migrationPhase: 2;
    /** Express-compatible handler (mount under /api/dash/auth/*). */
    readonly handler: (req: Request, res: unknown) => Promise<void> | void;
    readonly getSession: (req: SessionIdentityRequest) => Promise<BridgedAuthIdentity | null>;
    /** Real Better Auth API surface for lifecycle operations (register/login/revoke). */
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

/** Result body from better-auth signInEmail / signUpEmail (1.7.x). */
export type BetterAuthSignResult = {
    redirect?: boolean;
    token?: string;
    url?: string;
    user?: { id: string; email?: string | null; name?: string | null };
    session?: { id: string; token?: string; userId?: string };
};

/** When returnHeaders: true, better-auth wraps as { headers, response }. */
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

/**
 * Construct Better Auth against the native SQL driver for the dashboard backend.
 * Pass `database` only when already resolved; otherwise resolves from dash-data backend.
 */
export async function createBetterAuthServer(input: {
    config: BetterAuthBoundaryConfig;
    /** Native better-sqlite3 Database or pg Pool — not SqlAdapter. */
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

    const api: BetterAuthApiSurface = {
        getSession: (ctx) => auth.api!.getSession!(ctx),
        signUpEmail:
            typeof auth.api.signUpEmail === 'function'
                ? (ctx) => auth.api!.signUpEmail!(ctx)
                : undefined,
        signInEmail:
            typeof auth.api.signInEmail === 'function'
                ? (ctx) => auth.api!.signInEmail!(ctx)
                : undefined,
        signOut: typeof auth.api.signOut === 'function' ? (ctx) => auth.api!.signOut!(ctx) : undefined,
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

/** Runtime marker when BA is live (session resolver already registers on success). */
export function markAuthMigrationPhase2(): void {
    /* sessionResolver uses presence of betterAuthResolver as phase-2 signal */
}
