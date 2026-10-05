/**
 * Phase 4 — Real Redis pub/sub Cross-Host transport (ioredis via existing redisDB).
 * Isolated channel prefix for tests; never uses production channels without explicit prefix.
 */

import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DashCrossHostRedis');

export type RedisTransportEnvelope = {
    readonly messageId: string;
    readonly sourceWorkerId: string;
    readonly type: string;
    readonly payload: unknown;
    readonly occurredAt: number;
    readonly sequence: number;
    readonly requestId?: string;
    readonly eventId?: string;
    readonly guildId?: string;
    readonly pluginId?: string;
};

export type RedisTransportHandler = (env: RedisTransportEnvelope) => void | Promise<void>;

export interface RedisTransport {
    readonly channelPrefix: string;
    publish(channel: string, env: RedisTransportEnvelope): Promise<void>;
    subscribe(channel: string, handler: RedisTransportHandler): Promise<() => Promise<void>>;
    close(): Promise<void>;
}

let seq = 0;

export function newTransportMessageId(): string {
    seq += 1;
    return `rtx_${Date.now()}_${seq}`;
}

/**
 * Create transport bound to Redis pub + sub clients.
 * channelPrefix must be unique per test (e.g. zene:test:dash:<pid>).
 */
export function createRedisTransport(input: {
    pub: Redis;
    sub: Redis;
    channelPrefix: string;
    workerId: string;
}): RedisTransport {
    const handlers = new Map<string, Set<RedisTransportHandler>>();
    const seen = new Set<string>();
    const full = (ch: string) => `${input.channelPrefix}:${ch}`;

    const onMessage = (channel: string, message: string): void => {
        let env: RedisTransportEnvelope;
        try {
            env = JSON.parse(message) as RedisTransportEnvelope;
        } catch {
            log.warn('crosshost_receive_reject', {
                operation: 'receive',
                result: 'malformed',
                workerId: input.workerId,
                channel,
            });
            return;
        }
        if (!env.messageId || !env.type) {
            log.warn('crosshost_receive_reject', {
                operation: 'receive',
                result: 'invalid_envelope',
                workerId: input.workerId,
            });
            return;
        }
        if (seen.has(env.messageId)) {
            log.debug('crosshost_duplicate', {
                operation: 'receive',
                result: 'duplicate',
                messageId: env.messageId,
                workerId: input.workerId,
            });
            return;
        }
        seen.add(env.messageId);
        if (seen.size > 10_000) {
            const first = seen.values().next().value;
            if (first) seen.delete(first);
        }
        const short = channel.startsWith(input.channelPrefix + ':')
            ? channel.slice(input.channelPrefix.length + 1)
            : channel;
        const set = handlers.get(short);
        if (!set) return;
        log.debug('crosshost_receive', {
            operation: 'receive',
            result: 'ok',
            messageId: env.messageId,
            type: env.type,
            workerId: input.workerId,
            requestId: env.requestId,
            eventId: env.eventId,
            guildId: env.guildId,
            pluginId: env.pluginId,
        });
        for (const h of set) {
            void Promise.resolve(h(env)).catch((e) => {
                log.warn('crosshost_handler_error', {
                    operation: 'apply',
                    result: 'error',
                    error: e instanceof Error ? e.message : 'error',
                    workerId: input.workerId,
                });
            });
        }
    };

    input.sub.on('message', onMessage);

    return {
        channelPrefix: input.channelPrefix,
        async publish(channel, env) {
            const started = Date.now();
            await input.pub.publish(full(channel), JSON.stringify(env));
            log.debug('crosshost_publish', {
                operation: 'publish',
                result: 'ok',
                messageId: env.messageId,
                type: env.type,
                workerId: input.workerId,
                duration: Date.now() - started,
                requestId: env.requestId,
                eventId: env.eventId,
            });
        },
        async subscribe(channel, handler) {
            let set = handlers.get(channel);
            if (!set) {
                set = new Set();
                handlers.set(channel, set);
                await input.sub.subscribe(full(channel));
                log.debug('crosshost_subscribe', {
                    operation: 'subscribe',
                    result: 'ok',
                    channel,
                    workerId: input.workerId,
                });
            }
            set.add(handler);
            return async () => {
                set!.delete(handler);
                if (set!.size === 0) {
                    handlers.delete(channel);
                    try {
                        await input.sub.unsubscribe(full(channel));
                    } catch {
                        /* ignore */
                    }
                }
            };
        },
        async close() {
            input.sub.off('message', onMessage);
            handlers.clear();
        },
    };
}

/**
 * Try connect isolated Redis for tests. Returns null if unavailable.
 * Uses REDIS_URL or redis://127.0.0.1:6379 — never production Cross-Host prefix.
 */
export async function tryCreateTestRedisTransport(workerId: string): Promise<{
    transport: RedisTransport;
    disconnect: () => Promise<void>;
} | null> {
    const uri = process.env.ZENE_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    try {
        const { Redis } = await import('ioredis');
        const pub = new Redis(uri, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 1500,
            enableOfflineQueue: false,
            retryStrategy: () => null,
        });
        const sub = new Redis(uri, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 1500,
            enableOfflineQueue: false,
            retryStrategy: () => null,
        });
        const noop = (): void => undefined;
        pub.on('error', noop);
        sub.on('error', noop);
        try {
            await Promise.race([
                Promise.all([pub.connect(), sub.connect()]),
                new Promise((_, rej) => setTimeout(() => rej(new Error('redis_connect_timeout')), 2000)),
            ]);
        } catch {
            try { pub.disconnect(); } catch { /* ignore */ }
            try { sub.disconnect(); } catch { /* ignore */ }
            return null;
        }
        const prefix = `zene:test:dash:${process.pid}:${Date.now()}`;
        const transport = createRedisTransport({ pub, sub, channelPrefix: prefix, workerId });
        return {
            transport,
            async disconnect() {
                await transport.close();
                pub.disconnect();
                sub.disconnect();
            },
        };
    } catch {
        return null;
    }
}
