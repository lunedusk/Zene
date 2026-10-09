import { surrealDB } from '#core/database/surreal.js';
import { DataRegistryError } from '../errors.js';
import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
} from '../types.js';
import {
    CORE_DATA_TABLE,
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

function unwrapQueryResult(result: unknown): Record<string, unknown>[] {
    if (!Array.isArray(result)) return [];
    const first = result[0];
    if (Array.isArray(first)) {
        return first as Record<string, unknown>[];
    }
    if (first && typeof first === 'object' && 'result' in first) {
        const inner = (first as { result: unknown }).result;
        return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : [];
    }
    return result as Record<string, unknown>[];
}

export class SurrealDataAdapter implements DataStorageAdapter {
    readonly id: string;
    readonly engine = 'surreal' as const;
    readonly capabilities = CAPABILITIES;
    readonly #alias: string;
    #ready = false;

    constructor(alias: string) {
        this.#alias = alias;
        this.id = `surreal:${alias}`;
        if (!surrealDB.has(alias)) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `SurrealDB instance '${alias}' is not available`,
            );
        }
    }

    #db() {
        return surrealDB.get(this.#alias);
    }

    async ensureSchema(): Promise<void> {
        if (this.#ready) return;
        const db = this.#db();
        await db.query(`DEFINE TABLE IF NOT EXISTS ${CORE_DATA_TABLE} SCHEMALESS`);
        await db.query(
            `DEFINE INDEX IF NOT EXISTS zene_core_data_type_key ON ${CORE_DATA_TABLE} FIELDS typeId, key UNIQUE`,
        );
        this.#ready = true;
    }

    async put(typeId: string, key: string, record: DataRecord): Promise<void> {
        await this.ensureSchema();
        const payload = encodeRecord(record);
        const id = `${CORE_DATA_TABLE}:⟨${typeId}⟩:⟨${key}⟩`;
        try {
            await this.#db().query(
                `UPSERT type::thing($table, $id) CONTENT $data RETURN NONE`,
                {
                    table: CORE_DATA_TABLE,
                    id: `${typeId}:${key}`,
                    data: {
                        typeId,
                        key,
                        subject: payload.subject,
                        value: payload.value,
                        ownerPluginId: payload.ownerPluginId,
                        updatedAt: payload.updatedAt,
                    },
                },
            );
            void id;
        } catch (err) {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    async get(typeId: string, key: string): Promise<DataRecord | undefined> {
        await this.ensureSchema();
        const result = await this.#db().query(
            `SELECT * FROM ${CORE_DATA_TABLE} WHERE typeId = $typeId AND key = $key LIMIT 1`,
            { typeId, key },
        );
        const rows = unwrapQueryResult(result);
        const doc = rows[0];
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
        await this.ensureSchema();
        const subject =
            filter && typeof filter === 'object' ? (filter as DataSubject) : {};
        let sql = `SELECT * FROM ${CORE_DATA_TABLE} WHERE typeId = $typeId`;
        const vars: Record<string, unknown> = { typeId };
        if (subject.userId !== undefined) {
            sql += ` AND subject.userId = $userId`;
            vars.userId = subject.userId;
        }
        if (subject.guildId !== undefined) {
            sql += ` AND subject.guildId = $guildId`;
            vars.guildId = subject.guildId;
        }
        if (subject.pluginId !== undefined) {
            sql += ` AND subject.pluginId = $pluginId`;
            vars.pluginId = subject.pluginId;
        }
        const result = await this.#db().query(sql, vars);
        const rows = unwrapQueryResult(result);
        return rows
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
        await this.ensureSchema();
        const existing = await this.get(typeId, key);
        if (!existing) return false;
        await this.#db().query(
            `DELETE FROM ${CORE_DATA_TABLE} WHERE typeId = $typeId AND key = $key`,
            { typeId, key },
        );
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

export function createSurrealDataAdapter(alias: string): SurrealDataAdapter {
    return new SurrealDataAdapter(alias);
}
