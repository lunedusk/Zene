import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { redisDB } from './redis.js';
import { ormDB } from './typeorm.js';
import { mongoDB } from './mongo.js';
import { pgDB } from './postgres.js';
import { sqliteDB } from './sqlite.js';
import {
    surrealDB,
    extractUriProtocol,
    isSurrealProtocol,
    isSurrealEmbeddedProtocol,
    type SurrealConnectOptions,
} from './surreal.js';

const log = getLogger('DBManager');

export interface DbConfig {
    alias: string;
    uri: string;
    engine?: 'native-pg' | 'native-sqlite' | 'typeorm' | 'redis' | 'mongo' | 'surrealdb';
    entities?: any[];
    poolSize?: number;
    maxRetries?: number;
    /** SurrealDB: namespace selected after connect */
    namespace?: string;
    /** SurrealDB: database selected after connect */
    database?: string;
    /** SurrealDB: root/namespace/database username for signin */
    username?: string;
    /** SurrealDB: password for signin */
    password?: string;
    /** SurrealDB: bearer/token auth (alternative to username/password) */
    token?: string;
}

export class DatabaseManager {
    private static async withRetry(operation: () => Promise<void> | void, alias: string, retries = 5): Promise<void> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await operation();
                return;
            } catch (error) {
                if (attempt === retries) throw error;
                const delay = Math.min(1000 * (2 ** attempt), 10000);
                log.warn(`DB [${alias}] connection failed. Retrying in ${delay / 1000}s... (Attempt ${attempt}/${retries})`);
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }

    public static async init(config: DbConfig): Promise<void> {
        const retries = config.maxRetries ?? 5;
        const poolSize = config.poolSize ?? 10;
        const hasEntities = config.entities && config.entities.length > 0;

        await this.withRetry(async () => {
            // Prefer scheme extraction that tolerates embedded paths (rocksdb://./data/…)
            let protocol = extractUriProtocol(config.uri);
            if (!protocol) {
                try {
                    protocol = new URL(config.uri).protocol.replace(':', '');
                } catch {
                    protocol = '';
                }
            }

            if (config.engine === 'native-pg' || protocol === 'postgres-native') {
                await pgDB.connect(config.alias, config.uri, poolSize);
                return;
            }

            const isNativeSqlite = config.engine === 'native-sqlite' ||
                (protocol === 'sqlite' && !hasEntities && config.engine !== 'typeorm');
            if (isNativeSqlite) {
                if (secrets.getBoolean('CROSS_HOST', false)) {
                    throw new Error(
                        `CROSS_HOST forbids sqlite/local-file engines. Database[${config.alias}] engine=native-sqlite/sqlite.`,
                    );
                }
                sqliteDB.connect(config.alias, config.uri);
                return;
            }

            const isSurreal =
                config.engine === 'surrealdb' || isSurrealProtocol(protocol);
            if (isSurreal) {
                if (
                    isSurrealEmbeddedProtocol(protocol) &&
                    secrets.getBoolean('CROSS_HOST', false)
                ) {
                    throw new Error(
                        `CROSS_HOST forbids embedded SurrealDB engines. Database[${config.alias}] protocol=${protocol || 'embedded'}.`,
                    );
                }
                const surrealOpts: SurrealConnectOptions = {
                    namespace: config.namespace,
                    database: config.database,
                    username: config.username,
                    password: config.password,
                    token: config.token,
                };
                await surrealDB.connect(config.alias, config.uri, surrealOpts);
                return;
            }

            switch (protocol) {
                case 'redis':
                case 'rediss':
                    await redisDB.connect(config.alias, config.uri);
                    break;
                case 'mongodb':
                case 'mongodb+srv':
                    await mongoDB.connect(config.alias, config.uri, poolSize);
                    break;
                case 'postgres':
                case 'postgresql':
                case 'mysql':
                case 'mariadb':
                case 'sqlite':
                    if (secrets.getBoolean('CROSS_HOST', false)) {
                        throw new Error(
                            `CROSS_HOST forbids sqlite/local-file engines. Database[${config.alias}] protocol=sqlite.`,
                        );
                    }
                    await ormDB.connect(config.alias, config.uri, config.entities || [], poolSize);
                    break;
                default:
                    log.warn(`Unknown protocol: ${protocol} for alias [${config.alias}]. Skipping.`);
            }
        }, config.alias, retries).catch((err) => {
            const error = err as Error;
            log.error(`CRITICAL: Exhausted retries for DB [${config.alias}]. ${error.message}`, { stack: error.stack });
            throw error;
        });
    }

    public static async healthCheck(): Promise<Record<string, boolean>> {
        log.debug('Running global database health check...');
        const status: Record<string, boolean> = {};

        Object.assign(status, await redisDB.pingAll());
        Object.assign(status, await pgDB.pingAll());
        Object.assign(status, await mongoDB.pingAll());
        Object.assign(status, await ormDB.pingAll());
        Object.assign(status, await sqliteDB.pingAll());
        Object.assign(status, await surrealDB.pingAll());

        return status;
    }

    public static async closeAll(): Promise<void> {
        log.warn('Initiating global database shutdown...');
        try {
            await Promise.all([
                redisDB.disconnectAll(),
                ormDB.disconnectAll(),
                mongoDB.disconnectAll(),
                pgDB.disconnectAll(),
                sqliteDB.disconnectAll(),
                surrealDB.disconnectAll(),
            ]);
            log.info('All databases closed safely.');
            void import('#core/manager/event.js')
                .then(({ eventBus }) =>
                    eventBus.emitConcurrent('system.database.closed', { at: Date.now() }),
                )
                .catch(() => undefined);

        } catch (error) {
            const err = error as Error;
            log.error(`Error during database shutdown: ${err.message}`, { stack: err.stack });
        }
    }
}
export { redisDB, ormDB, mongoDB, pgDB, sqliteDB, surrealDB };