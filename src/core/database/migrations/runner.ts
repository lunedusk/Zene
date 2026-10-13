import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLogger } from '#core/utils/logger.js';
import { resolvePermissionsBackend } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter } from '#core/database/sqlAdapter.js';
import { registerMigrationScope, getRegisteredScopes } from './registry.js';
import { coreMigrationSteps } from './core/index.js';
import type { MigrationScope, MigrationStep, MigrationContext } from './types.js';

const log = getLogger('Migrations');

const CORE_SCOPE = 'core';

let migrationRunLock: Promise<{ failedPlugins: string[] }> | null = null;

async function ensureMigrationsTable(adapter: SqlAdapter): Promise<void> {
    if (adapter.engine === 'mongo') {
        try {
            const { mongoDB } = await import('#core/database/mongo.js');
            const conn = mongoDB.get(adapter.alias);
            const db = conn.db;
            if (db) {
                await db.collection('schema_migrations').createIndex(
                    { scope: 1, version: 1 },
                    { unique: true },
                );
            }
        } catch {
            return;
        }
        return;
    }
    try {
        await adapter.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
    scope      TEXT    NOT NULL,
    version    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    applied_at BIGINT  NOT NULL,
    PRIMARY KEY (scope, version)
);
`);
    } catch (err: unknown) {
        const code =
            err && typeof err === 'object' && 'code' in err
                ? String((err as { code: unknown }).code)
                : '';
        if (code === '23505' || code === '42P07') {
            return;
        }
        throw err;
    }
}

async function loadAppliedVersions(adapter: SqlAdapter, scope: string): Promise<Set<number>> {
    if (adapter.engine === 'mongo') {
        const rows = await adapter.mongoCollection('schema_migrations').find({ scope });
        return new Set(rows.map((r) => Number(r.version)));
    }
    const rows = await adapter.all(
        `SELECT version FROM schema_migrations WHERE scope = ? ORDER BY version`,
        [scope],
    );
    return new Set(rows.map((r) => Number(r.version)));
}

async function recordApplied(
    adapter: SqlAdapter,
    scope: string,
    step: MigrationStep,
    appliedAt: number,
): Promise<void> {
    if (adapter.engine === 'mongo') {
        await adapter.mongoCollection('schema_migrations').updateOne(
            { scope, version: step.version },
            {
                $set: {
                    scope,
                    version: step.version,
                    name: step.name,
                    applied_at: appliedAt,
                },
            },
            { upsert: true },
        );
        return;
    }
    await adapter.run(
        `INSERT INTO schema_migrations (scope, version, name, applied_at) VALUES (?, ?, ?, ?)`,
        [scope, step.version, step.name, appliedAt],
    );
}

async function applyStepTransactional(
    adapter: SqlAdapter,
    ctx: MigrationContext,
    step: MigrationStep,
): Promise<void> {
    const appliedAt = Math.floor(Date.now() / 1000);

    if (adapter.engine === 'mongo') {
        await step.up(ctx);
        await recordApplied(adapter, ctx.scope, step, appliedAt);
        return;
    }

    if (adapter.engine === 'postgres') {
        const { pgDB } = await import('#core/database/postgres.js');
        const pool = pgDB.get(adapter.alias);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const txAdapter = createPgClientAdapter(adapter.alias, client);
            const txCtx: MigrationContext = { ...ctx, adapter: txAdapter };
            await step.up(txCtx);
            await txAdapter.run(
                `INSERT INTO schema_migrations (scope, version, name, applied_at) VALUES (?, ?, ?, ?)`,
                [ctx.scope, step.version, step.name, appliedAt],
            );
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
        return;
    }

    await step.up(ctx);
    await recordApplied(adapter, ctx.scope, step, appliedAt);
}

function createPgClientAdapter(alias: string, client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }): SqlAdapter {
    let i = 0;
    const toPg = (sql: string) => {
        i = 0;
        return sql.replace(/\?/g, () => `$${++i}`);
    };
    return {
        engine: 'postgres',
        alias,
        async exec(sql: string) {
            await client.query(sql);
        },
        async run(sql: string, params: unknown[] = []) {
            i = 0;
            await client.query(toPg(sql), params);
        },
        async get(sql: string, params: unknown[] = []) {
            i = 0;
            const r = await client.query(toPg(sql), params);
            return (r.rows[0] as Record<string, unknown>) ?? null;
        },
        async all(sql: string, params: unknown[] = []) {
            i = 0;
            const r = await client.query(toPg(sql), params);
            return r.rows as Record<string, unknown>[];
        },
        async withTransaction(fn) {
            await fn();
        },
        mongoCollection(): never {
            throw new Error('mongoCollection is only available on mongo engine');
        },
    };
}

async function applyStepSqlite(
    adapter: SqlAdapter,
    ctx: MigrationContext,
    step: MigrationStep,
): Promise<void> {
    const { sqliteDB } = await import('#core/database/sqlite.js');
    const db = sqliteDB.get(adapter.alias);
    const appliedAt = Math.floor(Date.now() / 1000);

    const ops: Array<() => void> = [];
    const capturing: SqlAdapter = {
        engine: 'sqlite',
        alias: adapter.alias,
        async exec(sql: string) {
            ops.push(() => {
                db.exec(sql);
            });
        },
        async run(sql: string, params: unknown[] = []) {
            ops.push(() => {
                db.prepare(sql).run(...params);
            });
        },
        async get(sql: string, params: unknown[] = []) {
            return (db.prepare(sql).get(...params) as Record<string, unknown>) ?? null;
        },
        async all(sql: string, params: unknown[] = []) {
            return db.prepare(sql).all(...params) as Record<string, unknown>[];
        },
        async withTransaction(fn) {
            await fn();
        },
        mongoCollection(): never {
            throw new Error('mongoCollection is only available on mongo engine');
        },
    };

    await step.up({ ...ctx, adapter: capturing });

    const tx = db.transaction(() => {
        for (const op of ops) op();
        db.prepare(
            `INSERT INTO schema_migrations (scope, version, name, applied_at) VALUES (?, ?, ?, ?)`,
        ).run(ctx.scope, step.version, step.name, appliedAt);
    });
    tx();
}

async function runScope(scope: MigrationScope, adapter: SqlAdapter): Promise<void> {
    await ensureMigrationsTable(adapter);
    const applied = await loadAppliedVersions(adapter, scope.id);
    const appliedSorted = [...applied].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    let lastApplied = appliedSorted.length > 0 ? appliedSorted[appliedSorted.length - 1]! : 0;

    for (const step of scope.steps) {
        if (applied.has(step.version)) {
            continue;
        }
        const expected = lastApplied + 1;
        if (step.version !== expected) {
            throw new Error(
                `Migration gap in scope "${scope.id}": expected version ${expected}, found ${step.version}`,
            );
        }

        log.info(`Applying ${scope.id}@${step.version} (${step.name}) on ${adapter.engine}/${adapter.alias}`);
        const ctx: MigrationContext = {
            scope: scope.id,
            engine: adapter.engine,
            adapter,
        };

        try {
            if (adapter.engine === 'sqlite') {
                await applyStepSqlite(adapter, ctx, step);
            } else if (adapter.engine === 'postgres') {
                await applyStepTransactional(adapter, ctx, step);
            } else {
                await step.up(ctx);
                await recordApplied(adapter, scope.id, step, Math.floor(Date.now() / 1000));
            }
            lastApplied = step.version;
            applied.add(step.version);
            log.info(`Applied ${scope.id}@${step.version}`);
        } catch (err) {
            const e = err as Error;
            log.error(`Migration failed ${scope.id}@${step.version}: ${e.message}`);
            throw err;
        }
    }
}

async function tryLoadPluginMigrations(
    pluginDir: string,
    _pluginId: string,
): Promise<MigrationStep[] | null> {
    const candidates = [
        path.join(pluginDir, 'migrations', 'index.js'),
        path.join(pluginDir, 'migrations.js'),
    ];
    for (const file of candidates) {
        try {
            const url = pathToFileURL(file).href + `?v=${Date.now()}`;
            const mod = await import(url);
            const steps = mod.migrations ?? mod.default;
            if (Array.isArray(steps) && steps.length > 0) {
                return steps as MigrationStep[];
            }
        } catch {
            continue;
        }
    }
    return null;
}

export async function discoverAndRegisterPluginMigrations(
    plugins: Array<{ dir: string; id: string }>,
): Promise<void> {
    for (const p of plugins) {
        const steps = await tryLoadPluginMigrations(p.dir, p.id);
        if (!steps || steps.length === 0) continue;
        registerMigrationScope(`plugin:${p.id}`, steps);
        log.info(`Registered ${steps.length} migration step(s) for plugin:${p.id}`);
    }
}

export async function runAllMigrations(opts?: {
    plugins?: Array<{ dir: string; id: string }>;
}): Promise<{ failedPlugins: string[] }> {
    if (migrationRunLock) {
        return migrationRunLock;
    }

    migrationRunLock = (async () => {
        const failedPlugins: string[] = [];
        registerMigrationScope(CORE_SCOPE, coreMigrationSteps);

        if (opts?.plugins?.length) {
            await discoverAndRegisterPluginMigrations(opts.plugins);
        }

        const choice = resolvePermissionsBackend();
        let coreAdapter: SqlAdapter;
        try {
            coreAdapter = openSqlAdapter(choice);
        } catch (err) {
            log.error(`Cannot open core migration backend: ${(err as Error).message}`);
            throw err;
        }

        if (coreAdapter.engine === 'postgres') {
            try {
                await coreAdapter.exec('SELECT pg_advisory_lock(872014001)');
            } catch (err) {
                log.warn('Could not acquire migration advisory lock', err);
            }
        }

        try {
            const scopes = getRegisteredScopes();
            const core = scopes.find((s) => s.id === CORE_SCOPE);
            const plugins = scopes.filter((s) => s.id !== CORE_SCOPE);

            if (core) {
                await runScope(core, coreAdapter);
            }

            for (const scope of plugins) {
                try {
                    const adapter = openSqlAdapter(
                        scope.alias
                            ? { engine: choice.engine, alias: scope.alias }
                            : choice,
                    );
                    await runScope(scope, adapter);
                } catch (err) {
                    const msg = (err as Error).message;
                    if (/not connected|not found/i.test(msg)) {
                        log.debug(`Skipping migration scope ${scope.id}: ${msg}`);
                        continue;
                    }
                    const pluginId = scope.id.startsWith('plugin:')
                        ? scope.id.slice('plugin:'.length)
                        : scope.id;
                    log.error(
                        `Plugin migration failed for ${scope.id}; plugin will be disabled: ${msg}`,
                    );
                    failedPlugins.push(pluginId);
                    void import('#core/manager/event.js')
                        .then(({ eventBus }) =>
                            eventBus.emitConcurrent('system.migration.plugin_failed', {
                                pluginId,
                                error: msg,
                            }),
                        )
                        .catch(() => undefined);
                }
            }
            void import('#core/manager/event.js')
                .then(({ eventBus }) =>
                    eventBus.emitConcurrent('system.migration.complete', {
                        scope: 'all',
                        applied: 0,
                        failed: failedPlugins.length,
                        failedPlugins,
                    }),
                )
                .catch(() => undefined);
            return { failedPlugins };
        } finally {
            if (coreAdapter.engine === 'postgres') {
                try {
                    await coreAdapter.exec('SELECT pg_advisory_unlock(872014001)');
                } catch {

                }
            }
        }
    })();

    try {
        return await migrationRunLock;
    } catch (err) {
        migrationRunLock = null;
        throw err;
    }
}
