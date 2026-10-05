



import type { VerifiedToken } from '#core/manager/token.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import type { RoutingContext } from '#core/types/routingContext.js';
import type { ActorCapabilityId } from '#core/types/capabilities.js';
import type { DashRequest } from './authz.js';
import { resolveActorPermissions } from '#core/permissions/capabilities.js';
import { isEnvBotOwner } from '#core/permissions/hierarchy.js';

export interface ActorContext {
    readonly userId: string;
    readonly isEnvOwner: boolean;
    readonly resolved: ResolvedPermissions;
}

export interface ResourceRef {
    readonly kind:
        | 'guild'
        | 'member'
        | 'plugin'
        | 'worker'
        | 'shard'
        | 'surface'
        | 'layout'
        | 'theme'
        | 'fleet'
        | 'none';
    readonly id?: string;
    readonly guildId?: string;
    readonly pluginId?: string;
    readonly surfaceId?: string;
    readonly workerId?: string;
    readonly shardId?: number;
}

export interface RequestContext {
    readonly requestId: string;
    readonly correlationId?: string;
    readonly startedAt: number;
    readonly session: VerifiedToken;
    readonly actor: ActorContext;
    readonly guildId?: string;
    readonly resource?: ResourceRef;
    readonly route?: RoutingContext;
    readonly capabilityId?: ActorCapabilityId;
}

export type ServiceErrorCode =
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'VALIDATION'
    | 'CONFLICT'
    | 'VERSION_CONFLICT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'STALE_ROUTE'
    | 'WORKER_UNAVAILABLE'
    | 'CROSSHOST_DISABLED'
    | 'UNAVAILABLE'
    | 'INTERNAL';

export class ServiceError extends Error {
    constructor(
        public readonly code: ServiceErrorCode,
        message: string,
        public readonly httpStatus: number,
        public readonly details?: unknown,
        public readonly hideExistence = false,
    ) {
        super(message);
        this.name = 'ServiceError';
    }
}

export type ServiceResult<T> =
    | { ok: true; data: T; meta?: Record<string, unknown> }
    | { ok: false; error: ServiceError };

export function serviceOk<T>(data: T, meta?: Record<string, unknown>): ServiceResult<T> {
    return meta ? { ok: true, data, meta } : { ok: true, data };
}


export function unwrapServiceResult<T>(result: ServiceResult<T>): T {
    if (!result.ok) {
        throw result.error;
    }
    return result.data;
}

export function serviceFail(
    code: ServiceErrorCode,
    message: string,
    httpStatus: number,
    details?: unknown,
    hideExistence = false,
): ServiceResult<never> {
    return { ok: false, error: new ServiceError(code, message, httpStatus, details, hideExistence) };
}

export interface PageParams {
    readonly page: number;
    readonly limit: number;
    readonly offset: number;
}

export interface PageResult<T> {
    readonly items: T[];
    readonly pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export function toPageResult<T>(items: T[], total: number, p: PageParams): PageResult<T> {
    return {
        items,
        pagination: {
            page: p.page,
            limit: p.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / p.limit)),
        },
    };
}





export async function buildRequestContext(
    req: DashRequest,
    options?: {
        guildId?: string;
        resource?: ResourceRef;
        capabilityId?: ActorCapabilityId;
        route?: RoutingContext;
    },
): Promise<RequestContext> {
    const session = req.dashSession;
    if (!session) {
        throw new ServiceError('UNAUTHENTICATED', 'Session required', 401);
    }
    const userId = session.payload.userId;
    const guildId = options?.guildId;
    const actorResolved = await resolveActorPermissions(userId, guildId);
    const requestId =
        req.requestId ??
        (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined) ??
        cryptoRandomId();
    const correlationRaw = req.headers['x-correlation-id'];
    const correlationId = typeof correlationRaw === 'string' ? correlationRaw : undefined;

    return {
        requestId,
        correlationId,
        startedAt: Math.floor(Date.now() / 1000),
        session,
        actor: {
            userId,
            isEnvOwner: actorResolved.isEnvOwner || isEnvBotOwner(userId),
            resolved: actorResolved.resolved,
        },
        guildId,
        resource: options?.resource,
        route: options?.route,
        capabilityId: options?.capabilityId,
    };
}

function cryptoRandomId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    try {

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('node:crypto') as { randomUUID: () => string };
        return nodeCrypto.randomUUID();
    } catch {
        return `req_${Date.now().toString(36)}_${process.hrtime.bigint().toString(36)}`;
    }
}
