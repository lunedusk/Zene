/**
 * One-shot helper: copy former NovaDB dash collections into SurrealDB `main`.
 *
 * Expects NOVA_EXPORT_JSON pointing at:
 * {
 *   "dash_infractions": [ { "_id": "...", ... }, ... ],
 *   "dash_audit_log": [ ... ],
 *   "dash_command_counters": [ ... ]
 * }
 *
 * Usage:
 *   NOVA_EXPORT_JSON=./nova-export.json npx tsx --import ./src/core/dependency/index.mts ./src/scripts/migrate-nova-to-surreal.ts
 *
 * Env:
 *   SURREAL_URI          default rocksdb://local
 *   SURREAL_NAMESPACE    default main
 *   SURREAL_DATABASE     default main
 *   SURREAL_USERNAME / SURREAL_PASSWORD / SURREAL_TOKEN  optional (non-empty only)
 *   NOVA_EXPORT_JSON     path to export file (required)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
    Surreal,
    createRemoteEngines,
    type DriverOptions,
    type ConnectOptions,
} from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { WebSocket as NodeWebSocket } from 'ws';
import { resolveSurrealUri } from '#core/database/surreal.js';
import {
    surrealUpsertByKey,
    surrealDeleteByKey,
} from '#core/database/surrealRecord.js';

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
        await surrealDeleteByKey(db, table, key, TABLES);
        return;
    }
    const data: Record<string, unknown> = { key };
    for (const [k, v] of Object.entries(doc)) {
        if (k === '_id' || k === 'id' || k.startsWith('__')) continue;
        data[k] = v;
    }
    await surrealUpsertByKey(db, table, key, data, TABLES);
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

    const driverOptions: DriverOptions = {
        engines: {
            ...createRemoteEngines(),
            ...createNodeEngines(),
        },
        websocketImpl: NodeWebSocket as unknown as DriverOptions['websocketImpl'],
    };
    const db = new Surreal(driverOptions);

    const connectOpts: ConnectOptions = {
        namespace: process.env.SURREAL_NAMESPACE ?? 'main',
        database: process.env.SURREAL_DATABASE ?? 'main',
    };
    const token = process.env.SURREAL_TOKEN;
    const user = process.env.SURREAL_USERNAME;
    if (token !== undefined && token !== '') {
        connectOpts.authentication = token;
    } else if (user !== undefined && user !== '') {
        connectOpts.authentication = {
            username: user,
            password: process.env.SURREAL_PASSWORD ?? '',
        };
    }

    console.log(`Connecting Surreal at ${resolved}…`);
    try {
        await db.connect(resolved, connectOpts);
    } catch (err) {
        try {
            await db.close();
        } catch {
            // ignore
        }
        throw err;
    }

    let total = 0;
    try {
        for (const table of TABLES) {
            const docs = data[table] ?? [];
            console.log(`Migrating ${table}: ${docs.length} docs`);
            for (const doc of docs) {
                await upsertDoc(db, table, doc);
                total += 1;
            }
        }
    } finally {
        await db.close();
    }

    console.log(
        `Done. Upserted ${total} documents into Surreal (${connectOpts.namespace}/${connectOpts.database}).`,
    );
}

main().catch((err: unknown) => {
    const e = err as Error;
    console.error(e.message);
    process.exit(1);
});
