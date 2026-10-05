/**
 * Phase 4 — Dashboard Cross-Host data-plane helper.
 * Uses authoritative resolveResourceRoute / revalidateResourceRoute.
 * Clients never select workers.
 */

import {
    resolveResourceRoute,
    revalidateResourceRoute,
    type ResourceRouterDeps,
    type ResourceRouteOk,
    type ResourceRouteErr,
} from '#core/crosshost/resourceRouter.js';

export type DataPlaneOperation = 'read' | 'mutate';

export interface DataPlaneRequest {
    readonly guildId: string;
    readonly operation: DataPlaneOperation;
    readonly requestId: string;
    /** Idempotent mutations may be safely retried once after STALE_ROUTE */
    readonly idempotent?: boolean;
}

export interface DataPlaneResolved {
    readonly route: ResourceRouteOk;
    readonly local: boolean;
    readonly workerId: string;
    readonly shardId: number;
    readonly generation: number;
}

export type DataPlaneError = {
    readonly ok: false;
    readonly code: ResourceRouteErr['code'] | 'TIMEOUT' | 'REMOTE_ERROR' | 'CANCELLED';
    readonly message: string;
    readonly requestId: string;
};

/**
 * Resolve where a guild-scoped Dashboard resource lives.
 * `localWorkerId` compares to route.workerId to decide local vs forward.
 */
export function resolveDataPlaneRoute(
    req: DataPlaneRequest,
    deps: ResourceRouterDeps,
    localWorkerId: string,
): { ok: true; resolved: DataPlaneResolved } | DataPlaneError {
    const route = resolveResourceRoute(req.guildId, deps);
    if (!route.ok) {
        return { ok: false, code: route.code, message: route.message, requestId: req.requestId };
    }
    return {
        ok: true,
        resolved: {
            route,
            local: route.workerId === localWorkerId,
            workerId: route.workerId,
            shardId: route.shardId,
            generation: route.generation,
        },
    };
}

/**
 * After an await, revalidate before applying mutation results.
 * Mutating non-idempotent ops must NOT auto-retry side effects on STALE_ROUTE.
 */
export function revalidateAfterAwait(
    captured: ResourceRouteOk,
    deps: ResourceRouterDeps,
    requestId: string,
): { ok: true } | DataPlaneError {
    const v = revalidateResourceRoute(captured, deps);
    if (v.ok) return { ok: true };
    return { ok: false, code: v.code, message: v.message, requestId };
}

export function shouldRetryOnStale(req: DataPlaneRequest): boolean {
    return req.operation === 'read' || req.idempotent === true;
}
