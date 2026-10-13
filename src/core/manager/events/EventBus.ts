import type { Client, ClientEvents } from 'discord.js';
import { Events } from 'discord.js';
import type { AuditRecord } from '#core/audit/types.js';
import type { ErrorOccurrence } from '#core/errors/types.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('EventBus');

type DiscordEventName = (typeof Events)[keyof typeof Events];

type DiscordBridgedEvents = {
    [E in DiscordEventName as `discord.${E & string}`]: E extends keyof ClientEvents
        ? ClientEvents[E]
        : unknown[];
};

type FrameworkEventArgsMap = {
    'system.boot.start': [payload: { mode: string; at: number }];
    'system.ready': [client: Client<true>];
    'system.shutdown.start': [payload: { signal: string; role: string; at: number }];
    'system.shutdown.complete': [payload: { signal: string; role: string; at: number }];
    'system.http.ready': [payload: { host: string; port: number }];
    'system.http.stopped': [payload: { at: number }];
    'system.plugins.booted': [payload: { count: number; durationMs: number }];
    'system.plugins.shutdown': [payload: { at: number }];
    'system.log.error': [payload: {
        level?: string;
        message: string;
        name?: string;
        stack?: string;
        meta?: unknown;
        at?: number;
    }];
    'system.error.unhandled': [payload: {
        message: string;
        stack?: string;
        origin?: string;
        at?: number;
    }];
    'system.migration.complete': [payload: {
        scope: string;
        applied: number;
        failed: number;
        failedPlugins: readonly string[];
    }];
    'system.migration.plugin_failed': [payload: {
        pluginId: string;
        error: string;
    }];
    'system.secrets.locked': [payload: { keyCount: number }];
    'system.database.ready': [payload: { alias: string; engine?: string }];
    'system.database.closed': [payload: { at: number }];

    'config.loaded': [payload: { count: number }];
    'config.reloaded': [payload: { name?: string; count?: number }];
    'config.snapshot.applied': [payload: { entries: number }];
    'lang.loaded': [payload: { namespaces: number }];
    'lang.reloaded': [payload: { namespaces?: number }];
    'lang.snapshot.applied': [payload: { entries: number }];
    'emoji.loaded': [payload: { count: number }];
    'emoji.synced': [payload: { count?: number }];
    'emoji.snapshot.applied': [payload: { entries: number }];

    'permissions.ready': [payload: { engine: string; alias: string }];
    'guildgate.ready': [payload: { engine: string; alias: string }];
    'plugin.enabled': [payload: { pluginId: string; version?: string; durationMs?: number }];
    'plugin.disabled': [payload: { pluginId: string }];
    'plugin.preload.complete': [payload: { count: number }];
    'interaction.commands.synced': [payload: {
        count: number;
        guildId?: string | null;
        global: boolean;
    }];
    'interaction.handled': [payload: {
        category: string;
        commandName?: string;
        pluginId?: string;
        guildId?: string | null;
        success: boolean;
        durationMs?: number;
    }];

    'shard.ready': [payload: {
        shardId: number;
        totalShards: number;
        userTag: string | null;
    }];
    'shard.disconnect': [payload: { shardId: number; reason?: string }];
    'shard.set.changed': [payload: {
        previous: readonly number[];
        next: readonly number[];
        totalShards: number;
        reason?: string;
    }];

    'crosshost.worker.registered': [payload: {
        machineId: string;
        assignedShards: readonly number[];
        totalShards: number;
    }];
    'crosshost.assignment.applied': [payload: {
        machineId: string;
        previous: readonly number[];
        next: readonly number[];
        reason: string;
        generation: number;
    }];
    'crosshost.heartbeat.started': [payload: { machineId: string; intervalMs: number }];
    'crosshost.worker.dead': [payload: { machineId: string; ageMs: number }];
    'crosshost.rebalance': [payload: {
        strategy: string;
        moves: number;
        reason: string;
    }];
    'crosshost.orchestrator.ready': [payload: {
        totalShards: number;
        strategy: string;
        snapshotVersion: number;
    }];
    'crosshost.claim.acquired': [payload: { fingerprint: string }];
    'crosshost.snapshot.applied': [payload: {
        version: number;
        mode: 'full' | 'diff';
        hash?: string;
    }];
    'crosshost.identify.granted': [payload: {
        machineId: string;
        shardId: number;
        allowResume: boolean;
    }];
    'crosshost.storage.gate.passed': [payload: { at: number }];
    'crosshost.plugin_bus.started': [payload: { machineId: string }];

    'command:executed': [payload: { pluginId: string; commandName: string }];
    'audit.recorded': [entry: AuditRecord];
    'error.recorded': [entry: ErrorOccurrence];
};

export type EventArgsMap = FrameworkEventArgsMap & DiscordBridgedEvents;

export const DISCORD_BRIDGED_EVENT_NAMES: readonly DiscordEventName[] = Object.freeze(
    Object.values(Events) as DiscordEventName[],
);

export type ArgsFor<E extends string> = string extends E
    ? unknown[]
    : E extends keyof EventArgsMap
      ? EventArgsMap[E]
      : unknown[];

export type EventCallback<E extends string = string> = (
    ...args: ArgsFor<E>
) => unknown | Promise<unknown>;

type StoredCallback = (...args: unknown[]) => unknown | Promise<unknown>;

export interface ListenerOptions {
    priority?: number;
    once?: boolean;
}

interface Listener {
    id: number;
    priority: number;
    order: number;
    callback: StoredCallback;
    once: boolean;
    owner?: string;
    registeredAt: number;
}

export interface EventResult {
    event: string;
    listenerCount: number;
    results: unknown[];
}

export class EventBus {
    private readonly exactListeners = new Map<string, Listener[]>();
    private readonly wildcardListeners = new Map<string, Listener[]>();

    private readonly patternCache = new Map<string, RegExp>();
    private counter = 0;

    private getMatcher(pattern: string): RegExp {
        if (this.patternCache.size > 1000) {
            log.warn('EventBus pattern cache exceeded limit. Purging to prevent OOM crash.');
            this.patternCache.clear();
        }

        let matcher = this.patternCache.get(pattern);
        if (!matcher) {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped.replace(/\\\*/g, '.*') + '$';
            matcher = new RegExp(regexStr);
            this.patternCache.set(pattern, matcher);
        }
        return matcher;
    }

    public on<E extends string>(
        pattern: E,
        callback: EventCallback<E>,
        options: ListenerOptions & { owner?: string } = {},
    ): () => void {
        const owner = options.owner;
        if (!pattern || typeof pattern !== 'string') {
            throw new TypeError('Pattern must be a non-empty string');
        }
        if (typeof callback !== 'function') {
            throw new TypeError('Callback must be a function');
        }

        const priority = options.priority ?? 0;
        const once = options.once ?? false;
        const order = this.counter++;

        const listener: Listener = {
            id: order,
            priority,
            order,
            callback: callback as StoredCallback,
            once,
            owner,
            registeredAt: Date.now(),
        };

        const isWildcard = pattern.includes('*');
        const targetMap = isWildcard ? this.wildcardListeners : this.exactListeners;

        if (!targetMap.has(pattern)) {
            targetMap.set(pattern, []);
        }

        const bucket = targetMap.get(pattern);
        if (!bucket) {
            throw new Error(`EventBus: failed to create listener bucket for ${pattern}`);
        }
        bucket.push(listener);

        bucket.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.order - b.order;
        });

        return () => {
            this.removeListener(pattern, callback as StoredCallback);
        };
    }

    public unregisterByOwner(ownerId: string): void {
        const filter = (l: Listener) => l.owner !== ownerId;

        for (const [pattern, bucket] of this.exactListeners.entries()) {
            const newBucket = bucket.filter(filter);
            if (newBucket.length === 0) this.exactListeners.delete(pattern);
            else this.exactListeners.set(pattern, newBucket);
        }

        for (const [pattern, bucket] of this.wildcardListeners.entries()) {
            const newBucket = bucket.filter(filter);
            if (newBucket.length === 0) this.wildcardListeners.delete(pattern);
            else this.wildcardListeners.set(pattern, newBucket);
        }

        log.debug(`[EventBus] Purged all listeners owned by: ${ownerId}`);
    }

    public once<E extends string>(
        pattern: E,
        callback: EventCallback<E>,
        priority: number = 0,
    ): () => void {
        return this.on(pattern, callback, { priority, once: true });
    }

    public removeListener(pattern: string, callback: StoredCallback): boolean {
        const isWildcard = pattern.includes('*');
        const targetMap = isWildcard ? this.wildcardListeners : this.exactListeners;

        const bucket = targetMap.get(pattern);
        if (!bucket) return false;

        const initialLength = bucket.length;
        const newBucket = bucket.filter((l) => l.callback !== callback);

        if (newBucket.length === 0) {
            targetMap.delete(pattern);
        } else {
            targetMap.set(pattern, newBucket);
        }

        return initialLength !== newBucket.length;
    }

    public clear(): void {
        this.exactListeners.clear();
        this.wildcardListeners.clear();
        this.patternCache.clear();
        log.info('EventBus registries cleared.');
    }

    private snapshot(event: string): { pattern: string; listener: Listener }[] {
        const out: { pattern: string; listener: Listener }[] = [];

        const exactMatch = this.exactListeners.get(event);
        if (exactMatch) {
            for (const listener of exactMatch) {
                out.push({ pattern: event, listener });
            }
        }

        for (const [pattern, bucket] of this.wildcardListeners.entries()) {
            if (this.getMatcher(pattern).test(event)) {
                for (const listener of bucket) {
                    out.push({ pattern, listener });
                }
            }
        }

        out.sort((a, b) => {
            if (a.listener.priority !== b.listener.priority) return b.listener.priority - a.listener.priority;
            return a.listener.order - b.listener.order;
        });

        return out;
    }

    public async emit(event: string, ...args: unknown[]): Promise<EventResult> {
        const listeners = this.snapshot(event);
        const results: unknown[] = [];
        const toRemove: { pattern: string; callback: StoredCallback }[] = [];

        for (const { pattern, listener } of listeners) {
            try {
                const result = await listener.callback(...args);
                results.push(result);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[EventBus] Serial execution error on [${event}] via [${pattern}]: ${err.message}`, {
                    stack: err.stack,
                });
                results.push(err);
            }

            if (listener.once) {
                toRemove.push({ pattern, callback: listener.callback });
            }
        }

        for (const { pattern, callback } of toRemove) this.removeListener(pattern, callback);

        return { event, listenerCount: listeners.length, results };
    }

    public async emitConcurrent(event: string, ...args: unknown[]): Promise<EventResult> {
        const listeners = this.snapshot(event);
        const toRemove: { pattern: string; callback: StoredCallback }[] = [];

        const settledResults = await Promise.allSettled(
            listeners.map(async ({ pattern, listener }) => {
                if (listener.once) toRemove.push({ pattern, callback: listener.callback });

                try {
                    return await listener.callback(...args);
                } catch (error: unknown) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(`[EventBus] Concurrent execution error on [${event}] via [${pattern}]: ${err.message}`, {
                        stack: err.stack,
                    });
                    throw err;
                }
            }),
        );

        for (const { pattern, callback } of toRemove) this.removeListener(pattern, callback);

        const results = settledResults.map((r) => (r.status === 'fulfilled' ? r.value : r.reason));

        return { event, listenerCount: listeners.length, results };
    }

    public listInspect(): Array<{
        name: string;
        once: boolean;
        priority: number;
        pluginId: string | null;
    }> {
        const out: Array<{
            name: string;
            once: boolean;
            priority: number;
            pluginId: string | null;
        }> = [];
        for (const [pattern, bucket] of this.exactListeners.entries()) {
            for (const listener of bucket) {
                out.push({
                    name: pattern,
                    once: listener.once,
                    priority: listener.priority,
                    pluginId: listener.owner ?? null,
                });
            }
        }
        for (const [pattern, bucket] of this.wildcardListeners.entries()) {
            for (const listener of bucket) {
                out.push({
                    name: pattern,
                    once: listener.once,
                    priority: listener.priority,
                    pluginId: listener.owner ?? null,
                });
            }
        }
        out.sort((a, b) => a.name.localeCompare(b.name) || (b.priority - a.priority));
        return out;
    }
}

export const eventBus = new EventBus();
