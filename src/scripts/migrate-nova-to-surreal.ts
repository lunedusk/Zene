/**
 * One-shot helper: copy former NovaDB dash collections into SurrealDB `main`.
 *
 * NovaDB was removed from the runtime. This script expects you to either:
 * - Restore a backup of `.data/database/<alias>/` **and** a prior release binary
 *   that can read NovaDB, then adapt this script; or
 * - Point `NOVA_EXPORT_JSON` at a JSON export produced offline.
 *
 * Supported JSON export shape (array of docs per collection):
 * {
 *   "dash_infractions": [ { "_id": "...", ... }, ... ],
 *   "dash_audit_log": [ ... ],
 *   "dash_command_counters": [ ... ]
 * }
 *
 * Usage (after Surreal `main` is reachable — embedded or remote):
 *   NOVA_EXPORT_JSON=./nova-export.json npx tsx --import ./src/core/dependency/index.mts ./src/scripts/migrate-nova-to-surreal.ts
 *
 * Env:
 *   SURREAL_URI          default rocksdb://local (resolved under .data/database/surreal/rocksdb/migrate)
 *   SURREAL_NAMESPACE    default main
 *   SURREAL_DATABASE     default main
 *   SURREAL_USERNAME / SURREAL_PASSWORD / SURREAL_TOKEN  optional auth
 *   NOVA_EXPORT_JSON     path to export file (required)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Surreal, createRemoteEngines } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { resolveSurrealUri } from '#core/database/surreal.js';

const TABLES = ['dash_infractions', 'dash_audit_log', 'dash_command_counters'] as const;

type Doc = Record<string, unknown> & { _id?: string };

function loadExport(filePath: string): Record<string, Doc[]> {
    const abs = path.resolve(filePath);
    if (!existsSync(abs)) {
        throw new Error(`NOVA_EXPORT_JSON not found: ${abs}`);
    }
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('Export JSON must be an object of collection name → document array');
    }
    const out: Record<string, Doc[]> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!Array.isArray(value)) {
            throw new Error(`Export collection "${name}" must be an array`);
        }
        out[name] = value as Doc[];
    }
    return out;
}

async function upsertDoc(db: Surreal, table: string, doc: Doc): Promise<void> {
    const key = String(doc._id ?? '');
    if (!key) return;
    if (doc.__deleted__ === true) {
        await db.query('DELETE type::thing($table, $key) RETURN NONE', { table, key });
        return;
    }
    const data: Record<string, unknown> = { key };
    for (const [k, v] of Object.entries(doc)) {
        if (k === '_id' || k.startsWith('__')) continue;
        data[k] = v;
    }
    await db.query('UPSERT type::thing($table, $key) CONTENT $data RETURN NONE', {
        table,
        key,
        data,
    });
}

async function main(): Promise<void> {
    const exportPath = process.env.NOVA_EXPORT_JSON;
    if (!exportPath) {
        console.error('Set NOVA_EXPORT_JSON to a JSON export of Nova collections.');
        process.exit(1);
    }

    const data = loadExport(exportPath);
    const uri = process.env.SURREAL_URI ?? 'rocksdb://local';
    const resolved = resolveSurrealUri(uri, 'migrate');

    const db = new Surreal({
        engines: {
            ...createRemoteEngines(),
            ...createNodeEngines(),
        },
    });

    console.log(`Connecting Surreal at ${resolved}…`);
    await db.connect(resolved);

    const ns = process.env.SURREAL_NAMESPACE ?? 'main';
    const database = process.env.SURREAL_DATABASE ?? 'main';
    await db.use({ namespace: ns, database });

    if (process.env.SURREAL_TOKEN) {
        await db.authenticate(process.env.SURREAL_TOKEN);
    } else if (process.env.SURREAL_USERNAME && process.env.SURREAL_PASSWORD) {
        await db.signin({
            username: process.env.SURREAL_USERNAME,
            password: process.env.SURREAL_PASSWORD,
        });
    }

    let total = 0;
    for (const table of TABLES) {
        const docs = data[table] ?? [];
        console.log(`Migrating ${table}: ${docs.length} docs`);
        for (const doc of docs) {
            await upsertDoc(db, table, doc);
            total += 1;
        }
    }

    await db.close();
    console.log(`Done. Upserted ${total} documents into Surreal (${ns}/${database}).`);
}

main().catch((err: unknown) => {
    const e = err as Error;
    console.error(e.message);
    process.exit(1);
});
