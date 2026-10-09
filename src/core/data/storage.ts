import { DataRegistryError } from './errors.js';
import type {
    DataStorageAdapter,
    DataStorageEngine,
    DataStoragePolicy,
    DataTypeDefinition,
    DurableDataStorageEngine,
} from './types.js';
import { MemoryDataAdapter } from './adapters/memory.js';

export function isDurableEngine(
    engine: DataStorageEngine,
): engine is DurableDataStorageEngine {
    return engine !== 'memory';
}

export function resolveStoragePolicy(
    def: DataTypeDefinition,
): DataStoragePolicy {
    if (def.storage) return def.storage;
    if (def.storageMapping) {
        const mapped = def.storageMapping;
        if (
            mapped === 'memory' ||
            mapped === 'sqlite' ||
            mapped === 'postgres' ||
            mapped === 'mongo' ||
            mapped === 'surreal' ||
            mapped === 'redis'
        ) {
            return { engine: mapped };
        }
        throw new DataRegistryError(
            'DATA_INVALID_STORAGE',
            `Unknown storageMapping engine '${mapped}'`,
        );
    }
    return { engine: 'memory' };
}

/**
 * Validate that the active adapter can satisfy a data type storage policy.
 *
 * Invariants:
 * - memory adapter never satisfies a durable-engine policy (no silent fallback)
 * - durable adapter must match the requested durable engine
 * - requireDurable / requireSubjectDelete are capability checks
 */
export function assertAdapterSatisfiesPolicy(
    adapter: DataStorageAdapter,
    policy: DataStoragePolicy,
): void {
    const requested = policy.engine;

    if (isDurableEngine(requested)) {
        if (adapter.engine === 'memory') {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `Required durable engine '${requested}' cannot use memory adapter '${adapter.id}'`,
            );
        }
        if (adapter.engine !== requested) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                `Required engine '${requested}' is not the active adapter ('${adapter.engine}')`,
            );
        }
    } else {
        // policy.engine === 'memory'
        if (adapter.engine !== 'memory') {
            // A durable adapter can serve a memory-policy type (strictly stronger).
            // No error — durable backends are a valid substitute for non-durable policy.
        }
    }

    if (policy.requireDurable && !adapter.capabilities.durable) {
        throw new DataRegistryError(
            'DATA_UNSUPPORTED_CAPABILITY',
            `Storage policy requires durable adapter; '${adapter.id}' is not durable`,
        );
    }
    if (policy.requireSubjectDelete && !adapter.capabilities.subjectDelete) {
        throw new DataRegistryError(
            'DATA_UNSUPPORTED_CAPABILITY',
            `Storage policy requires subjectDelete; '${adapter.id}' does not support it`,
        );
    }
}

/**
 * Explicit memory adapter factory for tests / intentional local-dev only.
 */
export function createExplicitMemoryAdapter(): MemoryDataAdapter {
    return new MemoryDataAdapter();
}
