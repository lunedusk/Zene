/**
 * Actor capability model (Phase 1).
 *
 * Distinct from dashboard broker `DashCapability` (ui.resize, storage.get, api.read, …).
 * Semantic capabilities describe platform operations; authorization still flows through
 * Zene permission bits + hierarchy — never a second permission database.
 */

import type { ResolvedPermissions } from '#core/types/permissions.js';

/** Stable semantic capability identifiers (not permission bits). */
export type ActorCapabilityId =
    | 'member.view'
    | 'member.kick'
    | 'member.ban'
    | 'member.mute'
    | 'member.nick'
    | 'member.role'
    | 'member.notes'
    | 'member.history'
    | 'server.view'
    | 'server.manage'
    | 'server.ban'
    | 'server.roles.manage'
    | 'server.lang.manage'
    | 'server.logs.view'
    | 'server.analytics.view'
    | 'plugin.view'
    | 'plugin.manage'
    | 'plugin.reload'
    | 'fleet.view'
    | 'fleet.restart'
    | 'fleet.worker.restart'
    | 'fleet.shard.view'
    | 'fleet.shard.shift'
    | 'crosshost.view'
    | 'crosshost.manage'
    | 'dashboard.theme.manage'
    | 'dashboard.pages.manage'
    | 'dashboard.analytics.view'
    | 'dashboard.registry.diagnostics'
    | 'audit.view'
    | 'audit.export'
    | 'errors.view'
    | 'errors.export'
    | 'tokens.view'
    | 'tokens.manage'
    | 'permissions.view'
    | 'permissions.manage'
    | 'gates.view'
    | 'gates.manage';

export type CapabilityAuthorityScope = 'bot' | 'server' | 'plugin' | 'any';

export type CapabilityResourceType =
    | 'none'
    | 'guild'
    | 'member'
    | 'plugin'
    | 'worker'
    | 'shard'
    | 'fleet'
    | 'surface'
    | 'theme'
    | 'layout';

export type CapabilityTargetType = 'none' | 'member' | 'role' | 'worker' | 'shard' | 'guild' | 'plugin';

export type CapabilityAccess = 'read' | 'write' | 'admin';

export type BitMatchMode = 'all' | 'any';

/**
 * Declarative requirements for a capability.
 * Possession of the capability is not sufficient for target-sensitive ops —
 * hierarchy / protected-target policy must still run when targetType !== 'none'.
 */
export interface CapabilityDefinition {
    readonly id: ActorCapabilityId;
    /** Existing Zene bits that can satisfy this capability (OR/AND via bitMode). */
    readonly requiredBits: readonly string[];
    readonly bitMode: BitMatchMode;
    readonly authorityScope: CapabilityAuthorityScope;
    readonly resourceType: CapabilityResourceType;
    readonly targetType: CapabilityTargetType;
    readonly access: CapabilityAccess;
    /** When true, canActOnMember (or equivalent) must pass for the target. */
    readonly requiresTargetHierarchy: boolean;
    readonly description: string;
}

export type AuthorizationDenyCode =
    | 'UNAUTHENTICATED'
    | 'CAPABILITY_UNKNOWN'
    | 'CAPABILITY_DENIED'
    | 'BITS_MISSING'
    | 'SCOPE_MISMATCH'
    | 'RESOURCE_UNRESOLVED'
    | 'TARGET_HIERARCHY'
    | 'TARGET_PROTECTED'
    | 'STALE_ROUTE'
    | 'CROSSHOST_UNAVAILABLE'
    | 'FORBIDDEN';

export interface AuthorizationDecision {
    readonly allowed: boolean;
    readonly code?: AuthorizationDenyCode;
    readonly reason?: string;
    readonly capabilityId?: ActorCapabilityId;
    /** When existence of the resource must not be disclosed. */
    readonly hideExistence: boolean;
}

export interface AuthorizationActor {
    readonly userId: string;
    readonly resolved: ResolvedPermissions;
    readonly isEnvOwner: boolean;
}

export interface AuthorizationResource {
    readonly kind: CapabilityResourceType;
    readonly id?: string;
    readonly guildId?: string;
    readonly shardId?: number;
    readonly workerId?: string;
    readonly pluginId?: string;
}

export interface AuthorizationTarget {
    readonly kind: CapabilityTargetType;
    readonly id?: string;
    readonly resolved?: ResolvedPermissions;
}

export interface AuthorizationContext {
    readonly actor: AuthorizationActor;
    readonly capabilityId: ActorCapabilityId;
    readonly resource?: AuthorizationResource;
    readonly target?: AuthorizationTarget;
    /** Untrusted client selectors must never be copied here as authority. */
    readonly requestId?: string;
}

/** Built-in capability catalog — explicit; no implicit inheritance between IDs. */
export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
    {
        id: 'member.view',
        requiredBits: ['bot.members.view', 'server.members.view'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View member information',
    },
    {
        id: 'member.kick',
        requiredBits: ['bot.members.kick', 'server.members.kick'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'member',
        access: 'write',
        requiresTargetHierarchy: true,
        description: 'Kick a member',
    },
    {
        id: 'member.ban',
        requiredBits: ['bot.members.ban', 'server.members.ban', 'bot.members.ban_global'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'member',
        access: 'write',
        requiresTargetHierarchy: true,
        description: 'Ban a member',
    },
    {
        id: 'member.mute',
        requiredBits: ['bot.members.mute', 'server.members.mute'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'member',
        access: 'write',
        requiresTargetHierarchy: true,
        description: 'Timeout a member',
    },
    {
        id: 'member.nick',
        requiredBits: ['bot.members.nick', 'server.members.nick'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'member',
        access: 'write',
        requiresTargetHierarchy: true,
        description: 'Change member nickname',
    },
    {
        id: 'member.role',
        requiredBits: ['bot.members.role', 'server.members.role'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'member',
        access: 'write',
        requiresTargetHierarchy: true,
        description: 'Assign or remove roles on a member',
    },
    {
        id: 'member.notes',
        requiredBits: ['server.members.notes', 'plugin.dashboard.members.notes'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'member',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'View or add member notes',
    },
    {
        id: 'member.history',
        requiredBits: ['server.members.history'],
        bitMode: 'any',
        authorityScope: 'server',
        resourceType: 'member',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View member infraction history',
    },
    {
        id: 'server.view',
        requiredBits: ['bot.servers.view', 'server.config.view'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'guild',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View server / bot server list',
    },
    {
        id: 'server.manage',
        requiredBits: ['bot.servers.manage', 'server.config.manage'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'guild',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'Manage server configuration',
    },
    {
        id: 'server.ban',
        requiredBits: ['bot.servers.ban'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'guild',
        targetType: 'guild',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Force-ban a server and leave',
    },
    {
        id: 'server.roles.manage',
        requiredBits: ['server.roles.manage', 'bot.roles.manage'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'guild',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'Manage dashboard permission roles',
    },
    {
        id: 'server.lang.manage',
        requiredBits: ['server.lang.manage'],
        bitMode: 'all',
        authorityScope: 'server',
        resourceType: 'guild',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'Manage server language overrides',
    },
    {
        id: 'server.logs.view',
        requiredBits: ['server.logs.view', 'bot.logs.view'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'guild',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View logs',
    },
    {
        id: 'server.analytics.view',
        requiredBits: ['server.analytics.view', 'bot.analytics.view'],
        bitMode: 'any',
        authorityScope: 'any',
        resourceType: 'guild',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View analytics',
    },
    {
        id: 'plugin.view',
        requiredBits: ['bot.plugins.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'plugin',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View plugins',
    },
    {
        id: 'plugin.manage',
        requiredBits: ['bot.plugins.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'plugin',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'Manage plugin configuration',
    },
    {
        id: 'plugin.reload',
        requiredBits: ['bot.plugins.reload'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'plugin',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Hot-reload a plugin',
    },
    {
        id: 'fleet.view',
        requiredBits: ['bot.fleet.view', 'bot.crosshost.view'],
        bitMode: 'any',
        authorityScope: 'bot',
        resourceType: 'fleet',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View Cross-Host fleet',
    },
    {
        id: 'fleet.restart',
        requiredBits: ['bot.fleet.restart'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'fleet',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Restart the fleet',
    },
    {
        id: 'fleet.worker.restart',
        requiredBits: ['bot.worker.restart'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'worker',
        targetType: 'worker',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Restart a specific worker',
    },
    {
        id: 'fleet.shard.view',
        requiredBits: ['bot.shard.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'shard',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View shard map',
    },
    {
        id: 'fleet.shard.shift',
        requiredBits: ['bot.shard.shift'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'shard',
        targetType: 'shard',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Manual shard reassignment',
    },
    {
        id: 'crosshost.view',
        requiredBits: ['bot.crosshost.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'fleet',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View Cross-Host control plane',
    },
    {
        id: 'crosshost.manage',
        requiredBits: ['bot.crosshost.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'fleet',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Mutating Cross-Host control',
    },
    {
        id: 'dashboard.theme.manage',
        requiredBits: ['bot.theme.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'theme',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'Manage dashboard theme',
    },
    {
        id: 'dashboard.pages.manage',
        requiredBits: ['bot.dash.pages.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'layout',
        targetType: 'none',
        access: 'write',
        requiresTargetHierarchy: false,
        description: 'Manage dashboard landing pages',
    },
    {
        id: 'dashboard.analytics.view',
        requiredBits: ['bot.analytics.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View dashboard analytics',
    },
    {
        id: 'dashboard.registry.diagnostics',
        requiredBits: ['bot.owner', 'bot.plugins.view'],
        bitMode: 'any',
        authorityScope: 'bot',
        resourceType: 'surface',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'View registry diagnostics (blocked reasons, internal fields)',
    },
    {
        id: 'audit.view',
        requiredBits: ['bot.audit.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View audit registry',
    },
    {
        id: 'audit.export',
        requiredBits: ['bot.audit.export'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'Export audit data',
    },
    {
        id: 'errors.view',
        requiredBits: ['bot.errors.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View error registry',
    },
    {
        id: 'errors.export',
        requiredBits: ['bot.errors.export'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'Export error data',
    },
    {
        id: 'tokens.view',
        requiredBits: ['bot.tokens.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View tokens / devices',
    },
    {
        id: 'tokens.manage',
        requiredBits: ['bot.tokens.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Issue or revoke tokens',
    },
    {
        id: 'permissions.view',
        requiredBits: ['bot.permissions.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'Inspect permissions',
    },
    {
        id: 'permissions.manage',
        requiredBits: ['bot.permissions.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Manage permission bits and cache',
    },
    {
        id: 'gates.view',
        requiredBits: ['bot.gates.view'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'read',
        requiresTargetHierarchy: false,
        description: 'View guild/plugin gates',
    },
    {
        id: 'gates.manage',
        requiredBits: ['bot.gates.manage'],
        bitMode: 'all',
        authorityScope: 'bot',
        resourceType: 'none',
        targetType: 'none',
        access: 'admin',
        requiresTargetHierarchy: false,
        description: 'Manage guild/plugin gates',
    },
] as const;

const BY_ID = new Map<ActorCapabilityId, CapabilityDefinition>(
    CAPABILITY_DEFINITIONS.map((d) => [d.id, d]),
);

export function getCapabilityDefinition(id: string): CapabilityDefinition | undefined {
    return BY_ID.get(id as ActorCapabilityId);
}

export function listCapabilityDefinitions(): readonly CapabilityDefinition[] {
    return CAPABILITY_DEFINITIONS;
}
