import { getSdkBridge, assertBridgeAuthorized } from './bridge.js';
import type { DataScope, PluginId, PrivacyClass } from './types.js';
import { SdkError } from './types.js';

export interface DataTypeDefinition {
    readonly id: string;
    readonly schema: unknown;
    readonly scope: DataScope;
    readonly personalData: boolean;
    readonly privacyClass: PrivacyClass;
    readonly retention?: string;
}

export function registerDataType(pluginId: PluginId, def: DataTypeDefinition): void {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'data.registerType');
    if (!def.id || def.id.includes('..')) {
        throw new SdkError({
            code: 'DATA_TYPE_INVALID',
            message: 'Invalid data type id',
        });
    }
    bridge.data.registerType(def);
}

export async function accessData(
    pluginId: PluginId,
    typeId: string,
    query: unknown,
): Promise<unknown> {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'data.access');
    return bridge.data.access(typeId, query);
}

export async function exportData(
    pluginId: PluginId,
    typeId: string,
    subject: { userId?: string; guildId?: string },
): Promise<unknown> {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'data.export');
    return bridge.data.export(typeId, subject);
}

export async function deleteData(
    pluginId: PluginId,
    typeId: string,
    subject: { userId?: string; guildId?: string },
): Promise<number> {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'data.delete');
    return bridge.data.delete(typeId, subject);
}
