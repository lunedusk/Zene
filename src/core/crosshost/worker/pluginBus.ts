import { randomBytes, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import { encodeMessage, decodeMessage } from '../protocol/codec.js';
import { channelPluginBus, channelControlShutdown } from '../protocol/channels.js';
import {
    pluginBusMessageSchema,
    controlShutdownSchema,
    PLUGIN_BUS_PROTOCOL_VERSION,
} from '../protocol/messages.js';
import type { PluginBusHandler, CrossHostBus } from '#core/heart/crossHost.js';
import { performLocalShutdown } from '#core/heart/control.js';
import { fetchPeerRoster } from '../orchestrator/peerRoster.js';
import { generateTrackingId, resolveTrackingId } from '../tracking.js';

const log = getLogger('CrossHost:PluginBus');

export const PLUGIN_BUS_MAX_PAYLOAD_BYTES = 256 * 1024;
export const PLUGIN_BUS_DEFAULT_TIMEOUT_MS = 10_000;
export const PLUGIN_BUS_MIN_TIMEOUT_MS = 50;
export const PLUGIN_BUS_MAX_TIMEOUT_MS = 30_000;
export const PLUGIN_BUS_MAX_PENDING = 1024;

export interface PluginBusMessage {
    readonly v?: typeof PLUGIN_BUS_PROTOCOL_VERSION;
    readonly kind: 'send' | 'request' | 'response';
    readonly channel: string;
    readonly fromMachineId: string;
    readonly toMachineId: string;
    readonly payload: unknown;
    readonly messageId?: string;
    readonly requestId?: string;
    readonly trackingId?: string;
    readonly sourcePluginId?: string;
    readonly runtimeId?: string;
    readonly generation?: number;
}

interface PendingEntry {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
    expectedTargetMachine: string;
    sourcePluginId?: string;
    runtimeId?: string;
    generation?: number;
}

function clampTimeout(timeoutMs: number | undefined): number {
    const raw = timeoutMs ?? PLUGIN_BUS_DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(raw)) return PLUGIN_BUS_DEFAULT_TIMEOUT_MS;
    return Math.min(
        PLUGIN_BUS_MAX_TIMEOUT_MS,
        Math.max(PLUGIN_BUS_MIN_TIMEOUT_MS, Math.floor(raw)),
    );
}

function assertPayloadSize(payload: unknown): void {
    const encoded = encodeMessage(payload);
    if (encoded.byteLength > PLUGIN_BUS_MAX_PAYLOAD_BYTES) {
        throw new Error(
            `CROSSHOST_PAYLOAD_TOO_LARGE: encoded payload ${encoded.byteLength} exceeds ${PLUGIN_BUS_MAX_PAYLOAD_BYTES}`,
        );
    }
}

function buildMessage(
    partial: Omit<PluginBusMessage, 'messageId' | 'trackingId' | 'v'> & {
        trackingId?: string;
        messageId?: string;
    },
): PluginBusMessage {
    return {
        v: PLUGIN_BUS_PROTOCOL_VERSION,
        messageId: partial.messageId ?? randomUUID(),
        trackingId: resolveTrackingId(partial.trackingId),
        kind: partial.kind,
        channel: partial.channel,
        fromMachineId: partial.fromMachineId,
        toMachineId: partial.toMachineId,
        payload: partial.payload,
        requestId: partial.requestId,
        sourcePluginId: partial.sourcePluginId,
        runtimeId: partial.runtimeId,
        generation: partial.generation,
    };
}

export async function startWorkerPluginBus(opts: {
    machineId: string;
    prefix: string;
    pub: Redis;
    sub: Redis;
    main: Redis;
    peerTtlMs?: number;
}): Promise<CrossHostBus> {
    const handlers = new Map<string, Set<PluginBusHandler>>();
    const pending = new Map<string, PendingEntry>();
    let peersCache: string[] = [];
    let peersAt = 0;
    const peerTtlMs = opts.peerTtlMs ?? 5_000;
    let available = false;

    const refreshPeers = async (): Promise<string[]> => {
        const now = Date.now();
        if (now - peersAt < peerTtlMs && peersCache.length > 0) {
            return peersCache;
        }
        try {
            peersCache = await fetchPeerRoster(opts.main, opts.prefix);
            peersAt = now;
        } catch (err) {
            log.warn('Peer roster fetch failed', err);
        }
        return peersCache;
    };

    const deliverLocal = async (msg: PluginBusMessage): Promise<unknown> => {
        const set = handlers.get(msg.channel);
        if (!set || set.size === 0) {
            if (msg.kind === 'request') {
                throw new Error(`No handler for channel ${msg.channel}`);
            }
            return undefined;
        }
        let last: unknown;
        for (const h of set) {
            last = await h(msg.payload, {
                fromMachineId: msg.fromMachineId,
                channel: msg.channel,
                requestId: msg.requestId,
                trackingId: msg.trackingId,
                messageId: msg.messageId,
            });
        }
        return last;
    };

    const publish = async (msg: PluginBusMessage): Promise<void> => {
        assertPayloadSize(msg.payload);
        await opts.pub.publish(
            channelPluginBus(opts.prefix),
            encodeMessage(msg).toString('base64'),
        );
    };

    const onMessage = (channel: string, payload: string) => {
        if (channel === channelControlShutdown(opts.prefix)) {
            void (async () => {
                try {
                    const raw = decodeMessage(Buffer.from(payload, 'base64'));
                    const parsed = controlShutdownSchema.safeParse(raw);
                    if (!parsed.success) return;
                    const msg = parsed.data;
                    if (msg.scope === 'fleet') {
                        await performLocalShutdown(msg.reason);
                        return;
                    }
                    if (msg.scope === 'machine' && msg.machineId === opts.machineId) {
                        await performLocalShutdown(msg.reason);
                    }
                } catch (err) {
                    log.warn('Shutdown control handling error', err);
                }
            })();
            return;
        }
        if (channel !== channelPluginBus(opts.prefix)) return;
        void (async () => {
            try {
                const raw = decodeMessage(Buffer.from(payload, 'base64'));
                if (
                    raw &&
                    typeof raw === 'object' &&
                    'v' in (raw as object) &&
                    (raw as { v: unknown }).v !== undefined &&
                    (raw as { v: unknown }).v !== PLUGIN_BUS_PROTOCOL_VERSION
                ) {
                    log.warn('Unsupported plugin-bus protocol version', {
                        v: (raw as { v: unknown }).v,
                    });
                    return;
                }
                const parsed = pluginBusMessageSchema.safeParse(raw);
                if (!parsed.success) return;
                const msg = parsed.data as PluginBusMessage;

                if (msg.kind === 'response') {
                    if (!msg.requestId) return;
                    const p = pending.get(msg.requestId);
                    if (!p) return;
                    if (msg.fromMachineId !== p.expectedTargetMachine) {
                        log.warn('Ignored response from unexpected machine', {
                            requestId: msg.requestId,
                            expected: p.expectedTargetMachine,
                            actual: msg.fromMachineId,
                        });
                        return;
                    }
                    if (msg.toMachineId !== opts.machineId) {
                        log.warn('Ignored response with wrong toMachineId', {
                            requestId: msg.requestId,
                        });
                        return;
                    }
                    if (
                        p.sourcePluginId !== undefined &&
                        msg.sourcePluginId !== undefined &&
                        msg.sourcePluginId !== p.sourcePluginId
                    ) {
                        log.warn('Ignored response with wrong sourcePluginId', {
                            requestId: msg.requestId,
                        });
                        return;
                    }
                    if (
                        p.runtimeId !== undefined &&
                        msg.runtimeId !== undefined &&
                        msg.runtimeId !== p.runtimeId
                    ) {
                        return;
                    }
                    if (
                        p.generation !== undefined &&
                        msg.generation !== undefined &&
                        msg.generation !== p.generation
                    ) {
                        return;
                    }
                    clearTimeout(p.timer);
                    pending.delete(msg.requestId);
                    p.resolve(msg.payload);
                    return;
                }

                const forMe =
                    msg.toMachineId === opts.machineId || msg.toMachineId === '*';
                if (!forMe) return;

                if (msg.kind === 'request') {
                    try {
                        const result = await deliverLocal(msg);
                        await publish(
                            buildMessage({
                                kind: 'response',
                                channel: msg.channel,
                                fromMachineId: opts.machineId,
                                toMachineId: msg.fromMachineId,
                                payload: result,
                                requestId: msg.requestId,
                                trackingId: msg.trackingId,
                                sourcePluginId: msg.sourcePluginId,
                                runtimeId: msg.runtimeId,
                                generation: msg.generation,
                            }),
                        );
                    } catch (err) {
                        await publish(
                            buildMessage({
                                kind: 'response',
                                channel: msg.channel,
                                fromMachineId: opts.machineId,
                                toMachineId: msg.fromMachineId,
                                payload: {
                                    __error:
                                        err instanceof Error ? err.message : String(err),
                                },
                                requestId: msg.requestId,
                                trackingId: msg.trackingId,
                                sourcePluginId: msg.sourcePluginId,
                                runtimeId: msg.runtimeId,
                                generation: msg.generation,
                            }),
                        );
                    }
                    return;
                }

                await deliverLocal(msg);
            } catch (err) {
                log.warn('Plugin bus message error', err);
            }
        })();
    };

    await opts.sub.subscribe(
        channelPluginBus(opts.prefix),
        channelControlShutdown(opts.prefix),
    );
    opts.sub.on('message', onMessage);
    await refreshPeers();
    available = true;

    const bus: CrossHostBus = {
        isAvailable: () => available,
        machineId: () => opts.machineId,
        peers: () => Object.freeze([...peersCache]) as readonly string[],
        async send(target: string, channel: string, payload: unknown): Promise<void> {
            if (!available) throw new Error('Plugin bus not started');
            assertPayloadSize(payload);
            const msg = buildMessage({
                kind: 'send',
                channel,
                fromMachineId: opts.machineId,
                toMachineId: target,
                payload,
                trackingId: generateTrackingId(),
            });
            if (target === opts.machineId) {
                await deliverLocal(msg);
                return;
            }
            await publish(msg);
            if (target === '*') {
                await deliverLocal({
                    ...msg,
                    toMachineId: '*',
                });
            }
        },
        async request<T = unknown>(
            target: string,
            channel: string,
            payload: unknown,
            timeoutMs = PLUGIN_BUS_DEFAULT_TIMEOUT_MS,
        ): Promise<T> {
            if (!available) throw new Error('Plugin bus not started');
            if (target === '*') {
                throw new Error('request() requires a specific machineId, not "*"');
            }
            assertPayloadSize(payload);
            const timeout = clampTimeout(timeoutMs);
            if (target === opts.machineId) {
                const localResult: unknown = await deliverLocal(
                    buildMessage({
                        kind: 'request',
                        channel,
                        fromMachineId: opts.machineId,
                        toMachineId: target,
                        payload,
                        requestId: randomBytes(8).toString('hex'),
                        trackingId: generateTrackingId(),
                    }),
                );
                return localResult as T;
            }
            if (pending.size >= PLUGIN_BUS_MAX_PENDING) {
                throw new Error('CROSSHOST_REQUEST_LIMIT: global pending request limit');
            }
            const requestId = randomBytes(12).toString('hex');
            const trackingId = generateTrackingId();
            const result = await new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(requestId);
                    reject(new Error(`Plugin bus request timeout channel=${channel}`));
                }, timeout);
                timer.unref();
                pending.set(requestId, {
                    resolve,
                    reject,
                    timer,
                    expectedTargetMachine: target,
                });
                void publish(
                    buildMessage({
                        kind: 'request',
                        channel,
                        fromMachineId: opts.machineId,
                        toMachineId: target,
                        payload,
                        requestId,
                        trackingId,
                    }),
                ).catch((err) => {
                    clearTimeout(timer);
                    pending.delete(requestId);
                    reject(err instanceof Error ? err : new Error(String(err)));
                });
            });
            if (
                result &&
                typeof result === 'object' &&
                '__error' in (result as Record<string, unknown>)
            ) {
                throw new Error(String((result as { __error: unknown }).__error));
            }
            return result as T;
        },
        on(channel: string, handler: PluginBusHandler): void {
            let set = handlers.get(channel);
            if (!set) {
                set = new Set();
                handlers.set(channel, set);
            }
            set.add(handler);
        },
        off(channel: string, handler: PluginBusHandler): void {
            handlers.get(channel)?.delete(handler);
        },
        async shutdownWorker(machineId: string, reason?: string): Promise<void> {
            if (!available) throw new Error('Plugin bus not started');
            if (machineId === opts.machineId) {
                await performLocalShutdown(reason);
                return;
            }
            await opts.pub.publish(
                channelControlShutdown(opts.prefix),
                encodeMessage({
                    scope: 'machine',
                    machineId,
                    reason: reason ?? 'worker shutdown',
                    fromMachineId: opts.machineId,
                }).toString('base64'),
            );
        },
    };

    log.info('Plugin bus started', { machineId: opts.machineId });
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('crosshost.plugin_bus.started', {
                machineId: opts.machineId,
            }),
        )
        .catch(() => undefined);

    return bus;
}

export async function publishControlShutdown(
    pub: Redis,
    prefix: string,
    message: {
        scope: 'fleet' | 'machine' | 'orchestrator';
        machineId?: string;
        reason: string;
        fromMachineId: string;
    },
): Promise<void> {
    await pub.publish(
        channelControlShutdown(prefix),
        encodeMessage(message).toString('base64'),
    );
}
