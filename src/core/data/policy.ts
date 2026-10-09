import type {
    DataScope,
    DataSubject,
    DataTypeDefinition,
    PrivacyClass,
} from './types.js';
import { DataRegistryError } from './errors.js';

const TYPE_ID_RE = /^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$/;

export function assertValidTypeId(id: string): void {
    if (!id || !TYPE_ID_RE.test(id) || id.includes('..') || id.includes('/')) {
        throw new DataRegistryError(
            'DATA_INVALID_TYPE',
            `Invalid data type id '${id}'`,
        );
    }
}

export function assertSubjectForScope(scope: DataScope, subject: DataSubject): void {
    switch (scope) {
        case 'user':
            if (!subject.userId) {
                throw new DataRegistryError(
                    'DATA_INVALID_SUBJECT',
                    'user scope requires subject.userId',
                );
            }
            break;
        case 'guild':
        case 'server':
            if (!subject.guildId) {
                throw new DataRegistryError(
                    'DATA_INVALID_SUBJECT',
                    `${scope} scope requires subject.guildId`,
                );
            }
            break;
        case 'plugin':
            if (!subject.pluginId) {
                throw new DataRegistryError(
                    'DATA_INVALID_SUBJECT',
                    'plugin scope requires subject.pluginId',
                );
            }
            break;
        case 'global':
        case 'system':
            break;
        default: {
            const _exhaustive: never = scope;
            void _exhaustive;
            throw new DataRegistryError('DATA_UNSUPPORTED_SCOPE', `Unknown scope`);
        }
    }
}

export function canRead(
    def: DataTypeDefinition,
    requesterPluginId: string,
): boolean {
    if (def.ownerPluginId === requesterPluginId) return true;
    return def.privacyClass === 'public';
}

export function canWrite(
    def: DataTypeDefinition,
    requesterPluginId: string,
): boolean {
    return def.ownerPluginId === requesterPluginId;
}

export function canExport(
    def: DataTypeDefinition,
    requesterPluginId: string,
): boolean {
    if (def.privacyClass === 'secret') return false;
    if (def.ownerPluginId === requesterPluginId) return true;
    return def.privacyClass === 'public' && def.personalData;
}

export function canDelete(
    def: DataTypeDefinition,
    requesterPluginId: string,
): boolean {
    if (def.ownerPluginId === requesterPluginId) return true;
    return false;
}

export function isCrossPluginProtected(privacy: PrivacyClass): boolean {
    return privacy !== 'public';
}
