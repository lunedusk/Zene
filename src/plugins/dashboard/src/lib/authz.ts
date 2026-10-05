import { type Request, type Response, type NextFunction, type Router } from 'express';
import { type IHeart } from '#core/heart/index.js';
import { TokenError, type VerifiedToken, type Bit } from '#core/manager/token.js';
import { err, HttpError, type AuthzFailureClass } from './http.js';
import { BOT_OWNER_BIT } from './bits.js';
import { tryTokens } from './tokens.js';
import type GatewayManager from '../../../api/src/handlers/manager.js';
import type { ActorCapabilityId } from '#core/types/capabilities.js';
import { authorizeCapability, resolveActorPermissions } from '#core/permissions/capabilities.js';
import { randomUUID } from 'node:crypto';

export interface DashRequest<P = Record<string, string>> extends Request<P> {
    dashSession?: VerifiedToken;
    requestId?: string;
}

function gateway(heart: IHeart): GatewayManager | undefined {
    return heart.system.handler.$get('api', 'manager') as GatewayManager | undefined;
}





export function applyGateway(heart: IHeart, router: Router, options?: { requireGateway?: boolean }): void {
    const api = gateway(heart);
    if (!api) {
        if (options?.requireGateway !== false) {
            heart.log.error(
                'api plugin handler unavailable — dashboard routes FAIL CLOSED (gateway required).',
            );
            router.use((_req, res) => {
                err(res, 503, 'gateway_unavailable', 'API gateway is unavailable.');
            });
            return;
        }
        heart.log.warn('api plugin handler unavailable — dashboard routes are running WITHOUT gateway auth.');
        return;
    }
    api.applyMiddleware(router);
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

export function requireSession(heart: IHeart) {
    return async (req: DashRequest, res: Response, next: NextFunction): Promise<void> => {
        const t = tryTokens(heart);
        if (!t) {
            err(res, 500, 'internal', 'Token handler unavailable.');
            return;
        }

        const raw = req.header('X-Dash-Session');
        if (!raw) {
            err(res, 401, 'unauthorized', heart.assets.lang.get(heart.id, 'errors.unauthorized'));
            return;
        }

        try {
            req.dashSession = await t.verify(raw);
            next();
        } catch (e) {
            if (e instanceof TokenError) {
                if (e.tokenCode === 'TOKEN_REVOKED' || e.code === 'TOKEN.TOKEN_REVOKED') {
                    err(res, 401, 'rotation_detected', heart.assets.lang.get(heart.id, 'errors.rotationDetected'));
                    return;
                }
                if (e.tokenCode === 'TOKEN_EXPIRED' || e.code === 'TOKEN.TOKEN_EXPIRED') {
                    err(res, 401, 'session_expired', heart.assets.lang.get(heart.id, 'errors.sessionExpired'));
                    return;
                }
                err(res, 401, e.code, e.userMessage);
                return;
            }
            err(res, 401, 'session_expired', heart.assets.lang.get(heart.id, 'errors.sessionExpired'));
        }
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

                const actor = await resolveActorPermissions(verified.payload.userId, guildId);
                if (actor.resolved.botOwner || actor.resolved.bits.has(BOT_OWNER_BIT)) {
                    next();
                    return;
                }
                if (crossServerBit && actor.resolved.bits.has(crossServerBit)) {
                    next();
                    return;
                }

                const tokenGuild = verified.payload.guildId;
                if (tokenGuild && tokenGuild !== guildId) {

                    sendAuthzFailure(res, heart, 'forbidden');
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
