import { redisDB } from '#core/database/redis.js';
import type { Redis } from 'ioredis';
import { DataRegistryError } from '../errors.js';
import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
} from '../types.js';
import {
    CORE_DATA_REDIS_PREFIX,
    decodeRecord,
    encodeRecord,
    subjectMatches,
    type StoredRecordPayload,
} from './recordCodec.js';

const CAPABILITIES: DataStorageCapabilities = Object.freeze({
    durable: true,
    subjectDelete: true,
    structuredQuery: false,
    transactions: false,
    keyValueOnly: true,
});

export class RedisDataAdapter implements DataStorageAdapter {
    readonly id: string;
    readonly engine = 'redis' as const;
    readonly capabilities = CAPABILITIES;
    readonly #redis: Redis;

    constructor(alias: string) {
        this.id = `redis:${alias}`;
        if (!redisDB.has(alias)) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `Redis connection '${alias}' is not available`,
            );
        }
        this.#redis = redisDB.get(alias).main;
    }

    #recordKey(typeId: string, key: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:rec:${typeId}:${key}`;
    }

    #typeSet(typeId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:type:${typeId}`;
    }

    #userIdx(typeId: string, userId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:idx:user:${typeId}:${userId}`;
    }

    #guildIdx(typeId: string, guildId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:idx:guild:${typeId}:${guildId}`;
    }

    #pluginIdx(typeId: string, pluginId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:idx:plugin:${typeId}:${pluginId}`;
    }

    async put(typeId: string, key: string, record: DataRecord): Promise<void> {
        const payload = encodeRecord(record);
        const rk = this.#recordKey(typeId, key);
        const existingRaw = await this.#redis.get(rk);
        if (existingRaw) {
            try {
                const prev = JSON.parse(existingRaw) as StoredRecordPayload;
                await this.#dropIndexes(typeId, key, prev.subject);
            } catch {
                /* ignore corrupt prior */
            }
        }
        try {
            await this.#redis.set(rk, JSON.stringify(payload));
            await this.#redis.sadd(this.#typeSet(typeId), key);
            if (payload.subject.userId) {
                await this.#redis.sadd(
                    this.#userIdx(typeId, payload.subject.userId),
                    key,
                );
            }
            if (payload.subject.guildId) {
                await this.#redis.sadd(
                    this.#guildIdx(typeId, payload.subject.guildId),
                    key,
                );
            }
            if (payload.subject.pluginId) {
                await this.#redis.sadd(
                    this.#pluginIdx(typeId, payload.subject.pluginId),
                    key,
                );
            }
        } catch (err) {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    async #dropIndexes(
        typeId: string,
        key: string,
        subject: DataSubject,
    ): Promise<void> {
        if (subject.userId) {
            await this.#redis.srem(this.#userIdx(typeId, subject.userId), key);
        }
        if (subject.guildId) {
            await this.#redis.srem(this.#guildIdx(typeId, subject.guildId), key);
        }
        if (subject.pluginId) {
            await this.#redis.srem(this.#pluginIdx(typeId, subject.pluginId), key);
        }
    }

    async get(typeId: string, key: string): Promise<DataRecord | undefined> {
        const raw = await this.#redis.get(this.#recordKey(typeId, key));
        if (!raw) return undefined;
        try {
            return decodeRecord(JSON.parse(raw) as StoredRecordPayload);
        } catch {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                'Corrupt Redis core-data payload',
            );
        }
    }

    async query(
        typeId: string,
        filter: DataSubject | unknown,
    ): Promise<readonly DataRecord[]> {
        const subject =
            filter && typeof filter === 'object' ? (filter as DataSubject) : {};
        let keys: string[] = [];
        if (subject.userId) {
            keys = await this.#redis.smembers(this.#userIdx(typeId, subject.userId));
        } else if (subject.guildId) {
            keys = await this.#redis.smembers(
                this.#guildIdx(typeId, subject.guildId),
            );
        } else if (subject.pluginId) {
            keys = await this.#redis.smembers(
                this.#pluginIdx(typeId, subject.pluginId),
            );
        } else {
            keys = await this.#redis.smembers(this.#typeSet(typeId));
        }
        const out: DataRecord[] = [];
        for (const key of keys) {
            const rec = await this.get(typeId, key);
            if (rec && subjectMatches(rec.subject, subject)) out.push(rec);
        }
        return out;
    }

    async delete(typeId: string, key: string): Promise<boolean> {
        const existing = await this.get(typeId, key);
        if (!existing) return false;
        await this.#dropIndexes(typeId, key, existing.subject);
        await this.#redis.srem(this.#typeSet(typeId), key);
        await this.#redis.del(this.#recordKey(typeId, key));
        return true;
    }

    async deleteBySubject(typeId: string, subject: DataSubject): Promise<number> {
        const matches = await this.query(typeId, subject);
        for (const rec of matches) {
            await this.delete(typeId, rec.key);
        }
        return matches.length;
    }
}

export function createRedisDataAdapter(alias: string): RedisDataAdapter {
    return new RedisDataAdapter(alias);
}
