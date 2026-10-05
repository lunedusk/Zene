import { randomUUID } from 'node:crypto';
import { eventBus } from '#core/manager/events/EventBus.js';
import { getLogger } from '#core/utils/logger.js';
import { REGISTRY_EVENT } from './dashRegistry.js';
import type { Response } from 'express';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import { clientMayReceive as policyClientMayReceive } from './sseDeliveryPolicy.js';

const log = getLogger('DashEvents');





export type DashSseEventType =
    | 'registry.updated'
    | 'surface.invalidate'
    | 'theme.updated'
    | 'layout.updated'
    | 'widget.data'
    | 'permission.changed'
    | 'session.revoked'
    | 'heartbeat';

export type DashEventResourceScope = 'global' | 'user' | 'guild' | 'plugin' | 'surface' | 'worker' | 'shard';

export type DashEventSensitivity = 'public' | 'authenticated' | 'guild' | 'owner' | 'admin';

export interface DashSsePayload {

    eventId: string;
    type: DashSseEventType;
    version?: number;
    reason?: string;
    pluginId?: string;
    surfaceId?: string;
    scope?: string;
    guildId?: string;
    payload?: unknown;
    resourceScope?: DashEventResourceScope;
    sensitivity?: DashEventSensitivity;
    at: number;
}

interface SseClient {
    id: string;
    res: Response;
    userId: string;

    bits: ReadonlySet<string>;
    isEnvOwner: boolean;
    authRevision: number;
}

const clients = new Map<string, SseClient>();
let wired = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let globalAuthRevision = 1;

export function bumpDashAuthRevision(): number {
    globalAuthRevision += 1;
    return globalAuthRevision;
}

export function getDashAuthRevision(): number {
    return globalAuthRevision;
}

function writeEvent(res: Response, event: DashSsePayload): boolean {
    try {
        if (res.writableEnded) return false;
        res.write(`id: ${event.eventId}\n`);
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        return true;
    } catch {
        return false;
    }
}

function clientMayReceive(client: SseClient, event: DashSsePayload): boolean {
    return policyClientMayReceive(client, event);
}

export function broadcastDashEvent(
    event: Omit<DashSsePayload, 'at' | 'eventId'> & { at?: number; eventId?: string },
): void {
    const full: DashSsePayload = {
        ...event,
        eventId: event.eventId ?? randomUUID(),
        at: event.at ?? Math.floor(Date.now() / 1000),
    };
    for (const [id, client] of clients) {
        if (!clientMayReceive(client, full)) continue;
        if (!writeEvent(client.res, full)) {
            clients.delete(id);
        }
    }
}

export function addSseClient(client: Omit<SseClient, 'authRevision'> & { authRevision?: number }): () => void {
    const full: SseClient = {
        ...client,
        authRevision: client.authRevision ?? globalAuthRevision,
    };
    clients.set(full.id, full);
    writeEvent(full.res, {
        eventId: randomUUID(),
        type: 'heartbeat',
        at: Math.floor(Date.now() / 1000),
        reason: 'connected',
        resourceScope: 'global',
        sensitivity: 'authenticated',
    });
    return () => {
        clients.delete(full.id);
    };
}


export function refreshSseClientAuth(
    userId: string,
    next: { bits: ReadonlySet<string>; isEnvOwner: boolean },
): void {
    for (const [id, client] of clients) {
        if (client.userId !== userId) continue;
        client.bits = next.bits;
        client.isEnvOwner = next.isEnvOwner;
        client.authRevision = globalAuthRevision;
        void id;
    }
}

export function removeSseClientsForUser(userId: string): void {
    for (const [id, client] of clients) {
        if (client.userId === userId) {
            try {
                client.res.end();
            } catch {

            }
            clients.delete(id);
        }
    }
}

export { clientMayReceive as testClientMayReceive } from './sseDeliveryPolicy.js';

export type { ResolvedPermissions };

export function ensureDashEventWiring(): void {
    if (wired) return;
    wired = true;

    eventBus.on(REGISTRY_EVENT, (raw: unknown) => {
        const payload = (raw ?? {}) as { version?: number; reason?: string };
        broadcastDashEvent({
            type: 'registry.updated',
            version: payload?.version,
            reason: payload?.reason,
        });
    });

    eventBus.on('dash.surface.invalidate', (raw: unknown) => {
        const payload = (raw ?? {}) as { pluginId?: string; surfaceId?: string };
        broadcastDashEvent({
            type: 'surface.invalidate',
            pluginId: payload?.pluginId,
            surfaceId: payload?.surfaceId,
        });
    });

    eventBus.on('dash.theme.updated', () => {
        broadcastDashEvent({ type: 'theme.updated' });
    });

    eventBus.on('dash.layout.updated', (raw: unknown) => {
        const payload = (raw ?? {}) as { scope?: string; guildId?: string };
        broadcastDashEvent({
            type: 'layout.updated',
            scope: payload?.scope,
            guildId: payload?.guildId,
        });
    });

    eventBus.on(
        'dash.widget.data',
        (raw: unknown) => {
            const payload = (raw ?? {}) as { pluginId?: string; surfaceId?: string; payload?: unknown };
            broadcastDashEvent({
                type: 'widget.data',
                pluginId: payload?.pluginId,
                surfaceId: payload?.surfaceId,
                payload: payload?.payload,
            });
        },
    );

    heartbeatTimer = setInterval(() => {
        broadcastDashEvent({ type: 'heartbeat' });
    }, 25_000);
    if (typeof heartbeatTimer === 'object' && 'unref' in heartbeatTimer) {
        heartbeatTimer.unref();
    }

    log.info('Dash SSE event wiring active');
}

export function sseClientCount(): number {
    return clients.size;
}

export function emitRegistryUpdatedForTests(version: number, reason: string): void {
    void eventBus.emit(REGISTRY_EVENT, { version, reason });
}
