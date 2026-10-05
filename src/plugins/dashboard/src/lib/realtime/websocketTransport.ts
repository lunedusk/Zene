




import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
    registerBrokerClient,
    eventsAfter,
    type BrokerClient,
} from './broker.js';
import type { DashboardEvent, SubscriptionScope } from './eventContract.js';
import { parseSubscriptionScope } from './eventContract.js';
import type { RealtimeActor } from './subscriptionAuthz.js';
import { authorizeSubscription } from './subscriptionAuthz.js';

export interface WebSocketTransportOptions {

    path?: string;




    resolveActor: (req: IncomingMessage) => Promise<RealtimeActor | null>;

    maxClients?: number;
}

interface MinimalSocket {
    readyState: number;
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
}

type WsModule = {
    WebSocketServer: new (opts: { noServer: boolean }) => {
        handleUpgrade: (
            req: IncomingMessage,
            socket: Duplex,
            head: Buffer,
            cb: (ws: MinimalSocket) => void,
        ) => void;
        clients: Set<MinimalSocket>;
    };
    WebSocket: { OPEN: number };
};


export function subscriptionScopeKey(s: SubscriptionScope): string {
    return [
        s.kind,
        s.guildId ?? '',
        s.machineId ?? '',
        s.shardId !== undefined ? String(s.shardId) : '',
        s.pluginId ?? '',
        s.surfaceId ?? '',
        s.resourceId ?? '',
    ].join('|');
}

function scopesEqual(a: SubscriptionScope, b: SubscriptionScope): boolean {
    return subscriptionScopeKey(a) === subscriptionScopeKey(b);
}

let installed = false;






export async function attachDashboardWebSocketTransport(
    server: HttpServer,
    options: WebSocketTransportOptions,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    if (installed) {
        return { ok: true, path: options.path ?? '/api/dash/events/ws' };
    }

    let wsMod: WsModule;
    try {
        const dynamicImport = new Function(
            'specifier',
            'return import(specifier)',
        ) as (specifier: string) => Promise<unknown>;
        const mod: unknown = await dynamicImport('ws');
        if (!mod || typeof mod !== 'object') {
            return { ok: false, reason: 'ws package invalid export' };
        }
        const rec = mod as { WebSocketServer?: unknown; WebSocket?: unknown; default?: unknown };
        const root = (rec.WebSocketServer ? rec : rec.default) as WsModule | undefined;
        if (!root?.WebSocketServer || !root.WebSocket) {
            return { ok: false, reason: 'ws package missing WebSocketServer' };
        }
        wsMod = root;
    } catch {
        return { ok: false, reason: 'ws package not installed' };
    }

    const path = options.path ?? '/api/dash/events/ws';
    const maxClients = options.maxClients ?? 500;
    const wss = new wsMod.WebSocketServer({ noServer: true });
    let clientCount = 0;

    server.on('upgrade', (req, socket, head) => {
        void (async () => {
            try {
                const url = new URL(req.url ?? '/', 'http://localhost');
                if (url.pathname !== path) {
                    return;
                }
                if (clientCount >= maxClients) {
                    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
                    socket.destroy();
                    return;
                }
                const actor = await options.resolveActor(req);
                if (!actor) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                wss.handleUpgrade(req, socket, head, (ws) => {
                    clientCount += 1;
                    const clientId = randomUUID();
                    const scopes: SubscriptionScope[] = [];
                    const scopeParam = url.searchParams.get('scopes');
                    if (scopeParam) {
                        for (const raw of scopeParam.split(',')) {
                            const s = parseSubscriptionScope(raw.trim());
                            if (s && authorizeSubscription(actor, s)) {
                                scopes.push(s);
                            }
                        }
                    }

                    const write = (event: DashboardEvent): boolean => {
                        if (ws.readyState !== wsMod.WebSocket.OPEN) return false;
                        try {
                            ws.send(JSON.stringify(event));
                            return true;
                        } catch {
                            return false;
                        }
                    };

                    const client: BrokerClient = {
                        id: clientId,
                        actor,
                        authRevision: 0,
                        scopes,
                        write,
                        close: () => {
                            try {
                                ws.close(1000, 'broker_close');
                            } catch {

                            }
                        },
                    };
                    const unregister = registerBrokerClient(client);

                    const lastId =
                        (typeof req.headers['last-event-id'] === 'string'
                            ? req.headers['last-event-id']
                            : undefined) ??
                        url.searchParams.get('lastEventId') ??
                        undefined;
                    for (const ev of eventsAfter(lastId, client)) {
                        write(ev);
                    }

                    ws.on('message', (data: unknown) => {
                        try {
                            const text = typeof data === 'string' ? data : String(data);
                            const msg = JSON.parse(text) as {
                                op?: string;
                                scopes?: string[];
                            };
                            if (msg.op === 'subscribe' && Array.isArray(msg.scopes)) {
                                for (const raw of msg.scopes) {
                                    const s = parseSubscriptionScope(raw);
                                    if (s && authorizeSubscription(client.actor, s)) {
                                        if (!client.scopes.some((x) => scopesEqual(x, s))) {
                                            client.scopes.push(s);
                                        }
                                    }
                                }
                            }
                            if (msg.op === 'ping') {
                                write({
                                    eventId: `hb_${Date.now()}`,
                                    type: 'heartbeat',
                                    occurredAt: new Date().toISOString(),
                                    payload: { t: Date.now() },
                                });
                            }
                        } catch {

                        }
                    });

                    const cleanup = () => {
                        clientCount = Math.max(0, clientCount - 1);
                        unregister();
                    };
                    ws.on('close', cleanup);
                    ws.on('error', cleanup);
                });
            } catch {
                try {
                    socket.destroy();
                } catch {

                }
            }
        })();
    });

    installed = true;
    return { ok: true, path };
}
