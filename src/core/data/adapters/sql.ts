import type { SqlAdapter } from '#core/database/sqlAdapter.js';
import { openSqlAdapter } from '#core/database/sqlAdapter.js';
import { DataRegistryError } from '../errors.js';
import type {
    DataRecord,
    DataStorageAdapter,
    DataStorageCapabilities,
    DataSubject,
    DurableDataStorageEngine,
} from '../types.js';
import {
    CORE_DATA_TABLE,
    canonicalizeSubject,
    decodeRecord,
    encodeRecord,
    subjectMatches,
    type StoredRecordPayload,
} from './recordCodec.js';

const CAPABILITIES: DataStorageCapabilities = Object.freeze({
    durable: true,
    subjectDelete: true,
    structuredQuery: true,
    transactions: true,
    keyValueOnly: false,
});

const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS ${CORE_DATA_TABLE} (
  type_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  owner_plugin_id TEXT NOT NULL,
  user_id TEXT,
  guild_id TEXT,
  plugin_id TEXT,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (type_id, record_key)
);
CREATE INDEX IF NOT EXISTS idx_zene_core_data_user ON ${CORE_DATA_TABLE}(type_id, user_id);
CREATE INDEX IF NOT EXISTS idx_zene_core_data_guild ON ${CORE_DATA_TABLE}(type_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_zene_core_data_plugin ON ${CORE_DATA_TABLE}(type_id, plugin_id);
`;

const DDL_PG = `
CREATE TABLE IF NOT EXISTS ${CORE_DATA_TABLE} (
  type_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  owner_plugin_id TEXT NOT NULL,
  user_id TEXT,
  guild_id TEXT,
  plugin_id TEXT,
  value_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (type_id, record_key)
);
CREATE INDEX IF NOT EXISTS idx_zene_core_data_user ON ${CORE_DATA_TABLE}(type_id, user_id);
CREATE INDEX IF NOT EXISTS idx_zene_core_data_guild ON ${CORE_DATA_TABLE}(type_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_zene_core_data_plugin ON ${CORE_DATA_TABLE}(type_id, plugin_id);
`;

function rowToRecord(row: Record<string, unknown>): DataRecord {
    let value: unknown;
    try {
        value = JSON.parse(String(row.value_json));
    } catch {
        throw new DataRegistryError(
            'DATA_PERSISTENCE_FAILURE',
            'Corrupt value_json in core data row',
        );
    }
    return decodeRecord({
        typeId: String(row.type_id),
        key: String(row.record_key),
        subject: canonicalizeSubject({
            userId: row.user_id != null ? String(row.user_id) : undefined,
            guildId: row.guild_id != null ? String(row.guild_id) : undefined,
            pluginId: row.plugin_id != null ? String(row.plugin_id) : undefined,
        }),
        value,
        ownerPluginId: String(row.owner_plugin_id),
        updatedAt: Number(row.updated_at),
    });
}

export class SqlDataAdapter implements DataStorageAdapter {
    readonly id: string;
    readonly engine: DurableDataStorageEngine;
    readonly capabilities = CAPABILITIES;
    readonly #sql: SqlAdapter;
    #ready = false;

    constructor(engine: 'sqlite' | 'postgres', alias: string) {
        this.engine = engine;
        this.id = `sql:${engine}:${alias}`;
        this.#sql = openSqlAdapter({ engine, alias });
    }

    async ensureSchema(): Promise<void> {
        if (this.#ready) return;
        const ddl = this.engine === 'postgres' ? DDL_PG : DDL_SQLITE;
        await this.#sql.exec(ddl);
        this.#ready = true;
    }

    async put(typeId: string, key: string, record: DataRecord): Promise<void> {
        await this.ensureSchema();
        const payload = encodeRecord(record);
        const valueJson = JSON.stringify(payload.value);
        try {
            if (this.engine === 'sqlite') {
                await this.#sql.run(
                    `INSERT INTO ${CORE_DATA_TABLE}
                      (type_id, record_key, owner_plugin_id, user_id, guild_id, plugin_id, value_json, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(type_id, record_key) DO UPDATE SET
                       owner_plugin_id = excluded.owner_plugin_id,
                       user_id = excluded.user_id,
                       guild_id = excluded.guild_id,
                       plugin_id = excluded.plugin_id,
                       value_json = excluded.value_json,
                       updated_at = excluded.updated_at`,
                    [
                        typeId,
                        key,
                        payload.ownerPluginId,
                        payload.subject.userId ?? null,
                        payload.subject.guildId ?? null,
                        payload.subject.pluginId ?? null,
                        valueJson,
                        payload.updatedAt,
                    ],
                );
            } else {
                await this.#sql.run(
                    `INSERT INTO ${CORE_DATA_TABLE}
                      (type_id, record_key, owner_plugin_id, user_id, guild_id, plugin_id, value_json, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (type_id, record_key) DO UPDATE SET
                       owner_plugin_id = EXCLUDED.owner_plugin_id,
                       user_id = EXCLUDED.user_id,
                       guild_id = EXCLUDED.guild_id,
                       plugin_id = EXCLUDED.plugin_id,
                       value_json = EXCLUDED.value_json,
                       updated_at = EXCLUDED.updated_at`,
                    [
                        typeId,
                        key,
                        payload.ownerPluginId,
                        payload.subject.userId ?? null,
                        payload.subject.guildId ?? null,
                        payload.subject.pluginId ?? null,
                        valueJson,
                        payload.updatedAt,
                    ],
                );
            }
        } catch (err) {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    async get(typeId: string, key: string): Promise<DataRecord | undefined> {
        await this.ensureSchema();
        const row = await this.#sql.get(
            `SELECT * FROM ${CORE_DATA_TABLE} WHERE type_id = ? AND record_key = ?`,
            [typeId, key],
        );
        if (!row) return undefined;
        return rowToRecord(row);
    }

    async query(
        typeId: string,
        filter: DataSubject | unknown,
    ): Promise<readonly DataRecord[]> {
        await this.ensureSchema();
        const subject =
            filter && typeof filter === 'object' ? (filter as DataSubject) : {};
        const clauses: string[] = ['type_id = ?'];
        const params: unknown[] = [typeId];
        if (subject.userId !== undefined) {
            clauses.push('user_id = ?');
            params.push(subject.userId);
        }
        if (subject.guildId !== undefined) {
            clauses.push('guild_id = ?');
            params.push(subject.guildId);
        }
        if (subject.pluginId !== undefined) {
            clauses.push('plugin_id = ?');
            params.push(subject.pluginId);
        }
        const rows = await this.#sql.all(
            `SELECT * FROM ${CORE_DATA_TABLE} WHERE ${clauses.join(' AND ')}`,
            params,
        );
        return rows.map(rowToRecord).filter((r) => subjectMatches(r.subject, subject));
    }

    async delete(typeId: string, key: string): Promise<boolean> {
        await this.ensureSchema();
        const existing = await this.get(typeId, key);
        if (!existing) return false;
        await this.#sql.run(
            `DELETE FROM ${CORE_DATA_TABLE} WHERE type_id = ? AND record_key = ?`,
            [typeId, key],
        );
        return true;
    }

    async deleteBySubject(typeId: string, subject: DataSubject): Promise<number> {
        await this.ensureSchema();
        const matches = await this.query(typeId, subject);
        for (const rec of matches) {
            await this.#sql.run(
                `DELETE FROM ${CORE_DATA_TABLE} WHERE type_id = ? AND record_key = ?`,
                [typeId, rec.key],
            );
        }
        return matches.length;
    }
}

export function createSqliteDataAdapter(alias: string): SqlDataAdapter {
    return new SqlDataAdapter('sqlite', alias);
}

export function createPostgresDataAdapter(alias: string): SqlDataAdapter {
    return new SqlDataAdapter('postgres', alias);
}
