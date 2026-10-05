




import type { ResolvedPermissions } from '#core/types/permissions.js';
import type { DashboardEvent, SubscriptionScope } from './eventContract.js';

export interface RealtimeActor {
    readonly userId: string;
    readonly isEnvOwner: boolean;
    readonly resolved: ResolvedPermissions;
}

function hasAnyBit(resolved: ResolvedPermissions, bits: readonly string[]): boolean {
    if (resolved.botOwner || resolved.bits.has('bot.owner')) return true;
    return bits.some((b) => resolved.bits.has(b));
}


export function authorizeSubscription(actor: RealtimeActor, scope: SubscriptionScope): boolean {
    if (actor.isEnvOwner || actor.resolved.botOwner || actor.resolved.bits.has('bot.owner')) {
        return true;
    }
    switch (scope.kind) {
        case 'registry':
        case 'theme':
        case 'layout':
            return hasAnyBit(actor.resolved, ['bot.theme.manage', 'bot.dash.pages.manage', 'bot.plugins.view']);
        case 'fleet':
        case 'worker':
        case 'shard':
            return hasAnyBit(actor.resolved, ['bot.fleet.view', 'bot.shard.view', 'bot.crosshost.view']);
        case 'guild':
        case 'member':
            return hasAnyBit(actor.resolved, [
                'bot.servers.view',
                'bot.servers.manage',
                'server.members.view',
                'bot.members.view',
            ]);
        case 'audit':
            return hasAnyBit(actor.resolved, ['bot.audit.view', 'bot.logs.view']);
        case 'analytics':
            return hasAnyBit(actor.resolved, ['bot.analytics.view', 'server.analytics.view']);
        case 'plugin':
        case 'surface':
            return hasAnyBit(actor.resolved, ['bot.plugins.view', 'bot.plugins.manage']);
        case 'job':
        case 'data_rights':

            return true;
        default:
            return false;
    }
}





export function authorizeEventDelivery(actor: RealtimeActor, event: DashboardEvent): boolean {
    if (actor.isEnvOwner || actor.resolved.botOwner || actor.resolved.bits.has('bot.owner')) {
        return true;
    }
    const res = event.resource;
    if (!res) {

        return true;
    }
    if (res.guildId) {
        if (hasAnyBit(actor.resolved, ['bot.servers.view', 'bot.servers.manage'])) return true;

        return false;
    }
    switch (res.type) {
        case 'fleet':
        case 'worker':
        case 'shard':
            return hasAnyBit(actor.resolved, ['bot.fleet.view', 'bot.shard.view', 'bot.crosshost.view']);
        case 'registry':
        case 'theme':
        case 'layout':
            return hasAnyBit(actor.resolved, ['bot.theme.manage', 'bot.dash.pages.manage', 'bot.plugins.view']);
        case 'audit':
            return hasAnyBit(actor.resolved, ['bot.audit.view']);
        case 'analytics':
            return hasAnyBit(actor.resolved, ['bot.analytics.view']);
        case 'plugin':
        case 'surface':
            return hasAnyBit(actor.resolved, ['bot.plugins.view']);
        case 'job':
        case 'data_rights':
            if (event.actor?.userId && event.actor.userId === actor.userId) return true;
            return hasAnyBit(actor.resolved, ['bot.owner']);
        default:
            return false;
    }
}


export function scopeMatchesEvent(scope: SubscriptionScope, event: DashboardEvent): boolean {
    const res = event.resource;
    if (scope.kind === 'registry') {
        return event.type.startsWith('registry') || res?.type === 'registry';
    }
    if (scope.kind === 'theme') {
        return event.type.startsWith('theme') || res?.type === 'theme';
    }
    if (scope.kind === 'layout') {
        return event.type.startsWith('layout') || res?.type === 'layout';
    }
    if (scope.kind === 'fleet') {
        return res?.type === 'fleet' || res?.type === 'worker' || res?.type === 'shard';
    }

    if (!res) return false;
    if (scope.kind === 'guild') {
        return !!scope.guildId && res.guildId === scope.guildId;
    }
    if (scope.kind === 'member') {
        return res.type === 'member' && res.guildId === scope.guildId;
    }
    if (scope.kind === 'worker') {
        return res.type === 'worker' && res.machineId === scope.machineId;
    }
    if (scope.kind === 'shard') {
        return res.type === 'shard' && res.shardId === scope.shardId;
    }
    if (scope.kind === 'plugin') {
        return res.pluginId === scope.pluginId;
    }
    if (scope.kind === 'surface') {
        return res.pluginId === scope.pluginId && res.surfaceId === scope.surfaceId;
    }
    if (scope.kind === 'job') {
        return res.type === 'job' && (!scope.resourceId || res.id === scope.resourceId);
    }
    if (scope.kind === 'data_rights') {
        return res.type === 'data_rights' && (!scope.resourceId || res.id === scope.resourceId);
    }
    if (scope.kind === 'audit') return res.type === 'audit';
    if (scope.kind === 'analytics') return res.type === 'analytics';
    return false;
}
