import { sqliteDB } from '#core/database/sqlite.js';
import { pgDB } from '#core/database/postgres.js';
import { mongoDB } from '#core/database/mongo.js';
import { surrealDB } from '#core/database/surreal.js';
import { redisDB } from '#core/database/redis.js';
import { DataRegistryError } from '../errors.js';
import type {
    DataStorageAdapter,
    DataStorageEngine,
    DurableDataStorageEngine,
} from '../types.js';
import { isDurableEngine } from '../storage.js';
import { createSqliteDataAdapter, createPostgresDataAdapter } from './sql.js';
import { createMongoDataAdapter } from './mongo.js';
import { createSurrealDataAdapter } from './surreal.js';
import { createRedisDataAdapter } from './redis.js';
import { MemoryDataAdapter } from './memory.js';

export interface CreateAdapterOptions {
    readonly engine: DataStorageEngine;
    readonly alias?: string;
    readonly allowMemory?: boolean;
}

function assertConnected(
    engine: DurableDataStorageEngine,
    alias: string,
): void {
    let ok = false;
    try {
        if (engine === 'sqlite') ok = sqliteDB.has(alias);
        else if (engine === 'postgres') ok = pgDB.has(alias);
        else if (engine === 'mongo') ok = mongoDB.has(alias);
        else if (engine === 'surreal') ok = surrealDB.has(alias);
        else if (engine === 'redis') ok = redisDB.has(alias);
    } catch {
        ok = false;
    }
    if (!ok) {
        throw new DataRegistryError(
            'DATA_BACKEND_UNAVAILABLE',
            `Configured data engine '${engine}' alias '${alias}' is not connected`,
        );
    }
}

/**
 * Construct a storage adapter for the given engine using existing DB managers.
 * Never falls back to memory when a durable engine is requested.
 */
export function createDataStorageAdapter(
    options: CreateAdapterOptions,
): DataStorageAdapter {
    const alias = (options.alias ?? 'main').toString().trim() || 'main';
    const engine = options.engine;

    if (engine === 'memory') {
        if (!options.allowMemory) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                'Memory data adapter requires allowMemory',
            );
        }
        return new MemoryDataAdapter();
    }

    if (!isDurableEngine(engine)) {
        throw new DataRegistryError(
            'DATA_INVALID_STORAGE',
            `Unknown data storage engine '${String(engine)}'`,
        );
    }

    assertConnected(engine, alias);

    switch (engine) {
        case 'sqlite':
            return createSqliteDataAdapter(alias);
        case 'postgres':
            return createPostgresDataAdapter(alias);
        case 'mongo':
            return createMongoDataAdapter(alias);
        case 'surreal':
            return createSurrealDataAdapter(alias);
        case 'redis':
            return createRedisDataAdapter(alias);
        default: {
            const _exhaustive: never = engine;
            void _exhaustive;
            throw new DataRegistryError(
                'DATA_INVALID_STORAGE',
                'Unhandled durable engine',
            );
        }
    }
}
