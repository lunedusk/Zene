import type { DataRecord, DataSubject } from '../types.js';

export interface StoredRecordPayload {
    readonly typeId: string;
    readonly key: string;
    readonly subject: DataSubject;
    readonly value: unknown;
    readonly ownerPluginId: string;
    readonly updatedAt: number;
}

/**
 * Build a DataSubject containing only properties that are present (not undefined).
 * Absent optional fields stay absent — never materialize `field: undefined`.
 */
export function canonicalizeSubject(input: DataSubject | null | undefined): DataSubject {
    const subject: {
        userId?: string;
        guildId?: string;
        pluginId?: string;
    } = {};
    if (input?.userId !== undefined) {
        subject.userId = input.userId;
    }
    if (input?.guildId !== undefined) {
        subject.guildId = input.guildId;
    }
    if (input?.pluginId !== undefined) {
        subject.pluginId = input.pluginId;
    }
    return subject;
}

/**
 * Deterministic injective encoding of an arbitrary string for composite keys.
 * Format: <decimal-byte-length>:<utf8-bytes>
 * Colon and Unicode in the value cannot collide with another component boundary.
 */
export function encodeCompositePart(value: string): string {
    const bytes = Buffer.from(value, 'utf8');
    return `${bytes.length}:${value}`;
}

/**
 * Encode (typeId, key) into a single collision-safe identity segment.
 */
export function encodeTypeKeyIdentity(typeId: string, key: string): string {
    return `${encodeCompositePart(typeId)}|${encodeCompositePart(key)}`;
}

export function encodeRecord(record: DataRecord): StoredRecordPayload {
    return {
        typeId: record.typeId,
        key: record.key,
        subject: canonicalizeSubject(record.subject),
        value: record.value,
        ownerPluginId: record.ownerPluginId,
        updatedAt: record.updatedAt,
    };
}

export function decodeRecord(payload: StoredRecordPayload): DataRecord {
    return {
        typeId: payload.typeId,
        key: payload.key,
        subject: canonicalizeSubject(payload.subject),
        value: payload.value,
        ownerPluginId: payload.ownerPluginId,
        updatedAt: payload.updatedAt,
    };
}

export function subjectMatches(
    record: DataSubject,
    filter: DataSubject,
): boolean {
    if (filter.userId !== undefined && record.userId !== filter.userId) {
        return false;
    }
    if (filter.guildId !== undefined && record.guildId !== filter.guildId) {
        return false;
    }
    if (filter.pluginId !== undefined && record.pluginId !== filter.pluginId) {
        return false;
    }
    return true;
}

export const CORE_DATA_TABLE = 'zene_core_data';
export const CORE_DATA_COLLECTION = 'zene_core_data';
export const CORE_DATA_REDIS_PREFIX = 'zene:core:data';
