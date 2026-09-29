/**
 * Dashboard routing intent helper — consumes existing Cross-Host affinity + shard map.
 * Does not create a second routing authority.
 */

import { shardIdForGuild } from '#core/crosshost/gateway/affinity.js';
import type {
    GuildRouteResolution,
    RouteResolutionResult,
    RoutingContext,
} from '#core/types/routingContext.js';

export interface ShardOwnerLookup {
    ownerOf(shardId: number): string | undefined;
}

export interface RoutingIntentDeps {
    totalShards: number;
    shardMap: ShardOwnerLookup;
    /** Optional membership generation when available. */
    routingGeneration?: number;
}

/**
 * Resolve guild → shard → worker using authoritative Cross-Host primitives.
 */
export function resolveGuildRoute(
    guildId: string,
    deps: RoutingIntentDeps,
): RouteResolutionResult {
    if (!guildId || typeof guildId !== 'string') {
        return { ok: false, code: 'BAD_GUILD', message: 'Invalid guildId' };
    }
    if (!deps.totalShards || deps.totalShards < 1) {
        return { ok: false, code: 'CROSSHOST_DISABLED', message: 'totalShards not available' };
    }

    let shardId: number;
    try {
        shardId = shardIdForGuild(guildId, deps.totalShards);
    } catch {
        return { ok: false, code: 'BAD_GUILD', message: 'Invalid guildId for shard affinity' };
    }

    const workerId = deps.shardMap.ownerOf(shardId);
    if (!workerId) {
        return {
            ok: false,
            code: 'NO_OWNER',
            message: `No worker owns shard ${shardId}`,
        };
    }

    const route: GuildRouteResolution = {
        guildId,
        shardId,
        workerId,
        totalShards: deps.totalShards,
        resolvedAt: Math.floor(Date.now() / 1000),
    };
    return { ok: true, route };
}

/**
 * Capture a RoutingContext at resolve time. Call assertRouteStillValid before
 * relying on a long-lived handle after awaits.
 */
export function toRoutingContext(route: GuildRouteResolution, generation?: number): RoutingContext {
    return {
        kind: 'guild',
        requestedGuildId: route.guildId,
        resolvedGuildId: route.guildId,
        resolvedShardId: route.shardId,
        resolvedWorkerId: route.workerId,
        totalShards: route.totalShards,
        routingGeneration: generation,
        confidence: 'resolved',
        resolvedAt: route.resolvedAt,
        stale: false,
    };
}

/**
 * Re-check ownership after a delay / await. Smallest Phase 1 stale-route guard.
 */
export function assertRouteStillValid(
    captured: GuildRouteResolution,
    shardMap: ShardOwnerLookup,
): { ok: true } | { ok: false; code: 'STALE_ROUTE'; message: string } {
    const owner = shardMap.ownerOf(captured.shardId);
    if (!owner) {
        return { ok: false, code: 'STALE_ROUTE', message: `Shard ${captured.shardId} has no owner` };
    }
    if (owner !== captured.workerId) {
        return {
            ok: false,
            code: 'STALE_ROUTE',
            message: `Shard ${captured.shardId} moved from ${captured.workerId} to ${owner}`,
        };
    }
    return { ok: true };
}
