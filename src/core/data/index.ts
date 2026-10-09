export { dataRegistry } from './registry.js';
export { DataRegistryError } from './errors.js';
export type { DataErrorCode } from './errors.js';
export type {
    DataScope,
    PrivacyClass,
    DataStorageEngine,
    DurableDataStorageEngine,
    DataStorageCapabilities,
    DataStoragePolicy,
    DataTypeDefinition,
    DataSubject,
    DataRecord,
    DataAccessRequest,
    DataAccessQuery,
    DataWriteRequest,
    DataExportResult,
    DataDeleteResult,
    DataStorageAdapter,
} from './types.js';
export { MemoryDataAdapter } from './adapters/memory.js';
export {
    initializeDataPlatform,
    isDataPlatformInitialized,
    resetDataPlatformInitFlag,
} from './bootstrap.js';
export { isDurableEngine, assertAdapterSatisfiesPolicy, resolveStoragePolicy } from './storage.js';
export type { DataPlatformConfig } from './bootstrap.js';
export {
    assertValidTypeId,
    assertSubjectForScope,
    canRead,
    canWrite,
    canExport,
    canDelete,
} from './policy.js';

export { createDataStorageAdapter } from './adapters/factory.js';
export type { CreateAdapterOptions } from './adapters/factory.js';
export { createSqliteDataAdapter, createPostgresDataAdapter } from './adapters/sql.js';
export { createMongoDataAdapter } from './adapters/mongo.js';
export { createSurrealDataAdapter } from './adapters/surreal.js';
export { createRedisDataAdapter } from './adapters/redis.js';
export {
    CORE_DATA_TABLE,
    CORE_DATA_COLLECTION,
    CORE_DATA_REDIS_PREFIX,
} from './adapters/recordCodec.js';
