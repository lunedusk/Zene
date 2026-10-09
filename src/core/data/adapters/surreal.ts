import { surrealDB } from '#core/database/surreal.js';
import { DataRegistryError } from '../errors.js';
import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
    DataTypeCatalogueEntry,
} from '../types.js';
import {
    CORE_DATA_TABLE,
    CORE_DATA_CATALOGUE_TABLE,
    canonicalizeSubject,
    decodeRecord,
    encodeRecord,
    encodeTypeKeyIdentity,
    subjectMatches,
} from './recordCodec.js';

const CAPABILITIES: DataStorageCapabilities = Object.freeze({
    durable: true,
    subjectDelete: true,
    structuredQuery: true,
    transactions: false,
    keyValueOnly: false,
});

type RecordCtorFn = 'type::record' | 'type::thing';

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

/**
 * Classify Surreal server major from version() payload without logging secrets.
 */
function safeClassifySurrealError(err: unknown): {
    name: string;
    kind: 'syntax' | 'id' | 'schema' | 'auth' | 'internal' | 'unknown';
} {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    // Classify from short patterns only — never log the full message.
    if (/parse|syntax|unexpected|invalid query/i.test(message)) {
        return { name, kind: 'syntax' };
    }
    if (/record id|invalid id|id field|already exists|duplicate/i.test(message)) {
        return { name, kind: 'id' };
    }
    if (/table|index|schema|define/i.test(message)) {
        return { name, kind: 'schema' };
    }
    if (/auth|permission|denied|signin/i.test(message)) {
        return { name, kind: 'auth' };
    }
    if (/internal/i.test(name) || /internal/i.test(message)) {
        return { name, kind: 'internal' };
    }
    return { name, kind: 'unknown' };
}

function classifySurrealMajor(versionInfo: unknown): 2 | 3 {
    const text =
        typeof versionInfo === 'string'
            ? versionInfo
            : versionInfo && typeof versionInfo === 'object'
              ? JSON.stringify(versionInfo)
              : '';
    // Prefer explicit 3.x markers; default to 3 for current Zene Docker (v3.3.0).
    if (/surrealdb[- ]?2\b|\b2\.\d+/i.test(text) && !/surrealdb[- ]?3\b|\b3\.\d+/i.test(text)) {
        return 2;
    }
    return 3;
}

export class SurrealDataAdapter implements DataStorageAdapter {
    readonly id: string;
    readonly engine = 'surreal' as const;
    readonly capabilities = CAPABILITIES;
    readonly connectionAlias: string;
    readonly #alias: string;
    #ready = false;
    #recordCtor: RecordCtorFn | null = null;

    constructor(alias: string) {
        this.#alias = alias;
        this.connectionAlias = alias;
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

    async #resolveRecordCtor(): Promise<RecordCtorFn> {
        if (this.#recordCtor) return this.#recordCtor;
        try {
            const info = await this.#db().version();
            const major = classifySurrealMajor(info);
            this.#recordCtor = major >= 3 ? 'type::record' : 'type::thing';
        } catch {
            // Connection is live for data ops; prefer v3 syntax (current supported server).
            this.#recordCtor = 'type::record';
        }
        return this.#recordCtor;
    }

    /**
     * Parameterized UPSERT by stable logical identity.
     * Table name is a fixed Core constant (never user input).
     * Uses type::record (SurrealDB 3+) or type::thing (2.x).
     * Record id and CONTENT are bound parameters only.
     */
    async #upsertByIdentity(
        table: typeof CORE_DATA_TABLE | typeof CORE_DATA_CATALOGUE_TABLE,
        identity: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        if (table !== CORE_DATA_TABLE && table !== CORE_DATA_CATALOGUE_TABLE) {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                'Surreal upsert rejected unknown table',
            );
        }
        const ctor = await this.#resolveRecordCtor();
        // Embed only allowlisted constant table identifiers in the query text.
        const sql = `UPSERT ${ctor}('${table}', $id) CONTENT $data RETURN NONE`;
        try {
            await this.#db().query(sql, {
                id: identity,
                data,
            });
        } catch (err) {
            // One-shot fallback if server is 2.x but version() was unavailable/misclassified.
            if (ctor === 'type::record') {
                try {
                    await this.#db().query(
                        `UPSERT type::thing('${table}', $id) CONTENT $data RETURN NONE`,
                        { id: identity, data },
                    );
                    this.#recordCtor = 'type::thing';
                    return;
                } catch {
                    // fall through
                }
            }
            const classified = safeClassifySurrealError(err);
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                `Surreal storage upsert failed (${classified.name}/${classified.kind})`,
            );
        }
    }

    async ensureSchema(): Promise<void> {
        if (this.#ready) return;
        const db = this.#db();
        await db.query(`DEFINE TABLE IF NOT EXISTS ${CORE_DATA_TABLE} SCHEMALESS`);
        await db.query(`DEFINE TABLE IF NOT EXISTS ${CORE_DATA_CATALOGUE_TABLE} SCHEMALESS`);
        await db.query(
            `DEFINE INDEX IF NOT EXISTS zene_core_data_type_key ON ${CORE_DATA_TABLE} FIELDS typeId, key UNIQUE`,
        );
        this.#ready = true;
    }

    async put(typeId: string, key: string, record: DataRecord): Promise<void> {
        await this.ensureSchema();
        const payload = encodeRecord(record);
        const identity = encodeTypeKeyIdentity(typeId, key);
        await this.#upsertByIdentity(CORE_DATA_TABLE, identity, {
            typeId,
            key,
            subject: payload.subject,
            value: payload.value,
            ownerPluginId: payload.ownerPluginId,
            updatedAt: payload.updatedAt,
        });
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
            .filter((rec) => subjectMatches(rec.subject, subject));
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
        await this.ensureSchema();
        const result = await this.#db().query(
            `SELECT key FROM ${CORE_DATA_TABLE} WHERE typeId = $typeId`,
            { typeId },
        );
        const rows = unwrapQueryResult(result);
        await this.#db().query(`DELETE FROM ${CORE_DATA_TABLE} WHERE typeId = $typeId`, {
            typeId,
        });
        return rows.length;
    }

    async putCatalogueEntry(entry: DataTypeCatalogueEntry): Promise<void> {
        await this.ensureSchema();
        const identity = encodeTypeKeyIdentity(entry.id, 'catalogue');
        // SurrealDB reserves document field `id` for the record identifier.
        // Store the logical type id as typeId (parity with data rows), never as `id`.
        await this.#upsertByIdentity(CORE_DATA_CATALOGUE_TABLE, identity, {
            typeId: entry.id,
            ownerPluginId: entry.ownerPluginId,
            scope: entry.scope,
            personalData: entry.personalData,
            privacyClass: entry.privacyClass,
        });
    }

    async listCatalogueEntries(): Promise<readonly DataTypeCatalogueEntry[]> {
        await this.ensureSchema();
        const result = await this.#db().query(
            `SELECT * FROM ${CORE_DATA_CATALOGUE_TABLE}`,
            {},
        );
        const rows = unwrapQueryResult(result);
        const out: DataTypeCatalogueEntry[] = [];
        for (const doc of rows) {
            // Prefer typeId; accept legacy `id` only when it is a plain string (not a RecordId object).
            const rawId = doc.typeId ?? (typeof doc.id === 'string' ? doc.id : undefined);
            if (typeof rawId !== 'string' || rawId.length === 0) {
                throw new DataRegistryError(
                    'DATA_PERSISTENCE_FAILURE',
                    'Incomplete or corrupt Surreal catalogue metadata',
                );
            }
            if (
                typeof doc.ownerPluginId !== 'string' ||
                typeof doc.scope !== 'string' ||
                typeof doc.privacyClass !== 'string'
            ) {
                throw new DataRegistryError(
                    'DATA_PERSISTENCE_FAILURE',
                    'Incomplete or corrupt Surreal catalogue metadata',
                );
            }
            out.push({
                id: rawId,
                ownerPluginId: doc.ownerPluginId,
                scope: doc.scope as DataTypeCatalogueEntry['scope'],
                personalData: Boolean(doc.personalData),
                privacyClass: doc.privacyClass as DataTypeCatalogueEntry['privacyClass'],
            });
        }
        return out;
    }
}

export function createSurrealDataAdapter(alias: string): SurrealDataAdapter {
    return new SurrealDataAdapter(alias);
}
