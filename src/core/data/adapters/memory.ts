import type { DataStorageAdapter, DataSubject } from '../types.js';

export class MemoryDataAdapter implements DataStorageAdapter {
    readonly id = 'memory';
    readonly #store = new Map<string, Map<string, unknown>>();

    #bucket(typeId: string): Map<string, unknown> {
        let b = this.#store.get(typeId);
        if (!b) {
            b = new Map();
            this.#store.set(typeId, b);
        }
        return b;
    }

    async put(typeId: string, key: string, value: unknown): Promise<void> {
        this.#bucket(typeId).set(key, value);
    }

    async get(typeId: string, key: string): Promise<unknown | undefined> {
        return this.#bucket(typeId).get(key);
    }

    async query(typeId: string, _filter: unknown): Promise<readonly unknown[]> {
        return [...this.#bucket(typeId).values()];
    }

    async delete(typeId: string, key: string): Promise<boolean> {
        return this.#bucket(typeId).delete(key);
    }

    async deleteBySubject(typeId: string, subject: DataSubject): Promise<number> {
        const bucket = this.#bucket(typeId);
        let n = 0;
        for (const [key, value] of bucket) {
            if (!value || typeof value !== 'object') continue;
            const rec = value as Record<string, unknown>;
            if (subject.userId && rec.userId === subject.userId) {
                bucket.delete(key);
                n++;
                continue;
            }
            if (subject.guildId && rec.guildId === subject.guildId) {
                bucket.delete(key);
                n++;
                continue;
            }
            if (subject.pluginId && rec.pluginId === subject.pluginId) {
                bucket.delete(key);
                n++;
            }
        }
        return n;
    }
}
