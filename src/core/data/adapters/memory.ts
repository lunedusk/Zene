import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
} from '../types.js';

const CAPABILITIES: DataStorageCapabilities = Object.freeze({
    durable: false,
    subjectDelete: true,
    structuredQuery: false,
    transactions: false,
    keyValueOnly: true,
});

export class MemoryDataAdapter implements DataStorageAdapter {
    readonly id = 'memory';
    readonly engine = 'memory' as const;
    readonly capabilities = CAPABILITIES;
    readonly connectionAlias = undefined;
    readonly #store = new Map<string, Map<string, DataRecord>>();

    #bucket(typeId: string): Map<string, DataRecord> {
        let b = this.#store.get(typeId);
        if (!b) {
            b = new Map();
            this.#store.set(typeId, b);
        }
        return b;
    }

    async put(typeId: string, key: string, record: DataRecord): Promise<void> {
        this.#bucket(typeId).set(key, record);
    }

    async get(typeId: string, key: string): Promise<DataRecord | undefined> {
        return this.#bucket(typeId).get(key);
    }

    async query(
        typeId: string,
        filter: DataSubject | unknown,
    ): Promise<readonly DataRecord[]> {
        const all = [...this.#bucket(typeId).values()];
        if (!filter || typeof filter !== 'object') return all;
        const subject = filter as DataSubject;
        return all.filter((rec) => matchesSubject(rec.subject, subject));
    }

    async delete(typeId: string, key: string): Promise<boolean> {
        return this.#bucket(typeId).delete(key);
    }

    async deleteBySubject(typeId: string, subject: DataSubject): Promise<number> {
        const bucket = this.#bucket(typeId);
        let n = 0;
        for (const [key, rec] of bucket) {
            if (matchesSubject(rec.subject, subject)) {
                bucket.delete(key);
                n++;
            }
        }
        return n;
    }

    async deleteByType(typeId: string): Promise<number> {
        const bucket = this.#bucket(typeId);
        const n = bucket.size;
        this.#store.delete(typeId);
        return n;
    }

    /** Test helper — clear all buckets. */
    clear(): void {
        this.#store.clear();
    }
}

function matchesSubject(record: DataSubject, filter: DataSubject): boolean {
    if (filter.userId !== undefined && record.userId !== filter.userId) return false;
    if (filter.guildId !== undefined && record.guildId !== filter.guildId) return false;
    if (filter.pluginId !== undefined && record.pluginId !== filter.pluginId) return false;
    return true;
}
