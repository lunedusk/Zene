




import type { Response } from 'express';
import {
    type DashboardEvent,
    type SubscriptionScope,
    newEventId,
    toIsoNow,
} from './eventContract.js';
import {
    authorizeEventDelivery,
    authorizeSubscription,
    scopeMatchesEvent,
    type RealtimeActor,
} from './subscriptionAuthz.js';
import { makeDeniedRealtimeActor } from './resolvedPermissionsFactory.js';

export interface BrokerClient {
    readonly id: string;




    actor: RealtimeActor;

    authRevision: number;
    scopes: SubscriptionScope[];

    lastEventId?: string;
    write: (event: DashboardEvent) => boolean;
    close: () => void;
}

export interface BrokerPublishInput {
    type: string;
    payload?: unknown;
    resource?: DashboardEvent['resource'];
    actor?: DashboardEvent['actor'];
    sequence?: number;
    eventId?: string;
}

let sequence = 0;
let authRevision = 1;
const clients = new Map<string, BrokerClient>();

const recent: DashboardEvent[] = [];
const RECENT_MAX = 100;





export type ActorRefreshFn = (userId: string) => RealtimeActor | null | Promise<RealtimeActor | null>;
let actorRefresh: ActorRefreshFn | null = null;

export function setRealtimeActorRefresh(fn: ActorRefreshFn | null): void {
    actorRefresh = fn;
}

export function bumpRealtimeAuthRevision(): number {
    authRevision += 1;
    return authRevision;
}

export function getRealtimeAuthRevision(): number {
    return authRevision;
}

export function publishDashboardEvent(input: BrokerPublishInput): DashboardEvent {
    sequence += 1;
    const event: DashboardEvent = {
        eventId: input.eventId ?? newEventId(),
        type: input.type,
        occurredAt: toIsoNow(),
        sequence: input.sequence ?? sequence,
        actor: input.actor,
        resource: input.resource,
        payload: input.payload ?? {},
    };
    recent.push(event);
    if (recent.length > RECENT_MAX) recent.shift();

    for (const [id, client] of clients) {


        if (actorRefresh && client.authRevision < authRevision) {
            applyActorRefresh(id, client, actorRefresh);
        }
        if (!clientMayReceive(client, event)) continue;
        if (!client.write(event)) {
            clients.delete(id);
            try {
                client.close();
            } catch {

            }
        } else {
            client.lastEventId = event.eventId;
        }
    }
    return event;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'then' in value &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

function applyActorRefresh(
    clientId: string,
    client: BrokerClient,
    refresh: ActorRefreshFn,
): void {
    const result = refresh(client.actor.userId);
    if (isPromiseLike(result)) {
        void result.then((next) => {
            const c = clients.get(clientId);
            if (!c) return;
            c.actor = next ?? makeDeniedRealtimeActor(c.actor.userId);
            c.authRevision = authRevision;
        });
        return;
    }
    client.actor = result ?? makeDeniedRealtimeActor(client.actor.userId);
    client.authRevision = authRevision;
}





export function publishDashboardEventWithAuthRefresh(input: BrokerPublishInput): DashboardEvent {
    if (actorRefresh) {
        for (const [id, client] of clients) {
            if (client.authRevision < authRevision) {
                const result = actorRefresh(client.actor.userId);
                if (!isPromiseLike(result)) {
                    client.actor = result ?? makeDeniedRealtimeActor(client.actor.userId);
                    client.authRevision = authRevision;
                } else {
                    applyActorRefresh(id, client, actorRefresh);
                }
            }
        }
    }
    return publishDashboardEvent(input);
}

function clientMayReceive(client: BrokerClient, event: DashboardEvent): boolean {

    if (!authorizeEventDelivery(client.actor, event)) return false;
    if (client.scopes.length === 0) {

        const t = event.type;
        return (
            t === 'heartbeat' ||
            t.startsWith('registry') ||
            t.startsWith('theme') ||
            t.startsWith('layout') ||
            t.startsWith('surface')
        );
    }
    return client.scopes.some((s) => scopeMatchesEvent(s, event));
}

export function registerBrokerClient(client: BrokerClient): () => void {
    clients.set(client.id, client);
    return () => {
        clients.delete(client.id);
    };
}

export function setClientScopes(
    clientId: string,
    scopes: SubscriptionScope[],
    actor: RealtimeActor,
): { ok: true; accepted: SubscriptionScope[] } | { ok: false; rejected: string[] } {
    const client = clients.get(clientId);
    if (!client) return { ok: false, rejected: scopes.map((s) => s.kind) };
    const accepted: SubscriptionScope[] = [];
    const rejected: string[] = [];
    for (const scope of scopes) {
        if (authorizeSubscription(actor, scope)) accepted.push(scope);
        else rejected.push(`${scope.kind}:${scope.guildId ?? scope.pluginId ?? ''}`);
    }
    client.scopes = accepted;
    client.actor = actor;
    client.authRevision = authRevision;
    if (rejected.length > 0 && accepted.length === 0) return { ok: false, rejected };
    return { ok: true, accepted };
}

export function updateClientActor(clientId: string, actor: RealtimeActor): void {
    const client = clients.get(clientId);
    if (!client) return;
    client.actor = actor;
    client.authRevision = authRevision;
}

export function removeClientsForUser(userId: string): void {
    for (const [id, c] of clients) {
        if (c.actor.userId === userId) {
            try {
                c.close();
            } catch {

            }
            clients.delete(id);
        }
    }
}


export function eventsAfter(lastEventId: string | undefined, client: BrokerClient): DashboardEvent[] {
    if (!lastEventId) return [];
    const idx = recent.findIndex((e) => e.eventId === lastEventId);
    if (idx < 0) {

        return [];
    }
    return recent.slice(idx + 1).filter((e) => clientMayReceive(client, e));
}

export function brokerClientCount(): number {
    return clients.size;
}


export function createSseWriter(res: Response): (event: DashboardEvent) => boolean {
    return (event: DashboardEvent) => {
        try {
            if (res.writableEnded) return false;
            res.write(`id: ${event.eventId}\n`);
            res.write(`event: ${event.type}\n`);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            return true;
        } catch {
            return false;
        }
    };
}
