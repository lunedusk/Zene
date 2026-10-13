import { type Request, type Response, type NextFunction, type Router } from 'express';
import { type IHeart } from '#core/heart/index.js';
import { type VerifiedToken } from '#core/manager/token.js';
import { err, type AuthzFailureClass } from './http.js';
import { BOT_OWNER_BIT } from './bits.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import type { ActorCapabilityId } from '#core/types/capabilities.js';
import { authorizeCapability, resolveActorPermissions } from '#core/permissions/capabilities.js';
import { randomUUID } from 'node:crypto';

export interface DashRequest<P = Record<string, string>> extends Request<P> {
    dashSession?: VerifiedToken;
    /** Authoritative Core dashboard session id when present */
    coreSessionId?: string;
    requestId?: string;
}

function gateway(heart: IHeart): GatewayManager | undefined {
    return heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
}





const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cookie-authenticated mutations: exact Origin policy + CSRF token (X-CSRF-Token / body.csrf).
 * Safe methods (GET/HEAD/OPTIONS) pass through. OAuth start/callback remain unauthenticated
 * and are not covered by this middleware (they use OAuth state/PKCE instead).
 */
export function requireMutationProtection(heart: IHeart) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const method = (req.method ?? 'GET').toUpperCase();
        if (!MUTATION_METHODS.has(method)) {
            next();
            return;
        }

        // Unauthenticated OAuth endpoints use protocol state, not CSRF cookies.
        const path = (req.path ?? '').replace(/\/+$/, '') || '/';
        if (
            path.endsWith('/oauth/start') ||
            path.endsWith('/oauth/callback') ||
            path === '/oauth/start' ||
            path === '/oauth/callback'
        ) {
            next();
            return;
        }

        try {
            const { validateOrigin, validateCsrfToken, resolveDashboardAllowedOrigins } =
                await import('#core/dashboard/csrf.js');
            const { getDashboardSessionRecord } = await import('#core/dashboard/index.js');

            const allowed = resolveDashboardAllowedOrigins();
            // In production, empty allowlist fails closed inside validateOrigin.
            // For explicit development, derive origin from the request host when allowlist empty.
            const isDev =
                (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'development';
            let origins = allowed;
            if (origins.length === 0 && isDev) {
                const host = req.get('host');
                const proto = (req.get('x-forwarded-proto') ?? req.protocol ?? 'http')
                    .toString()
                    .split(',')[0]
                    ?.trim();
                if (host && proto) {
                    origins = [`${proto}://${host}`];
                }
            }

            validateOrigin({
                origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
                referer: typeof req.headers.referer === 'string' ? req.headers.referer : undefined,
                allowedOrigins: origins,
            });

            const coreId = req.coreSessionId ?? readCoreSessionCookie(req);
            const isLogout = path.endsWith('/logout') || path === '/logout';

            // Logout without a valid session: origin check is enough; clear cookie downstream.
            if (!coreId) {
                if (isLogout) {
                    next();
                    return;
                }
                err(res, 401, 'core_session_required', 'Core dashboard session required');
                return;
            }
            const rec = getDashboardSessionRecord(coreId);
            if (!rec || rec.revoked) {
                if (isLogout) {
                    next();
                    return;
                }
                err(res, 401, 'unauthorized', heart.assets.lang.get(heart.id, 'errors.unauthorized'));
                return;
            }

            const headerToken =
                typeof req.headers['x-csrf-token'] === 'string'
                    ? req.headers['x-csrf-token']
                    : undefined;
            const bodyToken =
                req.body &&
                typeof req.body === 'object' &&
                req.body !== null &&
                typeof (req.body as { csrf?: unknown }).csrf === 'string'
                    ? (req.body as { csrf: string }).csrf
                    : undefined;

            validateCsrfToken({
                csrfSecret: rec.csrfSecret,
                sessionId: rec.sessionId,
                token: headerToken ?? bodyToken,
            });

            next();
        } catch (e: unknown) {
            const { DashboardAuthError } = await import('#core/dashboard/authContext.js');
            if (e instanceof DashboardAuthError) {
                const status =
                    e.code === 'csrf_failure' || e.code === 'origin_failure' ? 403 : 401;
                err(res, status, e.code, e.message);
                return;
            }
            heart.log.error(
                `requireMutationProtection failed: ${e instanceof Error ? e.message : String(e)}`,
            );
            err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
        }
    };
}

/**
 * Dashboard namespace uses Core session + per-route authz, not generic API-gateway bearer keys.
 * Also attaches mutation CSRF/origin protection for cookie-authenticated state changes.
 */
export function applyGateway(heart: IHeart, router: Router, options?: { requireGateway?: boolean }): void {
    const api = gateway(heart);
    if (!api) {
        if (options?.requireGateway === true) {
            heart.log.error(
                'api plugin handler unavailable — dashboard routes FAIL CLOSED (gateway required by option).',
            );
            router.use((_req, res) => {
                err(res, 503, 'gateway_unavailable', 'API gateway is unavailable.');
            });
            return;
        }
        heart.log.debug(
            'api plugin handler unavailable — dashboard routes continue with Core session auth only.',
        );
    }
    // Intentionally do NOT call api.applyMiddleware(router): dashboard must not require
    // Authorization: Bearer <gateway-key>. Session middleware is applied per-route via requireSession.
    // Mutation protection applies to all dashboard routers that call applyGateway.
    router.use(requireMutationProtection(heart));
}


export function ensureRequestId(req: DashRequest, res: Response, next: NextFunction): void {
    const existing = req.header('x-request-id') ?? req.header('x-correlation-id');
    const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
}





export function sendAuthzFailure(
    res: Response,
    heart: IHeart,
    classification: AuthzFailureClass,
    code?: string,
    message?: string,
): void {
    if (classification === 'unauthenticated') {
        err(res, 401, code ?? 'unauthorized', message ?? heart.assets.lang.get(heart.id, 'errors.unauthorized'));
        return;
    }
    if (classification === 'hidden') {
        err(res, 404, code ?? 'not_found', message ?? heart.assets.lang.get(heart.id, 'errors.notFound') ?? 'Not found');
        return;
    }
    err(res, 403, code ?? 'forbidden', message ?? heart.assets.lang.get(heart.id, 'errors.forbidden'));
}





export function requireCapability(
    heart: IHeart,
    capabilityId: ActorCapabilityId,
    options?: { hideExistence?: boolean; guildParam?: string },
) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const session = req.dashSession;
        if (!session) {
            sendAuthzFailure(res, heart, 'unauthenticated');
            return;
        }
        const userId = session.payload.userId;
        const guildId =
            options?.guildParam && typeof req.params[options.guildParam] === 'string'
                ? req.params[options.guildParam]
                : typeof req.params.guildId === 'string'
                  ? req.params.guildId
                  : undefined;

        try {
            const decision = await authorizeCapability({
                userId,
                capabilityId,
                guildId,
                requestId: req.requestId,
                resource: guildId ? { kind: 'guild', id: guildId, guildId } : undefined,
            });
            if (decision.allowed) {
                next();
                return;
            }
            const hide = options?.hideExistence === true || decision.hideExistence;
            sendAuthzFailure(
                res,
                heart,
                hide ? 'hidden' : 'forbidden',
                decision.code?.toLowerCase() ?? 'forbidden',
                decision.reason,
            );
        } catch (e) {
            heart.log.error(`requireCapability failed: ${(e as Error)?.message ?? e}`);
            err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
        }
    };
}

export function requireAuthedCapability(
    heart: IHeart,
    capabilityId: ActorCapabilityId,
    options?: { hideExistence?: boolean; guildParam?: string },
) {
    return [requireSession(heart), requireCapability(heart, capabilityId, options)];
}


export async function resolveSessionPermissions(
    userId: string,
    guildId?: string,
): Promise<ReadonlySet<string>> {
    const actor = await resolveActorPermissions(userId, guildId);
    return actor.resolved.bits;
}

function readCoreSessionCookie(req: Request): string | undefined {
    const raw = req.headers.cookie;
    if (!raw || typeof raw !== 'string') return undefined;
    for (const part of raw.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === '__Host-zene_dash_session' || k === 'dash_session') {
            return decodeURIComponent(rest.join('=') || '');
        }
    }
    return undefined;
}

/**
 * Dashboard session middleware: HttpOnly Core session cookie is the only authorization source.
 * Client-supplied session IDs (headers, body, localStorage tokens) are not accepted as proof.
 */
export function requireSession(heart: IHeart) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const { getDashboardSessionRecord } = await import('#core/dashboard/index.js');

        const coreId = readCoreSessionCookie(req);

        if (!coreId) {
            err(res, 401, 'core_session_required', 'Core dashboard session required');
            return;
        }
        const core = getDashboardSessionRecord(coreId);
        if (!core || core.revoked) {
            err(res, 401, 'unauthorized', heart.assets.lang.get(heart.id, 'errors.unauthorized'));
            return;
        }

        req.coreSessionId = core.sessionId;

        // Compatible shape for routes that still read dashSession.payload (never from client token).
        req.dashSession = {
            payload: {
                userId: core.principal.userId,
                bits: [...core.principal.bits],
                exp: Math.floor(core.expiresAt / 1000),
                jti: core.sessionId,
            },
        } as VerifiedToken;
        next();
    };
}





export function requireBit(heart: IHeart, bit: string) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const verified = req.dashSession;
        if (!verified) {
            sendAuthzFailure(res, heart, 'unauthenticated');
            return;
        }
        try {
            const actor = await resolveActorPermissions(verified.payload.userId);
            if (
                actor.resolved.botOwner ||
                actor.resolved.bits.has(BOT_OWNER_BIT) ||
                actor.resolved.bits.has(bit)
            ) {
                next();
                return;
            }
            sendAuthzFailure(res, heart, 'forbidden');
        } catch (e) {
            heart.log.error(`requireBit resolve failed: ${(e as Error)?.message ?? e}`);
            err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
        }
    };
}

export function requireAuthedBit(heart: IHeart, bit: string) {
    return [requireSession(heart), requireBit(heart, bit)];
}

export function requireAnyBit(heart: IHeart, bits: readonly string[]) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const verified = req.dashSession;
        if (!verified) {
            sendAuthzFailure(res, heart, 'unauthenticated');
            return;
        }
        try {
            const actor = await resolveActorPermissions(verified.payload.userId);
            if (actor.resolved.botOwner || actor.resolved.bits.has(BOT_OWNER_BIT)) {
                next();
                return;
            }
            for (const bit of bits) {
                if (actor.resolved.bits.has(bit)) {
                    next();
                    return;
                }
            }
            sendAuthzFailure(res, heart, 'forbidden');
        } catch (e) {
            heart.log.error(`requireAnyBit resolve failed: ${(e as Error)?.message ?? e}`);
            err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
        }
    };
}

export function requireAuthedAnyBit(heart: IHeart, bits: readonly string[]) {
    return [requireSession(heart), requireAnyBit(heart, bits)];
}

export function requireGuildBit(heart: IHeart, bit: string, crossServerBit?: string) {
    return [
        requireSession(heart),
        async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
            const verified = req.dashSession;
            const guildIdRaw = req.params.guildId;
            const guildId = typeof guildIdRaw === 'string' ? guildIdRaw : undefined;
            if (!verified) {
                sendAuthzFailure(res, heart, 'unauthenticated');
                return;
            }
            if (!guildId) {
                sendAuthzFailure(res, heart, 'forbidden', 'forbidden', 'guildId required');
                return;
            }
            try {
                // Authoritative membership from Core session (OAuth guild list), not client claim.
                const { getDashboardSessionRecord } = await import('#core/dashboard/index.js');
                const core = req.coreSessionId
                    ? getDashboardSessionRecord(req.coreSessionId)
                    : undefined;
                const membership = core?.principal.guildIds ?? [];
                const isOwner =
                    core?.principal.isEnvOwner === true ||
                    (await resolveActorPermissions(verified.payload.userId)).resolved.botOwner;
                if (!isOwner && membership.length > 0 && !membership.includes(guildId)) {
                    sendAuthzFailure(res, heart, 'forbidden', 'forbidden', 'Not a member of the requested guild');
                    return;
                }

                const actor = await resolveActorPermissions(verified.payload.userId, guildId);
                if (actor.resolved.botOwner || actor.resolved.bits.has(BOT_OWNER_BIT)) {
                    next();
                    return;
                }
                if (crossServerBit && actor.resolved.bits.has(crossServerBit)) {
                    next();
                    return;
                }

                if (actor.resolved.bits.has(bit)) {
                    next();
                    return;
                }
                sendAuthzFailure(res, heart, 'forbidden');
            } catch (e) {
                heart.log.error(`requireGuildBit resolve failed: ${(e as Error)?.message ?? e}`);
                err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
            }
        },
    ];
}
