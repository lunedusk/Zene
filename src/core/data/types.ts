export type DataScope =
    | 'user'
    | 'guild'
    | 'plugin'
    | 'server'
    | 'global'
    | 'system';

export type PrivacyClass =
    | 'public'
    | 'internal'
    | 'personal'
    | 'sensitive'
    | 'secret';

export type DataStorageEngine =
    | 'memory'
    | 'sqlite'
    | 'postgres'
    | 'mongo'
    | 'surreal'
    | 'redis';

/** Production backends only — never includes the explicit test/dev memory engine. */
export type DurableDataStorageEngine = Exclude<DataStorageEngine, 'memory'>;

export interface DataStorageCapabilities {
    readonly durable: boolean;
    readonly subjectDelete: boolean;
    readonly structuredQuery: boolean;
    readonly transactions: boolean;
    readonly keyValueOnly: boolean;
}

export interface DataStoragePolicy {
    readonly engine: DataStorageEngine;
    readonly alias?: string;
    readonly requireDurable?: boolean;
    readonly requireSubjectDelete?: boolean;
}

export interface DataTypeDefinition {
    readonly id: string;
    readonly ownerPluginId: string;
    readonly schema: unknown;
    readonly scope: DataScope;
    readonly personalData: boolean;
    readonly privacyClass: PrivacyClass;
    readonly retention?: string;
    readonly storage?: DataStoragePolicy;
    /** @deprecated use storage */
    readonly storageMapping?: string;
}

export interface DataSubject {
    readonly userId?: string;
    readonly guildId?: string;
    readonly pluginId?: string;
}

export interface DataRecord {
    readonly typeId: string;
    readonly key: string;
    readonly subject: DataSubject;
    readonly value: unknown;
    readonly ownerPluginId: string;
    readonly updatedAt: number;
}

/** Backend-neutral access filter applied after subject authorization. */
export interface DataAccessQuery {
    /** Exact record key within the authorized subject scope. */
    readonly key?: string;
}

export interface DataAccessRequest {
    readonly typeId: string;
    readonly subject: DataSubject;
    readonly query?: DataAccessQuery;
    readonly requesterPluginId: string;
}

export interface DataWriteRequest {
    readonly typeId: string;
    readonly key: string;
    readonly subject: DataSubject;
    readonly value: unknown;
    readonly requesterPluginId: string;
}

export interface DataExportResult {
    readonly typeId: string;
    readonly records: readonly unknown[];
    readonly exportedAt: number;
}

export interface DataDeleteResult {
    readonly typeId: string;
    readonly deleted: number;
}

export interface DataStorageAdapter {
    readonly id: string;
    readonly engine: DataStorageEngine;
    readonly capabilities: DataStorageCapabilities;
    /**
     * Connection alias of the underlying DB manager instance when applicable
     * (e.g. "main"). Used to enforce DataStoragePolicy.alias constraints.
     */
    readonly connectionAlias?: string;
    put(typeId: string, key: string, record: DataRecord): Promise<void>;
    get(typeId: string, key: string): Promise<DataRecord | undefined>;
    query(typeId: string, filter: DataSubject | unknown): Promise<readonly DataRecord[]>;
    delete(typeId: string, key: string): Promise<boolean>;
    deleteBySubject(typeId: string, subject: DataSubject): Promise<number>;
    /**
     * Delete every record for a data type, regardless of subject.
     * Used by Core-only plugin data wipe — not a public subject-delete API.
     */
    deleteByType(typeId: string): Promise<number>;
}
