/**
 * Canonical ResolvedPermissions construction for Dashboard realtime/authz helpers.
 * Matches src/core/types/permissions.ts — no incomplete objects, no casts.
 */

import type { ResolvedPermissions } from '#core/types/permissions.js';
import type { RealtimeActor } from './subscriptionAuthz.js';

export function makeResolvedPermissions(input: {
    readonly bits?: Iterable<string>;
    readonly botOwner?: boolean;
    readonly guildId?: string;
    readonly resolvedAt?: number;
}): ResolvedPermissions {
    return {
        botOwner: input.botOwner === true,
        bits: new Set(input.bits ?? []),
        guildId: input.guildId,
        resolvedAt: input.resolvedAt ?? Date.now(),
    };
}

export function makeRealtimeActor(input: {
    readonly userId: string;
    readonly isEnvOwner?: boolean;
    readonly bits?: Iterable<string>;
    readonly botOwner?: boolean;
    readonly guildId?: string;
    readonly resolvedAt?: number;
}): RealtimeActor {
    return {
        userId: input.userId,
        isEnvOwner: input.isEnvOwner === true,
        resolved: makeResolvedPermissions({
            bits: input.bits,
            botOwner: input.botOwner === true || input.isEnvOwner === true,
            guildId: input.guildId,
            resolvedAt: input.resolvedAt,
        }),
    };
}

/** Explicit deny snapshot after permission revocation / failed refresh. */
export function makeDeniedRealtimeActor(userId: string): RealtimeActor {
    return makeRealtimeActor({
        userId,
        isEnvOwner: false,
        bits: [],
        botOwner: false,
    });
}
