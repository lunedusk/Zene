/**
 * Phase 4 — Cross-Host Dashboard request forwarder.
 * Forwards guild-scoped operations to the owning worker; never trusts client worker selection.
 */

import {
    resolveDataPlaneRoute,
    revalidateAfterAwait,
    shouldRetryOnStale,
    type DataPlaneRequest,
} from './crossHostDataPlane.js';
import type { ResourceRouterDeps } from '#core/crosshost/resourceRouter.js';

export interface ForwardHeaders {
    readonly requestId: string;
    readonly correlationId?: string;
    readonly authorizationSubject: string;
    /** Internal service token — never from the browser */
    readonly serviceAuthorization?: string;
}

export interface ForwardRequest {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly path: string;
    readonly body?: unknown;
    readonly timeoutMs?: number;
    readonly dataPlane: DataPlaneRequest;
    readonly headers: ForwardHeaders;
}

export type ForwardResult<T> =
    | { ok: true; data: T; workerId: string; shardId: number; generation: number; local: boolean }
    | {
          ok: false;
          code: string;
          message: string;
          requestId: string;
          httpStatus?: number;
      };

export interface WorkerEndpointResolver {
    /** Resolve workerId → base URL for internal Dashboard API */
    resolveBaseUrl(workerId: string): string | null;
}

export type LocalHandler<T> = () => Promise<T>;

/**
 * Execute a guild-scoped operation locally or forward to the owning worker.
 * Non-idempotent mutations are not auto-retried on STALE_ROUTE.
 */
export async function executeOnOwningWorker<T>(
    input: ForwardRequest,
    deps: ResourceRouterDeps,
    localWorkerId: string,
    endpoints: WorkerEndpointResolver,
    localHandler: LocalHandler<T>,
): Promise<ForwardResult<T>> {
    const resolved = resolveDataPlaneRoute(input.dataPlane, deps, localWorkerId);
    if (!resolved.ok) {
        return {
            ok: false,
            code: resolved.code,
            message: resolved.message,
            requestId: input.headers.requestId,
        };
    }

    if (resolved.resolved.local) {
        try {
            const data = await localHandler();
            const reval = revalidateAfterAwait(resolved.resolved.route, deps, input.headers.requestId);
            if (!reval.ok) {
                if (shouldRetryOnStale(input.dataPlane)) {
                    // One safe re-resolve for reads / idempotent ops
                    const again = resolveDataPlaneRoute(input.dataPlane, deps, localWorkerId);
                    if (again.ok && again.resolved.local) {
                        const data2 = await localHandler();
                        return {
                            ok: true,
                            data: data2,
                            workerId: again.resolved.workerId,
                            shardId: again.resolved.shardId,
                            generation: again.resolved.generation,
                            local: true,
                        };
                    }
                }
                return {
                    ok: false,
                    code: reval.code,
                    message: reval.message,
                    requestId: input.headers.requestId,
                };
            }
            return {
                ok: true,
                data,
                workerId: resolved.resolved.workerId,
                shardId: resolved.resolved.shardId,
                generation: resolved.resolved.generation,
                local: true,
            };
        } catch (e) {
            return {
                ok: false,
                code: 'REMOTE_ERROR',
                message: e instanceof Error ? e.message : 'local_handler_failed',
                requestId: input.headers.requestId,
            };
        }
    }

    const base = endpoints.resolveBaseUrl(resolved.resolved.workerId);
    if (!base) {
        return {
            ok: false,
            code: 'WORKER_UNAVAILABLE',
            message: `No endpoint for worker ${resolved.resolved.workerId}`,
            requestId: input.headers.requestId,
        };
    }

    const url = `${base.replace(/\/$/, '')}${input.path.startsWith('/') ? input.path : `/${input.path}`}`;
    const timeoutMs = input.timeoutMs ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: input.method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Request-Id': input.headers.requestId,
                ...(input.headers.correlationId
                    ? { 'X-Correlation-Id': input.headers.correlationId }
                    : {}),
                'X-Auth-Subject': input.headers.authorizationSubject,
                'X-Routing-Generation': String(resolved.resolved.generation),
                'X-Routing-Shard': String(resolved.resolved.shardId),
                ...(input.headers.serviceAuthorization
                    ? { Authorization: input.headers.serviceAuthorization }
                    : {}),
            },
            body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
            return {
                ok: false,
                code: 'REMOTE_ERROR',
                message: `worker ${resolved.resolved.workerId} returned ${res.status}`,
                requestId: input.headers.requestId,
                httpStatus: res.status,
            };
        }
        const data = (await res.json()) as T;
        return {
            ok: true,
            data,
            workerId: resolved.resolved.workerId,
            shardId: resolved.resolved.shardId,
            generation: resolved.resolved.generation,
            local: false,
        };
    } catch (e) {
        clearTimeout(timer);
        const aborted = e instanceof Error && e.name === 'AbortError';
        return {
            ok: false,
            code: aborted ? 'TIMEOUT' : 'REMOTE_ERROR',
            message: e instanceof Error ? e.message : 'forward_failed',
            requestId: input.headers.requestId,
        };
    }
}

/**
 * Reject client-supplied worker/shard ownership claims.
 * Routing always uses ShardMap — these headers are diagnostic only.
 */
export function assertNoClientWorkerAuthority(headers: Record<string, string | string[] | undefined>): {
    ok: true;
} | { ok: false; code: 'CLIENT_WORKER_SPOOF'; message: string } {
    const forbidden = ['x-worker-id', 'x-shard-owner', 'x-force-worker', 'x-target-worker'];
    for (const h of forbidden) {
        if (headers[h] !== undefined) {
            return {
                ok: false,
                code: 'CLIENT_WORKER_SPOOF',
                message: `Client must not select worker via ${h}`,
            };
        }
    }
    return { ok: true };
}
