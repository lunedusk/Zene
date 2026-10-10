/**
 * Shared SurrealDB record helpers: version-aware type::record / type::thing,
 * allowlisted table names, parameter-bound identities, and CONTENT without
 * reserved `id` field conflicts.
 */

import type { Surreal } from 'surrealdb';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('SurrealRecord');

export type SurrealRecordCtor = 'type::record' | 'type::thing';

const ctorByClient = new WeakMap<object, SurrealRecordCtor>();

function classifyMajor(versionInfo: unknown): 2 | 3 {
    const text =
        typeof versionInfo === 'string'
            ? versionInfo
            : versionInfo && typeof versionInfo === 'object'
              ? JSON.stringify(versionInfo)
              : '';
    if (
        /surrealdb[- ]?2\b|\b2\.\d+/i.test(text) &&
        !/surrealdb[- ]?3\b|\b3\.\d+/i.test(text)
    ) {
        return 2;
    }
    return 3;
}

/**
 * Resolve and cache type::record (SurrealDB 3+) vs type::thing (2.x) per client.
 */
export async function resolveSurrealRecordCtor(db: Surreal): Promise<SurrealRecordCtor> {
    const cached = ctorByClient.get(db as object);
    if (cached) return cached;
    let ctor: SurrealRecordCtor = 'type::record';
    try {
        const info = await db.version();
        ctor = classifyMajor(info) >= 3 ? 'type::record' : 'type::thing';
    } catch {
        ctor = 'type::record';
    }
    ctorByClient.set(db as object, ctor);
    return ctor;
}

function assertAllowlistedTable(table: string, allowlist: readonly string[]): void {
    if (!allowlist.includes(table)) {
        throw new Error(`Surreal table '${table}' is not allowlisted`);
    }
}

/**
 * Strip reserved Surreal `id` from CONTENT; map application id to logicalKey.
 */
export function contentWithoutReservedId(
    data: Record<string, unknown>,
    logicalKey: string,
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data, logicalKey };
    delete out.id;
    return out;
}

/**
 * UPSERT a record by allowlisted table + parameter-bound key.
 * Falls back from type::record to type::thing only on syntax-like failures.
 */
export async function surrealUpsertByKey(
    db: Surreal,
    table: string,
    key: string,
    data: Record<string, unknown>,
    allowlist: readonly string[],
): Promise<void> {
    assertAllowlistedTable(table, allowlist);
    const payload = contentWithoutReservedId(data, key);
    const ctor = await resolveSurrealRecordCtor(db);
    const sql = `UPSERT ${ctor}($table, $key) CONTENT $data RETURN NONE`;
    try {
        await db.query(sql, { table, key, data: payload });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const syntaxLike = /parse|syntax|unexpected|unknown function|thing/i.test(msg);
        if (ctor === 'type::record' && syntaxLike) {
            try {
                await db.query(
                    `UPSERT type::thing($table, $key) CONTENT $data RETURN NONE`,
                    { table, key, data: payload },
                );
                ctorByClient.set(db as object, 'type::thing');
                log.info('Surreal record ctor fallback to type::thing after syntax mismatch');
                return;
            } catch {
                // fall through
            }
        }
        throw err;
    }
}

export async function surrealSelectOnlyByKey(
    db: Surreal,
    table: string,
    key: string,
    allowlist: readonly string[],
): Promise<unknown> {
    assertAllowlistedTable(table, allowlist);
    const ctor = await resolveSurrealRecordCtor(db);
    try {
        return await db.query(`SELECT * FROM ONLY ${ctor}($table, $key)`, {
            table,
            key,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (ctor === 'type::record' && /parse|syntax|unknown function|thing/i.test(msg)) {
            const result = await db.query(`SELECT * FROM ONLY type::thing($table, $key)`, {
                table,
                key,
            });
            ctorByClient.set(db as object, 'type::thing');
            return result;
        }
        throw err;
    }
}

export async function surrealDeleteByKey(
    db: Surreal,
    table: string,
    key: string,
    allowlist: readonly string[],
): Promise<void> {
    assertAllowlistedTable(table, allowlist);
    const ctor = await resolveSurrealRecordCtor(db);
    try {
        await db.query(`DELETE ${ctor}($table, $key) RETURN NONE`, { table, key });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (ctor === 'type::record' && /parse|syntax|unknown function|thing/i.test(msg)) {
            await db.query(`DELETE type::thing($table, $key) RETURN NONE`, {
                table,
                key,
            });
            ctorByClient.set(db as object, 'type::thing');
            return;
        }
        throw err;
    }
}

/**
 * Read logical application key from a stored document (logicalKey, key, or string id).
 */
export function readLogicalKey(doc: Record<string, unknown>): string {
    if (typeof doc.logicalKey === 'string' && doc.logicalKey.length > 0) {
        return doc.logicalKey;
    }
    if (typeof doc.key === 'string' && doc.key.length > 0) {
        return doc.key;
    }
    if (typeof doc.id === 'string' && doc.id.length > 0) {
        return doc.id;
    }
    return '';
}
