export {
    dataRegistry,
    DataRegistryError,
} from './registry.js';
export type {
    DataScope,
    PrivacyClass,
    DataTypeDefinition,
    DataSubject,
    DataAccessRequest,
    DataExportResult,
    DataDeleteResult,
    DataStorageAdapter,
} from './types.js';
export { MemoryDataAdapter } from './adapters/memory.js';
