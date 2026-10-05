/**
 * Phase 4 — Better Auth schema on the Dashboard SQL backend (same DB file/pool).
 * Table/column names match better-auth@1.7 default Kysely/SQLite expectations.
 */

import { ensureDashboardAdapter } from '../../../dash-data/src/lib/store.js';
import type { SqlAdapter } from '#core/database/sqlAdapter.js';

export const BETTER_AUTH_SCHEMA_VERSION = 2 as const;

/**
 * Canonical better-auth core tables (default model names).
 * Column names use the library's expected identifiers for SQLite validation.
 */
export const BETTER_AUTH_TABLES = ['user', 'session', 'account', 'verification'] as const;

export type BetterAuthTable = (typeof BETTER_AUTH_TABLES)[number];

const DDL: Record<BetterAuthTable, string> = {
    user: `
CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
)`,
    session: `
CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
)`,
    account: `
CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
)`,
    verification: `
CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER,
  "updatedAt" INTEGER
)`,
};

const META_DDL = `
CREATE TABLE IF NOT EXISTS ba_schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
)`;

export interface SchemaEnsureResult {
    readonly ok: true;
    readonly version: typeof BETTER_AUTH_SCHEMA_VERSION;
    readonly created: readonly string[];
    readonly engine: string;
}

export interface SchemaEnsureError {
    readonly ok: false;
    readonly reason: 'MONGO_UNSUPPORTED' | 'MIGRATION_FAILED' | 'ADAPTER_UNAVAILABLE';
    readonly message: string;
}

/**
 * Idempotent schema ensure — CREATE IF NOT EXISTS only. Never drops tables.
 */
export async function ensureBetterAuthSchema(
    adapter?: SqlAdapter,
): Promise<SchemaEnsureResult | SchemaEnsureError> {
    let db: SqlAdapter;
    try {
        db = adapter ?? (await ensureDashboardAdapter());
    } catch (e) {
        return {
            ok: false,
            reason: 'ADAPTER_UNAVAILABLE',
            message: e instanceof Error ? e.message : 'adapter_unavailable',
        };
    }
    if (db.engine === 'mongo') {
        return {
            ok: false,
            reason: 'MONGO_UNSUPPORTED',
            message: 'Better Auth schema requires SQL adapter (postgres/sqlite/mysql)',
        };
    }

    const created: string[] = [];
    try {
        await db.run(META_DDL, []);
        for (const table of BETTER_AUTH_TABLES) {
            await db.run(DDL[table], []);
            created.push(table);
        }
        const row = await db.get(`SELECT value FROM ba_schema_meta WHERE key = ?`, ['schema_version']);
        if (!row) {
            await db.run(`INSERT INTO ba_schema_meta (key, value) VALUES (?, ?)`, [
                'schema_version',
                String(BETTER_AUTH_SCHEMA_VERSION),
            ]);
        } else {
            await db.run(`UPDATE ba_schema_meta SET value = ? WHERE key = ?`, [
                String(BETTER_AUTH_SCHEMA_VERSION),
                'schema_version',
            ]);
        }
        return { ok: true, version: BETTER_AUTH_SCHEMA_VERSION, created, engine: db.engine };
    } catch (e) {
        return {
            ok: false,
            reason: 'MIGRATION_FAILED',
            message: e instanceof Error ? e.message : 'migration_failed',
        };
    }
}

export async function readBetterAuthSchemaVersion(adapter?: SqlAdapter): Promise<number | null> {
    try {
        const db = adapter ?? (await ensureDashboardAdapter());
        if (db.engine === 'mongo') return null;
        const row = await db.get(`SELECT value FROM ba_schema_meta WHERE key = ?`, ['schema_version']);
        if (!row || typeof row.value !== 'string') return null;
        const n = Number(row.value);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

/**
 * Config flag for migration phase cutover.
 * 2 = parallel, 3 = BA preferred + controlled legacy, 4 = BA-only.
 */
export type AuthCutoverPhase = 2 | 3 | 4;

let cutoverPhase: AuthCutoverPhase = 2;

export function getAuthCutoverPhase(): AuthCutoverPhase {
    return cutoverPhase;
}

export function setAuthCutoverPhase(phase: AuthCutoverPhase): void {
    cutoverPhase = phase;
}

export function isLegacyAuthAllowed(): boolean {
    return cutoverPhase < 4;
}
