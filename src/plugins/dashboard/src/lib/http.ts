import { type Request, type Response } from 'express';
import { type IHeart } from '#core/heart/index.js';
import { createHash, randomUUID } from 'node:crypto';

export type AuthzFailureClass = 'unauthenticated' | 'forbidden' | 'hidden';

export const DASH_ERROR_CODES = {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    AUTH_INVALID: 'AUTH_INVALID',
    AUTH_EXPIRED: 'AUTH_EXPIRED',
    SUDO_REQUIRED: 'SUDO_REQUIRED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CAPABILITY_REQUIRED: 'CAPABILITY_REQUIRED',
    OWNER_REQUIRED: 'OWNER_REQUIRED',
    GUILD_ACCESS_REQUIRED: 'GUILD_ACCESS_REQUIRED',
    VERSION_CONFLICT: 'VERSION_CONFLICT',
    IDEMPOTENCY_REPLAY: 'IDEMPOTENCY_REPLAY',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
    PLUGIN_UNAVAILABLE: 'PLUGIN_UNAVAILABLE',
    WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
    SHARD_UNAVAILABLE: 'SHARD_UNAVAILABLE',
    CROSSHOST_DISABLED: 'CROSSHOST_DISABLED',
    STALE_ROUTE: 'STALE_ROUTE',
    DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    GATEWAY_UNAVAILABLE: 'GATEWAY_UNAVAILABLE',
} as const;

export type DashErrorCode = (typeof DASH_ERROR_CODES)[keyof typeof DASH_ERROR_CODES];

export type CacheClass =
    | 'public'
    | 'private-user'
    | 'private-guild'
    | 'private-owner'
    | 'sensitive'
    | 'no-store';

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export interface ApiMeta {
    requestId?: string;
    [key: string]: unknown;
}

export function ok(res: Response, data: unknown, status = 200, meta?: ApiMeta): void {
    const requestId =
        meta?.requestId ??
        (typeof res.getHeader('x-request-id') === 'string' ? String(res.getHeader('x-request-id')) : undefined);
    const body: { ok: true; data: unknown; meta?: ApiMeta } = { ok: true, data };
    if (requestId || meta) {
        body.meta = { ...meta, requestId };
    }
    res.status(status).json(body);
}

export function err(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown,
): void {
    const requestId =
        typeof res.getHeader('x-request-id') === 'string' ? String(res.getHeader('x-request-id')) : undefined;
    res.status(status).json({
        ok: false,
        error: { code, message, ...(details !== undefined ? { details } : {}) },
        ...(requestId ? { requestId } : {}),
    });
}


export function assertExpectedVersion(expected: number | undefined, current: number): void {
    if (expected === undefined) return;
    if (expected !== current) {
        throw new HttpError(409, DASH_ERROR_CODES.VERSION_CONFLICT, 'Resource version conflict', {
            expectedVersion: expected,
            currentVersion: current,
        });
    }
}

export interface IdempotencyRecord {
    actorId: string;
    operation: string;
    resourceKey: string;
    idempotencyKey: string;
    requestHash: string;
    result?: unknown;
    jobId?: string;
    expiresAt: number;
}


export function hashIdempotencyPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}






const idempotencyStore = new Map<string, IdempotencyRecord>();

export function idempotencyLookup(options: {
    actorId: string;
    operation: string;
    resourceKey: string;
    idempotencyKey: string;
    requestHash: string;
}): { status: 'miss' } | { status: 'replay'; record: IdempotencyRecord } | { status: 'conflict' } {
    const id = `${options.actorId}:${options.operation}:${options.resourceKey}:${options.idempotencyKey}`;
    const existing = idempotencyStore.get(id);
    if (!existing) return { status: 'miss' };
    if (existing.expiresAt < Date.now()) {
        idempotencyStore.delete(id);
        return { status: 'miss' };
    }
    if (existing.requestHash !== options.requestHash) return { status: 'conflict' };
    return { status: 'replay', record: existing };
}

export function idempotencyStoreResult(
    options: {
        actorId: string;
        operation: string;
        resourceKey: string;
        idempotencyKey: string;
        requestHash: string;
        ttlMs?: number;
    },
    result: unknown,
    jobId?: string,
): void {
    const id = `${options.actorId}:${options.operation}:${options.resourceKey}:${options.idempotencyKey}`;
    idempotencyStore.set(id, {
        actorId: options.actorId,
        operation: options.operation,
        resourceKey: options.resourceKey,
        idempotencyKey: options.idempotencyKey,
        requestHash: options.requestHash,
        result,
        jobId,
        expiresAt: Date.now() + (options.ttlMs ?? 24 * 60 * 60 * 1000),
    });
}


export interface AsyncJobAccepted {
    jobId: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
}

export function newJobId(): string {
    return randomUUID();
}

export function sendHttpError(res: Response, e: unknown, heart: IHeart): void {
    if (e instanceof HttpError) {
        if (e.status === 429 && e.details && typeof (e.details as { retryAfterMs?: number }).retryAfterMs === 'number') {
            res.setHeader('Retry-After', String(Math.ceil((e.details as { retryAfterMs: number }).retryAfterMs / 1000)));
        }
        err(res, e.status, e.code, e.message, e.details);
        return;
    }
    heart.log.error(`Unhandled dashboard route error: ${(e as Error)?.stack ?? e}`);
    err(res, 500, 'internal', heart.assets.lang.get(heart.id, 'errors.internal'));
}

export interface Pagination {
    page: number;
    limit: number;
    offset: number;
}

export function parsePagination(
    req: Request,
    defaults: { defaultLimit: number; maxLimit: number },
): Pagination {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit ?? defaults.defaultLimit), 10);
    const limit = Math.min(
        defaults.maxLimit,
        Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaults.defaultLimit),
    );
    return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, p: Pagination) {
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

export function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}

export function guarded<Req extends Request = Request>(
    heart: IHeart,
    fn: (req: Req, res: Response) => Promise<void>,
) {
    return async (req: Request, res: Response): Promise<void> => {
        try {
            await fn(req as Req, res);
        } catch (e) {
            sendHttpError(res, e, heart);
        }
    };
}


export function sendServiceError(res: Response, e: unknown, heart: IHeart): void {
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'ServiceError') {
        const se = e as {
            code: string;
            message: string;
            httpStatus: number;
            details?: unknown;
            hideExistence?: boolean;
        };
        const status = se.hideExistence ? 404 : se.httpStatus;
        const code = se.hideExistence ? 'not_found' : se.code.toLowerCase();
        err(res, status, code, se.message, se.details);
        return;
    }
    sendHttpError(res, e, heart);
}

export function requireBody<T extends Record<string, unknown>>(
    body: unknown,
    requiredKeys: (keyof T)[],
): T {
    if (!body || typeof body !== 'object') {
        throw new HttpError(400, 'bad_request', 'Request body must be a JSON object.');
    }
    const missing = requiredKeys.filter((k) => (body as Record<string, unknown>)[k as string] === undefined);
    if (missing.length > 0) {
        throw new HttpError(400, 'bad_request', `Missing required field(s): ${missing.join(', ')}`);
    }
    return body as T;
}
