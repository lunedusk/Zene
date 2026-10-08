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

export interface DataTypeDefinition {
    readonly id: string;
    readonly ownerPluginId: string;
    readonly schema: unknown;
    readonly scope: DataScope;
    readonly personalData: boolean;
    readonly privacyClass: PrivacyClass;
    readonly retention?: string;
    readonly storageMapping?: string;
}

export interface DataSubject {
    readonly userId?: string;
    readonly guildId?: string;
    readonly pluginId?: string;
}

export interface DataAccessRequest {
    readonly typeId: string;
    readonly subject: DataSubject;
    readonly query?: unknown;
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
    put(typeId: string, key: string, value: unknown): Promise<void>;
    get(typeId: string, key: string): Promise<unknown | undefined>;
    query(typeId: string, filter: unknown): Promise<readonly unknown[]>;
    delete(typeId: string, key: string): Promise<boolean>;
    deleteBySubject(typeId: string, subject: DataSubject): Promise<number>;
}
