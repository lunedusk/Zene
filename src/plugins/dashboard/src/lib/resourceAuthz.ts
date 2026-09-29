/**
 * Phase 2A — reusable resource authorization helpers on top of Phase 1 capabilities.
 */

import type { ActorCapabilityId } from '#core/types/capabilities.js';
import { evaluateCapability, resolveActorPermissions } from '#core/permissions/capabilities.js';
import { canActOnMember } from '#core/permissions/hierarchy.js';
import type { RequestContext, ResourceRef } from './requestContext.js';
import { ServiceError } from './requestContext.js';

export async function assertCapability(
    ctx: RequestContext,
    capabilityId: ActorCapabilityId,
    resource?: ResourceRef,
): Promise<void> {
    const decision = evaluateCapability({
        actor: ctx.actor,
        capabilityId,
        resource: resource
            ? {
                  kind: resource.kind === 'none' ? 'none' : resource.kind,
                  id: resource.id,
                  guildId: resource.guildId ?? ctx.guildId,
                  pluginId: resource.pluginId,
                  workerId: resource.workerId,
                  shardId: resource.shardId,
              }
            : ctx.resource
              ? {
                    kind: ctx.resource.kind === 'none' ? 'none' : ctx.resource.kind,
                    id: ctx.resource.id,
                    guildId: ctx.resource.guildId ?? ctx.guildId,
                    pluginId: ctx.resource.pluginId,
                    workerId: ctx.resource.workerId,
                    shardId: ctx.resource.shardId,
                }
              : undefined,
        requestId: ctx.requestId,
    });
    if (decision.allowed) return;
    if (decision.hideExistence) {
        throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
    }
    throw new ServiceError('FORBIDDEN', decision.reason ?? 'Forbidden', 403, { code: decision.code });
}

/**
 * Target hierarchy for member-sensitive mutations.
 */
export async function assertMemberTarget(
    ctx: RequestContext,
    targetUserId: string,
    guildId?: string,
): Promise<void> {
    if (ctx.actor.userId === targetUserId) {
        throw new ServiceError('FORBIDDEN', 'Cannot act on yourself', 403);
    }
    const target = await resolveActorPermissions(targetUserId, guildId ?? ctx.guildId);
    const decision = canActOnMember({
        actorUserId: ctx.actor.userId,
        targetUserId,
        actor: ctx.actor.resolved,
        target: target.resolved,
        scope: guildId || ctx.guildId ? 'server' : 'any',
    });
    if (!decision.allowed) {
        throw new ServiceError('FORBIDDEN', decision.code ?? 'hierarchy_denied', 403);
    }
}

export function assertGuildScope(ctx: RequestContext, guildId: string): void {
    // Client-supplied guildId is a selector; capability/bits must already authorize server ops.
    // Scoped session tokens for a different guild cannot pivot.
    const tokenGuild = ctx.session.payload.guildId;
    if (tokenGuild && tokenGuild !== guildId) {
        throw new ServiceError('FORBIDDEN', 'Session guild scope mismatch', 403);
    }
}
