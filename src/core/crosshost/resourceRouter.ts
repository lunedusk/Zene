/**
 * Phase 2A — Cross-Host resource routing adapter for Dashboard services.
 * Uses authoritative shardIdForGuild + ShardMap.ownerOf; captures generation; revalidates.
 */

import { shardIdForGuild } from '#core/crosshost/gateway/affinity.js';
import type { RoutingContext } from '#core/types/routingContext.js';

export interface ShardMapLike {
    ownerOf(shardId: number): string | undefined;
    getGeneration?: () => number;
    generation?: number;
}

export interface ResourceRouterDeps {
    totalShards: number;
    shardMap: ShardMapLike;
}

export type ResourceRouteOk = {
    ok: true;
    guildId: string;
    shardId: number;
    workerId: string;
    generation: number;
    routingContext: RoutingContext;
};

export type ResourceRouteErr = {
    ok: false;
    code: 'BAD_GUILD' | 'NO_OWNER' | 'CROSSHOST_DISABLED' | 'STALE_ROUTE';
    message: string;
};

/**
 * Resolve guild → shard → worker and capture generation for later revalidation.
 */
export function resolveResourceRoute(guildId: string, deps: ResourceRouterDeps): ResourceRouteOk | ResourceRouteErr {
    if (!guildId || typeof guildId !== 'string') {
        return { ok: false, code: 'BAD_GUILD', message: 'Invalid guildId' };
    }
    if (!deps.totalShards || deps.totalShards < 1) {
        return { ok: false, code: 'CROSSHOST_DISABLED', message: 'totalShards unavailable' };
    }
    let shardId: number;
    try {
        shardId = shardIdForGuild(guildId, deps.totalShards);
    } catch {
        return { ok: false, code: 'BAD_GUILD', message: 'Invalid guildId for affinity' };
    }
    const workerId = deps.shardMap.ownerOf(shardId);
    if (!workerId) {
        return { ok: false, code: 'NO_OWNER', message: `No worker owns shard ${shardId}` };
    }
    const generation =
        typeof deps.shardMap.getGeneration === 'function'
            ? deps.shardMap.getGeneration()
            : typeof deps.shardMap.generation === 'number'
              ? deps.shardMap.generation
              : 0;
    const resolvedAt = Math.floor(Date.now() / 1000);
    const routingContext: RoutingContext = {
        kind: 'guild',
        requestedGuildId: guildId,
        resolvedGuildId: guildId,
        resolvedShardId: shardId,
        resolvedWorkerId: workerId,
        totalShards: deps.totalShards,
        routingGeneration: generation,
        confidence: 'resolved',
        resolvedAt,
        stale: false,
    };
    return { ok: true, guildId, shardId, workerId, generation, routingContext };
}

/**
 * Re-check ownership (and generation when available) after an await.
 * Safe reads may call resolve again on STALE_ROUTE; mutations must not auto-retry side effects.
 */
export function revalidateResourceRoute(
    captured: ResourceRouteOk,
    deps: ResourceRouterDeps,
): { ok: true } | ResourceRouteErr {
    const workerId = deps.shardMap.ownerOf(captured.shardId);
    if (!workerId) {
        return { ok: false, code: 'STALE_ROUTE', message: `Shard ${captured.shardId} has no owner` };
    }
    if (workerId !== captured.workerId) {
        return {
            ok: false,
            code: 'STALE_ROUTE',
            message: `Shard ${captured.shardId} moved from ${captured.workerId} to ${workerId}`,
        };
    }
    if (captured.generation > 0) {
        const currentGen =
            typeof deps.shardMap.getGeneration === 'function'
                ? deps.shardMap.getGeneration()
                : typeof deps.shardMap.generation === 'number'
                  ? deps.shardMap.generation
                  : captured.generation;
        if (currentGen !== captured.generation) {
            return {
                ok: false,
                code: 'STALE_ROUTE',
                message: `Shard map generation changed ${captured.generation} → ${currentGen}`,
            };
        }
    }
    return { ok: true };
}

/** Classify operation retry policy for Cross-Host failures. */
export type RetryClass = 'safe_read_retry' | 'never_auto_retry';

export function retryClassForMethod(method: string): RetryClass {
    const m = method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'safe_read_retry';
    return 'never_auto_retry';
}
