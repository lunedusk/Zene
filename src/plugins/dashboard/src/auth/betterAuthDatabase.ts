






import { ensureDashboardAdapter } from '../../../dash-data/src/lib/store.js';

export type BetterAuthNativeDatabase =
    | { engine: 'sqlite'; handle: import('better-sqlite3').Database; alias: string }
    | { engine: 'postgres'; handle: unknown; alias: string };





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
