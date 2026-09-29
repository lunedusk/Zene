/**
 * Internal RoutingContext for Dashboard / Cross-Host consumption (Phase 1).
 * Never treat client-supplied worker/shard IDs as authority.
 */

export type RoutingIntentKind =
    | 'global'
    | 'user'
    | 'guild'
    | 'channel'
    | 'shard'
    | 'worker'
    | 'fleet';

export type RoutingConfidence = 'resolved' | 'partial' | 'unknown' | 'unavailable';

/**
 * Requested selectors (untrusted) vs resolved ownership (authoritative).
 */
export interface RoutingContext {
    readonly kind: RoutingIntentKind;
    /** Untrusted client/resource selector. */
    readonly requestedGuildId?: string;
    readonly requestedShardId?: number;
    readonly requestedWorkerId?: string;
    readonly requestedChannelId?: string;
    readonly requestedUserId?: string;

    /** Authoritative resolution from Cross-Host / affinity. */
    readonly resolvedGuildId?: string;
    readonly resolvedShardId?: number;
    readonly resolvedWorkerId?: string;
    readonly totalShards?: number;

    /**
     * Membership/control-plane generation when known.
     * Not all paths expose generation today; may be undefined.
     */
    readonly routingGeneration?: number;

    readonly confidence: RoutingConfidence;
    readonly resolvedAt: number;
    readonly stale?: boolean;
}

export interface GuildRouteResolution {
    readonly guildId: string;
    readonly shardId: number;
    readonly workerId: string;
    readonly totalShards: number;
    readonly resolvedAt: number;
}

export type RouteResolutionResult =
    | { ok: true; route: GuildRouteResolution }
    | { ok: false; code: 'BAD_GUILD' | 'NO_OWNER' | 'NO_WORKER' | 'CROSSHOST_DISABLED'; message: string };
