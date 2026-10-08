import { assertBridgeAuthorized, type SdkBridge } from './bridge.js';
import type { DataScope, PrivacyClass } from './types.js';
import { SdkError } from './types.js';

export interface DataTypeDefinition {
    readonly id: string;
    readonly schema: unknown;
    readonly scope: DataScope;
    readonly personalData: boolean;
    readonly privacyClass: PrivacyClass;
    readonly retention?: string;
}

export function registerDataType(bridge: SdkBridge, def: DataTypeDefinition): void {
    assertBridgeAuthorized(bridge, 'data.registerType');
    if (!def.id || typeof def.id !== 'string') {
        throw new SdkError({ code: 'DATA_TYPE_INVALID', message: 'Data type id is required' });
    }
    bridge.data.registerType({
        id: def.id,
        schema: def.schema,
        scope: def.scope,
        personalData: def.personalData,
        privacyClass: def.privacyClass,
        retention: def.retention,
    });
}

export async function accessData(
    bridge: SdkBridge,
    typeId: string,
    query: unknown,
): Promise<unknown> {
    assertBridgeAuthorized(bridge, 'data.access');
    return bridge.data.access(typeId, query);
}

export async function exportData(
    bridge: SdkBridge,
    typeId: string,
    subject: { userId?: string; guildId?: string },
): Promise<unknown> {
    assertBridgeAuthorized(bridge, 'data.export');
    return bridge.data.export(typeId, subject);
}

export async function deleteData(
    bridge: SdkBridge,
    typeId: string,
    subject: { userId?: string; guildId?: string },
): Promise<number> {
    assertBridgeAuthorized(bridge, 'data.delete');
    return bridge.data.delete(typeId, subject);
}
