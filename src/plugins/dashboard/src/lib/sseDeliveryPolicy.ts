/**
 * Pure SSE delivery authorization policy (no logger / EventBus).
 * Shared by dashEvents and unit tests.
 */

export type DashSseEventTypeForPolicy =
    | 'registry.updated'
    | 'surface.invalidate'
    | 'theme.updated'
    | 'layout.updated'
    | 'widget.data'
    | 'permission.changed'
    | 'session.revoked'
    | 'heartbeat';

export type DashEventSensitivity = 'public' | 'authenticated' | 'guild' | 'owner' | 'admin';

export interface SseDeliveryClient {
    readonly userId: string;
    readonly bits: ReadonlySet<string>;
    readonly isEnvOwner: boolean;
}

export interface SseDeliveryEvent {
    readonly type: DashSseEventTypeForPolicy | string;
    readonly guildId?: string;
    readonly sensitivity?: DashEventSensitivity;
}

/**
 * Event authorization (delivery layer).
 * Heartbeats and registry.updated go to any authenticated connection.
 * Guild-scoped events require bot-wide server view / owner (Phase 1 minimum).
 */
export function clientMayReceive(client: SseDeliveryClient, event: SseDeliveryEvent): boolean {
    if (event.type === 'heartbeat' || event.type === 'registry.updated' || event.type === 'theme.updated') {
        return true;
    }
    if (event.type === 'session.revoked') {
        return true;
    }
    if (event.guildId) {
        if (client.isEnvOwner || client.bits.has('bot.owner')) return true;
        if (client.bits.has('bot.servers.view') || client.bits.has('bot.servers.manage')) return true;
        return false;
    }
    if (event.sensitivity === 'admin') {
        return client.isEnvOwner || client.bits.has('bot.owner') || client.bits.has('bot.fleet.view');
    }
    return true;
}
