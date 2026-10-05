/**
 * Resolve the native database handle Better Auth requires, from the same
 * Dashboard SQL backend (no second identity database).
 *
 * better-auth@1.7 expects a better-sqlite3 Database (or pg Pool), not SqlAdapter.
 */

import { ensureDashboardAdapter } from '../../../dash-data/src/lib/store.js';

export type BetterAuthNativeDatabase =
    | { engine: 'sqlite'; handle: import('better-sqlite3').Database; alias: string }
    | { engine: 'postgres'; handle: unknown; alias: string };

/**
 * Obtain the underlying driver instance for the dashboard main alias.
 * Shares the same SQLite file / Postgres pool as dash-data SqlAdapter.
 */
export async function resolveBetterAuthNativeDatabase(): Promise<BetterAuthNativeDatabase> {
    const adapter = await ensureDashboardAdapter();
    if (adapter.engine === 'mongo') {
        throw new Error('Better Auth requires SQL engine (sqlite/postgres); mongo is unsupported');
    }
    if (adapter.engine === 'sqlite') {
        const { sqliteDB } = await import('#core/database/sqlite.js');
        if (!sqliteDB.has(adapter.alias)) {
            throw new Error(`Native SQLite [${adapter.alias}] not connected for Better Auth`);
        }
        return { engine: 'sqlite', handle: sqliteDB.get(adapter.alias), alias: adapter.alias };
    }
    // postgres — same pool as SqlAdapter
    const { pgDB } = await import('#core/database/postgres.js');
    try {
        const pool = pgDB.get(adapter.alias);
        return { engine: 'postgres', handle: pool, alias: adapter.alias };
    } catch (e) {
        throw new Error(
            `Postgres pool [${adapter.alias}] not available for Better Auth: ${
                e instanceof Error ? e.message : 'missing'
            }`,
        );
    }
}
