





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
