/**
 * Actor capability resolver — Phase 1.
 * Uses PermissionsManager + hierarchy; does not create a second permission store.
 */

import {
    type ActorCapabilityId,
    type AuthorizationActor,
    type AuthorizationContext,
    type AuthorizationDecision,
    type AuthorizationResource,
    type AuthorizationTarget,
    type CapabilityDefinition,
    getCapabilityDefinition,
} from '#core/types/capabilities.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import { canActOnMember, isEnvBotOwner } from '#core/permissions/hierarchy.js';
import { permissionsManager } from '#core/manager/permissions.js';

function bitsSatisfy(
    resolved: ResolvedPermissions,
    def: CapabilityDefinition,
): boolean {
    if (resolved.botOwner || resolved.bits.has('bot.owner')) return true;
    const required = def.requiredBits;
    if (required.length === 0) return true;
    if (def.bitMode === 'any') {
        return required.some((b) => resolved.bits.has(b));
    }
    return required.every((b) => resolved.bits.has(b));
}

function scopeAllows(def: CapabilityDefinition, resource?: AuthorizationResource): boolean {
    if (def.authorityScope === 'bot' || def.authorityScope === 'any') {
        return true;
    }
    if (def.authorityScope === 'server') {
        return resource?.kind === 'guild' || resource?.kind === 'member' || !!resource?.guildId;
    }
    if (def.authorityScope === 'plugin') {
        return resource?.kind === 'plugin' || !!resource?.pluginId;
    }
    return true;
}

/**
 * Evaluate whether the actor may exercise a capability in context.
 * Client-supplied capability lists / owner flags are never read here.
 */
export function evaluateCapability(ctx: AuthorizationContext): AuthorizationDecision {
    const def = getCapabilityDefinition(ctx.capabilityId);
    if (!def) {
        return {
            allowed: false,
            code: 'CAPABILITY_UNKNOWN',
            reason: `Unknown capability: ${ctx.capabilityId}`,
            capabilityId: ctx.capabilityId,
            hideExistence: false,
        };
    }

    if (!bitsSatisfy(ctx.actor.resolved, def)) {
        return {
            allowed: false,
            code: 'BITS_MISSING',
            reason: 'Required permission bits not present',
            capabilityId: def.id,
            hideExistence: def.access === 'admin' || def.resourceType === 'fleet' || def.resourceType === 'worker',
        };
    }

    if (!scopeAllows(def, ctx.resource)) {
        return {
            allowed: false,
            code: 'SCOPE_MISMATCH',
            reason: 'Capability scope does not match resource',
            capabilityId: def.id,
            hideExistence: false,
        };
    }




    if (def.requiresTargetHierarchy && def.targetType === 'member' && ctx.target) {
        const target = ctx.target;
        if (!target.id || !target.resolved) {
            return {
                allowed: false,
                code: 'RESOURCE_UNRESOLVED',
                reason: 'Target member permissions unresolved',
                capabilityId: def.id,
                hideExistence: false,
            };
        }
        const decision = canActOnMember({
            actorUserId: ctx.actor.userId,
            targetUserId: target.id,
            actor: ctx.actor.resolved,
            target: target.resolved,
            scope: def.authorityScope === 'server' ? 'server' : 'any',
        });
        if (!decision.allowed) {
            return {
                allowed: false,
                code: decision.code === 'env_owner_protected' || decision.code === 'target_rank_too_high'
                    ? 'TARGET_PROTECTED'
                    : 'TARGET_HIERARCHY',
                reason: decision.code ?? 'hierarchy_denied',
                capabilityId: def.id,
                hideExistence: false,
            };
        }
    }

    return {
        allowed: true,
        capabilityId: def.id,
        hideExistence: false,
    };
}

/**
 * Resolve actor permissions from the authoritative PermissionsManager cache.
 * Prefer this over token-embedded bits for sensitive decisions.
 */
export async function resolveActorPermissions(
    userId: string,
    guildId?: string,
): Promise<AuthorizationActor> {
    const isEnvOwner = isEnvBotOwner(userId);
    if (!permissionsManager) {
        return {
            userId,
            isEnvOwner,
            resolved: {
                botOwner: isEnvOwner,
                bits: isEnvOwner ? new Set<string>(['bot.owner']) : new Set<string>(),
                guildId,
                resolvedAt: Math.floor(Date.now() / 1000),
            },
        };
    }
    const resolved = await permissionsManager.cachedResolve(userId, guildId);
    return {
        userId,
        isEnvOwner,
        resolved,
    };
}

/**
 * Check a capability using fresh permission resolution (not token bits alone).
 */
export async function authorizeCapability(options: {
    userId: string;
    capabilityId: ActorCapabilityId;
    guildId?: string;
    resource?: AuthorizationResource;
    target?: AuthorizationTarget;
    requestId?: string;
}): Promise<AuthorizationDecision> {
    const actor = await resolveActorPermissions(options.userId, options.guildId);
    return evaluateCapability({
        actor,
        capabilityId: options.capabilityId,
        resource: options.resource,
        target: options.target,
        requestId: options.requestId,
    });
}

/**
 * Pure helper: does resolved bits satisfy a capability definition (no hierarchy).
 * Used for registry projection and SSE filters where no target is involved.
 */
export function capabilitySatisfiedByBits(
    capabilityId: ActorCapabilityId | string,
    resolved: ResolvedPermissions,
): boolean {
    const def = getCapabilityDefinition(capabilityId);
    if (!def) return false;
    return bitsSatisfy(resolved, def);
}

export function definitionRequiresHierarchy(capabilityId: string): boolean {
    return getCapabilityDefinition(capabilityId)?.requiresTargetHierarchy === true;
}

export type { CapabilityDefinition, ActorCapabilityId, AuthorizationDecision, AuthorizationContext };
