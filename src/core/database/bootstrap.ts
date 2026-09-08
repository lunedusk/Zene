import { DatabaseManager, type DbConfig, surrealDB } from '#core/database/index.js';
import { secrets } from '../helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';
import path from 'node:path';
import fs from 'node:fs';
import { sqliteDB } from '#core/database/sqlite.js';

const log = getLogger('DatabaseBootstrap');

function parseIntOrNull(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function asOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function loadDbConfigsFromEnv(): DbConfig[] {
    const raw = secrets.getOptional('Database') ?? '{}';

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        log.error('Failed to parse Database env var as JSON:', err);
        return [];
    }

    if (typeof parsed !== 'object' || parsed === null) {
        log.error('Database env var must be a JSON object of alias -> { uri, engine?, poolSize?, maxRetries? }');
        return [];
    }

    const configs: DbConfig[] = [];

    for (const [alias, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') {
            log.warn(`Skipping Database[${alias}] because it is not an object.`);
            continue;
        }

        const entry = value as Record<string, unknown>;
        const uri = asOptionalString(entry.uri);
        if (!uri) {
            log.warn(`Skipping Database[${alias}] because "uri" is missing.`);
            continue;
        }

        const engine = asOptionalString(entry.engine) as DbConfig['engine'] | undefined;
        const poolSize = parseIntOrNull(entry.poolSize);
        const maxRetries = parseIntOrNull(entry.maxRetries);

        const cfg: DbConfig = {
            alias,
            uri,
            engine,
            poolSize,
            maxRetries,
            namespace: asOptionalString(entry.namespace),
            database: asOptionalString(entry.database),
            username: asOptionalString(entry.username),
            password: asOptionalString(entry.password),
            token: asOptionalString(entry.token),
        };

        configs.push(cfg);
    }

    return configs;
}

export async function initAllDatabases(): Promise<void> {
    const configs = loadDbConfigsFromEnv();

    if (!configs.length) {
        log.warn('No database configurations found in env variable "Database". Proceeding to verify defaults...');
    }

    for (const cfg of configs) {
        try {
            log.info(`Initializing database [${cfg.alias}]...`);
            await DatabaseManager.init(cfg);
            log.info(`Database [${cfg.alias}] initialized successfully.`);
            void import('#core/manager/event.js')
                .then(({ eventBus }) =>
                    eventBus.emitConcurrent('system.database.ready', {
                        alias: cfg.alias,
                        engine: cfg.engine,
                    }),
                )
                .catch(() => undefined);

        } catch (error) {
            const err = error as Error;
            log.error(`Failed to initialize database [${cfg.alias}]: ${err.message}`, { stack: err.stack });
        }
    }

    const hasSqliteMain = (() => {
        try { sqliteDB.get('main'); return true; } catch { return false; }
    })();

    if (!hasSqliteMain) {
        const crossHost = secrets.getBoolean('CROSS_HOST', false);
        const disableDefaultSqlite = secrets.getBoolean('DisableDefaultSqlite', false);

        if (crossHost) {
            log.info(
                'CROSS_HOST is enabled: skipping default "main" SQLite instance (sqlite/file engines are forbidden for multi-host).',
            );
        } else if (disableDefaultSqlite) {
            log.warn('DisableDefaultSqlite is set to true. Skipping default "main" SQLite instance. The permission system and other core features that depend on SQLite will not function.');
        } else {
            const sqliteDir = path.join(process.cwd(), '.data', 'database-sqlite');
            if (!fs.existsSync(sqliteDir)) {
                fs.mkdirSync(sqliteDir, { recursive: true });
            }

            const sqlitePath = path.join(sqliteDir, 'main.db');
            sqliteDB.connect('main', sqlitePath);

            log.info('Default "main" SQLite instance provisioned at .data/database-sqlite/main.db');
        }
    }

    const hasSurrealMain = (() => {
        try {
            surrealDB.get('main');
            return true;
        } catch {
            return false;
        }
    })();

    if (!hasSurrealMain) {
        const crossHost = secrets.getBoolean('CROSS_HOST', false);
        const disableDefaultSurrealDB = secrets.getBoolean('DisableDefaultSurrealDB', false);

        if (crossHost) {
            log.info(
                'CROSS_HOST is enabled: skipping default "main" SurrealDB instance (embedded local-file engines are forbidden for multi-host).',
            );
        } else if (disableDefaultSurrealDB) {
            log.warn(
                'DisableDefaultSurrealDB is set to true. Skipping default "main" SurrealDB instance.',
            );
        } else {
            try {
                await DatabaseManager.init({
                    alias: 'main',
                    uri: 'rocksdb://local',
                    engine: 'surrealdb',
                    maxRetries: 3,
                    namespace: 'main',
                    database: 'main',
                });
                log.info(
                    'Default "main" SurrealDB instance provisioned at .data/database/surreal/rocksdb/main',
                );
            } catch (error) {
                const err = error as Error;
                log.error(
                    `Failed to provision default "main" SurrealDB: ${err.message}`,
                    { stack: err.stack },
                );
            }
        }
    }
}
