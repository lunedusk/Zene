import { mongoDB } from '#core/database/mongo.js';
import { DataRegistryError } from '../errors.js';
import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
    DataTypeCatalogueEntry,
} from '../types.js';
import {
    CORE_DATA_COLLECTION,
    CORE_DATA_CATALOGUE_COLLECTION,
    canonicalizeSubject,
    decodeRecord,
    encodeRecord,
    subjectMatches,
} from './recordCodec.js';

const CAPABILITIES: DataStorageCapabilities = Object.freeze({
    durable: true,
    subjectDelete: true,
    structuredQuery: true,
    transactions: false,
    keyValueOnly: false,
});

export class MongoDataAdapter implements DataStorageAdapter {
    readonly id: string;
    readonly engine = 'mongo' as const;
    readonly capabilities = CAPABILITIES;
    readonly connectionAlias: string;
    readonly #alias: string;
    #indexed = false;

    constructor(alias: string) {
        this.#alias = alias;
        this.connectionAlias = alias;
        this.id = `mongo:${alias}`;
        if (!mongoDB.has(alias)) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `MongoDB connection '${alias}' is not available`,
            );
        }
    }

    #collection() {
        const conn = mongoDB.get(this.#alias);
        const db = conn.db;
        if (!db) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `Mongo connection '${this.#alias}' has no database`,
            );
        }
        return db.collection(CORE_DATA_COLLECTION);
    }

    async #ensureIndexes(): Promise<void> {
        if (this.#indexed) return;
        const col = this.#collection();
        await col.createIndex(
            { typeId: 1, key: 1 },
            { unique: true, name: 'zene_core_data_type_key' },
        );
        await col.createIndex(
            { typeId: 1, 'subject.userId': 1 },
            { name: 'zene_core_data_user' },
        );
        await col.createIndex(
            { typeId: 1, 'subject.guildId': 1 },
            { name: 'zene_core_data_guild' },
        );
        await col.createIndex(
            { typeId: 1, 'subject.pluginId': 1 },
            { name: 'zene_core_data_plugin' },
        );
        await this.#catalogue().createIndex(
            { id: 1 },
            { unique: true, name: 'zene_core_data_catalogue_id' },
        );
        this.#indexed = true;
    }

    async put(typeId: string, key: string, record: DataRecord): Promise<void> {
        await this.#ensureIndexes();
        const payload = encodeRecord(record);
        try {
            await this.#collection().updateOne(
                { typeId, key },
                {
                    $set: {
                        typeId,
                        key,
                        subject: payload.subject,
                        value: payload.value,
                        ownerPluginId: payload.ownerPluginId,
                        updatedAt: payload.updatedAt,
                    },
                },
                { upsert: true },
            );
        } catch (err) {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                'Mongo storage operation failed',
            );
        }
    }

    async get(typeId: string, key: string): Promise<DataRecord | undefined> {
        await this.#ensureIndexes();
        const doc = await this.#collection().findOne({ typeId, key });
        if (!doc) return undefined;
        return decodeRecord({
            typeId: String(doc.typeId),
            key: String(doc.key),
            subject: canonicalizeSubject((doc.subject ?? {}) as DataSubject),
            value: doc.value,
            ownerPluginId: String(doc.ownerPluginId),
            updatedAt: Number(doc.updatedAt),
        });
    }

    async query(
        typeId: string,
        filter: DataSubject | unknown,
    ): Promise<readonly DataRecord[]> {
        await this.#ensureIndexes();
        const subject =
            filter && typeof filter === 'object' ? (filter as DataSubject) : {};
        const q: Record<string, unknown> = { typeId };
        if (subject.userId !== undefined) q['subject.userId'] = subject.userId;
        if (subject.guildId !== undefined) q['subject.guildId'] = subject.guildId;
        if (subject.pluginId !== undefined) q['subject.pluginId'] = subject.pluginId;
        const docs = await this.#collection().find(q).toArray();
        return docs
            .map((doc) =>
                decodeRecord({
                    typeId: String(doc.typeId),
                    key: String(doc.key),
                    subject: canonicalizeSubject((doc.subject ?? {}) as DataSubject),
                    value: doc.value,
                    ownerPluginId: String(doc.ownerPluginId),
                    updatedAt: Number(doc.updatedAt),
                }),
            )
            .filter((r) => subjectMatches(r.subject, subject));
    }

    async delete(typeId: string, key: string): Promise<boolean> {
        await this.#ensureIndexes();
        const r = await this.#collection().deleteOne({ typeId, key });
        return (r.deletedCount ?? 0) > 0;
    }

    async deleteBySubject(typeId: string, subject: DataSubject): Promise<number> {
        await this.#ensureIndexes();
        const q: Record<string, unknown> = { typeId };
        if (subject.userId !== undefined) q['subject.userId'] = subject.userId;
        if (subject.guildId !== undefined) q['subject.guildId'] = subject.guildId;
        if (subject.pluginId !== undefined) q['subject.pluginId'] = subject.pluginId;
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
        const r = await this.#collection().deleteMany(q);
        return r.deletedCount ?? 0;
    }

    async deleteByType(typeId: string): Promise<number> {
        await this.#ensureIndexes();
        const r = await this.#collection().deleteMany({ typeId });
        return r.deletedCount ?? 0;
    }

    #catalogue() {
        const conn = mongoDB.get(this.#alias);
        const db = conn.db;
        if (!db) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `Mongo connection '${this.#alias}' has no database`,
            );
        }
        return db.collection(CORE_DATA_CATALOGUE_COLLECTION);
    }

    async putCatalogueEntry(entry: DataTypeCatalogueEntry): Promise<void> {
        await this.#ensureIndexes();
        await this.#catalogue().updateOne(
            { id: entry.id },
            {
                $set: {
                    id: entry.id,
                    ownerPluginId: entry.ownerPluginId,
                    scope: entry.scope,
                    personalData: entry.personalData,
                    privacyClass: entry.privacyClass,
                },
            },
            { upsert: true },
        );
    }

    async listCatalogueEntries(): Promise<readonly DataTypeCatalogueEntry[]> {
        await this.#ensureIndexes();
        const docs = await this.#catalogue().find({}).toArray();
        return docs.map((doc) => ({
            id: String(doc.id),
            ownerPluginId: String(doc.ownerPluginId),
            scope: doc.scope as DataTypeCatalogueEntry['scope'],
            personalData: Boolean(doc.personalData),
            privacyClass: doc.privacyClass as DataTypeCatalogueEntry['privacyClass'],
        }));
    }
}

export function createMongoDataAdapter(alias: string): MongoDataAdapter {
    return new MongoDataAdapter(alias);
}
