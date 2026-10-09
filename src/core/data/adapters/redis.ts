import { redisDB } from '#core/database/redis.js';
import type { Redis } from 'ioredis';
import { DataRegistryError } from '../errors.js';
import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
    DataTypeCatalogueEntry,
} from '../types.js';
import {
    CORE_DATA_REDIS_PREFIX,
    CORE_DATA_CATALOGUE_REDIS_PREFIX,
    decodeRecord,
    encodeCompositePart,
    encodeRecord,
    encodeTypeKeyIdentity,
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
    readonly connectionAlias: string;
    readonly #redis: Redis;

    constructor(alias: string) {
        this.id = `redis:${alias}`;
        this.connectionAlias = alias;
        if (!redisDB.has(alias)) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `Redis connection '${alias}' is not available`,
            );
        }
        this.#redis = redisDB.get(alias).main;
    }

    #recordKey(typeId: string, key: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:rec:${encodeTypeKeyIdentity(typeId, key)}`;
    }

    #typeSet(typeId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:type:${encodeTypeKeyIdentity(typeId, '')}`;
    }

    #userIdx(typeId: string, userId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:idx:user:${encodeTypeKeyIdentity(typeId, userId)}`;
    }

    #guildIdx(typeId: string, guildId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:idx:guild:${encodeTypeKeyIdentity(typeId, guildId)}`;
    }

    #pluginIdx(typeId: string, pluginId: string): string {
        return `${CORE_DATA_REDIS_PREFIX}:idx:plugin:${encodeTypeKeyIdentity(typeId, pluginId)}`;
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
                'Redis storage operation failed',
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
        if (
            subject.userId === undefined &&
            subject.guildId === undefined &&
            subject.pluginId === undefined
        ) {
            throw new DataRegistryError(
                'DATA_INVALID_SUBJECT',
                'deleteBySubject requires at least one subject field',
            );
        }
        const matches = await this.query(typeId, subject);
        for (const rec of matches) {
            await this.delete(typeId, rec.key);
        }
        return matches.length;
    }

    async deleteByType(typeId: string): Promise<number> {
        const keys = await this.#redis.smembers(this.#typeSet(typeId));
        let n = 0;
        for (const key of keys) {
            if (await this.delete(typeId, key)) n++;
        }
        await this.#redis.del(this.#typeSet(typeId));
        return n;
    }

    #catalogueKey(typeId: string): string {
        return `${CORE_DATA_CATALOGUE_REDIS_PREFIX}:entry:${encodeCompositePart(typeId)}`;
    }

    #catalogueSet(): string {
        return `${CORE_DATA_CATALOGUE_REDIS_PREFIX}:index`;
    }

    async putCatalogueEntry(entry: DataTypeCatalogueEntry): Promise<void> {
        const payload = JSON.stringify({
            id: entry.id,
            ownerPluginId: entry.ownerPluginId,
            scope: entry.scope,
            personalData: entry.personalData,
            privacyClass: entry.privacyClass,
        });
        await this.#redis.set(this.#catalogueKey(entry.id), payload);
        await this.#redis.sadd(this.#catalogueSet(), entry.id);
    }

    async listCatalogueEntries(): Promise<readonly DataTypeCatalogueEntry[]> {
        const ids = await this.#redis.smembers(this.#catalogueSet());
        const out: DataTypeCatalogueEntry[] = [];
        for (const id of ids) {
            const raw = await this.#redis.get(this.#catalogueKey(id));
            if (!raw) continue;
            try {
                const doc = JSON.parse(raw) as {
                    id: string;
                    ownerPluginId: string;
                    scope: DataTypeCatalogueEntry['scope'];
                    personalData: boolean;
                    privacyClass: DataTypeCatalogueEntry['privacyClass'];
                };
                out.push({
                    id: doc.id,
                    ownerPluginId: doc.ownerPluginId,
                    scope: doc.scope,
                    personalData: Boolean(doc.personalData),
                    privacyClass: doc.privacyClass,
                });
            } catch {
                throw new DataRegistryError(
                    'DATA_PERSISTENCE_FAILURE',
                    'Corrupt Redis catalogue payload',
                );
            }
        }
        return out;
    }
}

export function createRedisDataAdapter(alias: string): RedisDataAdapter {
    return new RedisDataAdapter(alias);
}
