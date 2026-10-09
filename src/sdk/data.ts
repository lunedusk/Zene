import { assertBridgeAuthorized, type SdkBridge } from './bridge.js';
import { SdkError } from './types.js';
import type { DataScope, PrivacyClass } from './types.js';

export interface DataTypeRegistration {
    readonly id: string;
    readonly schema?: unknown;
    readonly scope: DataScope;
    readonly personalData: boolean;
    readonly privacyClass: PrivacyClass;
    readonly retention?: string;
    readonly storage?: {
        readonly engine:
            | 'memory'
            | 'sqlite'
            | 'postgres'
            | 'mongo'
            | 'surreal'
            | 'redis';
        readonly alias?: string;
        readonly requireDurable?: boolean;
        readonly requireSubjectDelete?: boolean;
    };
}

export interface DataAccessQuery {
    readonly key?: string;
}

export interface DataSubjectInput {
    readonly userId?: string;
    readonly guildId?: string;
    readonly pluginId?: string;
}

export function registerDataType(
    bridge: SdkBridge,
    definition: DataTypeRegistration,
): void {
    assertBridgeAuthorized(bridge, 'data.registerType');
    bridge.data.registerType(definition);
}

export async function accessData(
    bridge: SdkBridge,
    typeId: string,
    subject: DataSubjectInput,
    query?: DataAccessQuery,
): Promise<readonly unknown[]> {
    assertBridgeAuthorized(bridge, 'data.access');
    try {
        return await bridge.data.access(typeId, subject, query);
    } catch (err) {
        if (err instanceof SdkError) throw err;
        throw new SdkError({
            code: 'DATA_ACCESS_FAILED',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function writeData(
    bridge: SdkBridge,
    typeId: string,
    key: string,
    subject: DataSubjectInput,
    value: unknown,
): Promise<void> {
    assertBridgeAuthorized(bridge, 'data.write');
    try {
        await bridge.data.write(typeId, key, subject, value);
    } catch (err) {
        if (err instanceof SdkError) throw err;
        throw new SdkError({
            code: 'DATA_WRITE_FAILED',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function exportData(
    bridge: SdkBridge,
    typeId: string,
    subject: DataSubjectInput,
): Promise<{ typeId: string; records: readonly unknown[]; exportedAt: number }> {
    assertBridgeAuthorized(bridge, 'data.export');
    try {
        return await bridge.data.export(typeId, subject);
    } catch (err) {
        if (err instanceof SdkError) throw err;
        throw new SdkError({
            code: 'DATA_EXPORT_FAILED',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function deleteData(
    bridge: SdkBridge,
    typeId: string,
    subject: DataSubjectInput,
): Promise<number> {
    assertBridgeAuthorized(bridge, 'data.delete');
    try {
        return await bridge.data.delete(typeId, subject);
    } catch (err) {
        if (err instanceof SdkError) throw err;
        throw new SdkError({
            code: 'DATA_DELETE_FAILED',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}
