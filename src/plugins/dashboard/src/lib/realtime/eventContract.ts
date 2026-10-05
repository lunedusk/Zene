



export type DashboardEventResourceType =
    | 'registry'
    | 'theme'
    | 'layout'
    | 'guild'
    | 'member'
    | 'audit'
    | 'analytics'
    | 'fleet'
    | 'worker'
    | 'shard'
    | 'plugin'
    | 'surface'
    | 'job'
    | 'data_rights'
    | 'session'
    | 'override'
    | 'global';

export interface DashboardEventResource {
    readonly type: DashboardEventResourceType;
    readonly id?: string;
    readonly guildId?: string;
    readonly machineId?: string;
    readonly shardId?: number;
    readonly pluginId?: string;
    readonly surfaceId?: string;
}

export interface DashboardEvent {
    readonly eventId: string;
    readonly type: string;

    readonly occurredAt: string;
    readonly sequence?: number;
    readonly actor?: { readonly userId?: string };
    readonly resource?: DashboardEventResource;
    readonly payload: unknown;
}


export type SubscriptionScopeKind =
    | 'registry'
    | 'theme'
    | 'layout'
    | 'guild'
    | 'member'
    | 'audit'
    | 'analytics'
    | 'fleet'
    | 'worker'
    | 'shard'
    | 'plugin'
    | 'surface'
    | 'job'
    | 'data_rights';

export interface SubscriptionScope {
    readonly kind: SubscriptionScopeKind;
    readonly guildId?: string;
    readonly machineId?: string;
    readonly shardId?: number;
    readonly pluginId?: string;
    readonly surfaceId?: string;
    readonly resourceId?: string;
}

export function parseSubscriptionScope(raw: string): SubscriptionScope | null {
    const s = raw.trim();
    if (!s) return null;
    if (
        s === 'registry' ||
        s === 'theme' ||
        s === 'layout' ||
        s === 'fleet' ||
        s === 'audit' ||
        s === 'analytics'
    ) {
        return { kind: s };
    }
    const guild = /^guild:([0-9]+)$/.exec(s);
    if (guild) return { kind: 'guild', guildId: guild[1] };
    const member = /^guild:([0-9]+):members$/.exec(s);
    if (member) return { kind: 'member', guildId: member[1] };
    const worker = /^worker:([A-Za-z0-9._-]+)$/.exec(s);
    if (worker) return { kind: 'worker', machineId: worker[1] };
    const shard = /^shard:([0-9]+)$/.exec(s);
    if (shard) return { kind: 'shard', shardId: Number(shard[1]) };
    const plugin = /^plugin:([A-Za-z0-9._-]+)$/.exec(s);
    if (plugin) return { kind: 'plugin', pluginId: plugin[1] };
    const surface = /^surface:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/.exec(s);
    if (surface) return { kind: 'surface', pluginId: surface[1], surfaceId: surface[2] };
    const job = /^job:([A-Za-z0-9._-]+)$/.exec(s);
    if (job) return { kind: 'job', resourceId: job[1] };
    const dr = /^data_rights:([A-Za-z0-9._-]+)$/.exec(s);
    if (dr) return { kind: 'data_rights', resourceId: dr[1] };
    return null;
}





export function newEventId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    return randomUUID();
}

export function toIsoNow(): string {
    return new Date().toISOString();
}
