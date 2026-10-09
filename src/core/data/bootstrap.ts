/**
 * Data platform bootstrap — after database connections are available.
 */

import { getLogger } from '#core/utils/logger.js';
import { resolveCoreDataBackend } from '#core/database/backendSelector.js';
import { dataRegistry } from './registry.js';
import { DataRegistryError } from './errors.js';
import { createDataStorageAdapter } from './adapters/factory.js';
import { isDurableEngine } from './storage.js';
import type { DataStorageAdapter, DataStorageEngine } from './types.js';

const log = getLogger('DataBootstrap');

export interface DataPlatformConfig {
    readonly allowMemory?: boolean;
    readonly engine?: DataStorageEngine;
    readonly alias?: string;
    readonly adapter?: DataStorageAdapter;
}

let initialized = false;

/**
 * Initialize the authoritative data registry storage backend.
 * Canonical host path: call once after `initAllDatabases()`.
 * Safe to call again when already ready (no-op if adapter already set and ready).
 */
export async function initializeDataPlatform(
    config: DataPlatformConfig = {},
): Promise<void> {
    const allowMemory = config.allowMemory === true;
    dataRegistry.configure({ allowMemoryFallback: allowMemory });

    if (config.adapter) {
        if (config.adapter.engine === 'memory' && !allowMemory) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                'Memory data adapter is not allowed without allowMemory',
            );
        }
        dataRegistry.setAdapter(config.adapter);
        initialized = true;
        log.info(`Data platform ready via injected adapter id=${config.adapter.id}`);
        return;
    }

    if (config.engine === 'memory') {
        if (!allowMemory) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                'Memory engine requested but allowMemory is false',
            );
        }
        dataRegistry.setAdapter(
            createDataStorageAdapter({ engine: 'memory', allowMemory: true }),
        );
        initialized = true;
        log.info('Data platform ready (explicit memory mode)');
        return;
    }

    let engine: DataStorageEngine;
    let alias: string;

    if (config.engine !== undefined) {
        // Explicit engine from caller — fail closed, never auto-select another
        engine = config.engine;
        alias = (config.alias ?? 'main').toString().trim() || 'main';
    } else {
        try {
            const choice = resolveCoreDataBackend({
                engine: null,
                alias: config.alias ?? null,
            });
            engine = choice.engine;
            alias = choice.alias;
            log.info(
                `Core data backend resolved engine=${choice.engine} alias=${choice.alias} explicit=${choice.explicit}`,
            );
        } catch (err) {
            if (allowMemory) {
                dataRegistry.setAdapter(
                    createDataStorageAdapter({ engine: 'memory', allowMemory: true }),
                );
                initialized = true;
                log.info(
                    'Data platform ready (memory; no durable Core backend available)',
                );
                return;
            }
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    try {
        const adapter = createDataStorageAdapter({
            engine,
            alias,
            allowMemory,
        });
        dataRegistry.setAdapter(adapter);
        initialized = true;
        log.info(
            `Data platform ready engine=${adapter.engine} id=${adapter.id} alias=${alias}`,
        );
    } catch (err) {
        if (err instanceof DataRegistryError) throw err;
        throw new DataRegistryError(
            'DATA_BACKEND_UNAVAILABLE',
            err instanceof Error ? err.message : String(err),
        );
    }

    if (isDurableEngine(engine) && dataRegistry.getAdapter().engine === 'memory') {
        throw new DataRegistryError(
            'DATA_BACKEND_UNAVAILABLE',
            'Internal invariant violated: durable engine resolved to memory',
        );
    }
}

export function isDataPlatformInitialized(): boolean {
    return initialized;
}

export function resetDataPlatformInitFlag(): void {
    initialized = false;
}
