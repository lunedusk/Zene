/**
 * Phase 4 — Production binding: PermissionsManager invalidation → realtime actor refresh.
 */

import type { ResolvedPermissions } from '#core/types/permissions.js';
import {
    bumpRealtimeAuthRevision,
    setRealtimeActorRefresh,
} from './broker.js';
import { makeRealtimeActor, makeDeniedRealtimeActor } from './resolvedPermissionsFactory.js';

export type PermissionsResolveFn = (
    userId: string,
    guildId?: string,
) => Promise<ResolvedPermissions | null>;

export type PermissionsInvalidateHooks = {
    /** Wrap existing invalidateUser to also bump realtime auth revision */
    onUserInvalidated?: (userId: string, guildId?: string) => void;
};

let bound = false;
let resolveFn: PermissionsResolveFn | null = null;

/**
 * Install actor refresh that calls the authoritative PermissionsManager resolve path.
 * Call once during dashboard enable after permissions handler is available.
 */
export function bindRealtimeActorRefreshToPermissions(resolve: PermissionsResolveFn): void {
    resolveFn = resolve;
    setRealtimeActorRefresh(async (userId) => {
        try {
            const resolved = await resolve(userId);
            if (!resolved) return makeDeniedRealtimeActor(userId);
            return makeRealtimeActor({
                userId,
                isEnvOwner: false,
                bits: resolved.bits,
                botOwner: resolved.botOwner,
                guildId: resolved.guildId,
                resolvedAt: resolved.resolvedAt,
            });
        } catch {
            return makeDeniedRealtimeActor(userId);
        }
    });
    bound = true;
}

export function unbindRealtimeActorRefreshFromPermissions(): void {
    resolveFn = null;
    setRealtimeActorRefresh(null);
    bound = false;
}

export function isRealtimePermissionsBound(): boolean {
    return bound;
}

/**
 * Notify realtime layer that permissions changed for a user.
 * Must be called after PermissionsManager cache invalidation.
 */
export function notifyRealtimePermissionInvalidation(userId: string, _guildId?: string): void {
    bumpRealtimeAuthRevision();
    void userId;
    void _guildId;
    void resolveFn;
}

/**
 * Wrap a permissions invalidateUser function so realtime auth revision advances.
 */
export function wrapPermissionsInvalidateUser(
    original: (userId: string, guildId?: string) => Promise<void>,
): (userId: string, guildId?: string) => Promise<void> {
    return async (userId, guildId) => {
        await original(userId, guildId);
        notifyRealtimePermissionInvalidation(userId, guildId);
    };
}
