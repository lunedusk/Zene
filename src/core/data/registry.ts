/**
 * Authoritative Core Data Registry — single registry for typed plugin data + privacy ops.
 */

import { getLogger } from '#core/utils/logger.js';
import { DataRegistryError } from './errors.js';
import {
    assertSubjectForScope,
    assertValidTypeId,
    canDelete,
    canExport,
    canRead,
    canWrite,
} from './policy.js';
import { assertAdapterSatisfiesPolicy, resolveStoragePolicy } from './storage.js';
import type {
    DataAccessRequest,
    DataDeleteResult,
    DataExportResult,
    DataRecord,
    DataStorageAdapter,
    DataSubject,
    DataTypeDefinition,
    DataWriteRequest,
} from './types.js';

const log = getLogger('DataRegistry');

type RegistryMode = 'uninitialized' | 'ready';

class DataRegistryImpl {
    readonly #types = new Map<string, DataTypeDefinition>();
    #adapter: DataStorageAdapter | null = null;
    #mode: RegistryMode = 'uninitialized';
    #allowMemoryFallback = false;

    /**
     * Explicitly allow memory adapter (tests / intentional dev mode only).
     * Production boot must call setAdapter with a non-memory backend or set allowMemory.
     */
    configure(options: { allowMemoryFallback?: boolean } = {}): void {
        this.#allowMemoryFallback = options.allowMemoryFallback === true;
    }

    setAdapter(adapter: DataStorageAdapter): void {
        if (adapter.engine === 'memory' && !this.#allowMemoryFallback) {
            throw new DataRegistryError(
                'DATA_BACKEND_UNAVAILABLE',
                'Memory data adapter is not allowed without explicit allowMemoryFallback',
            );
        }
        this.#adapter = adapter;
        this.#mode = 'ready';
        log.info(`Data storage adapter set: ${adapter.id} engine=${adapter.engine}`);
    }

    isReady(): boolean {
        return this.#mode === 'ready' && this.#adapter !== null;
    }

    getAdapter(): DataStorageAdapter {
        if (!this.#adapter) {
            throw new DataRegistryError(
                'DATA_NOT_READY',
                'Data registry has no storage adapter; initialize data platform before use',
            );
        }
        return this.#adapter;
    }

    register(def: DataTypeDefinition): void {
        assertValidTypeId(def.id);
        if (!def.ownerPluginId) {
            throw new DataRegistryError(
                'DATA_UNAUTHORIZED',
                'ownerPluginId is required and must come from Core session',
            );
        }
        const existing = this.#types.get(def.id);
        if (existing && existing.ownerPluginId !== def.ownerPluginId) {
            throw new DataRegistryError(
                'DATA_DUPLICATE_OWNER',
                `Data type '${def.id}' owned by '${existing.ownerPluginId}', cannot re-register by '${def.ownerPluginId}'`,
            );
        }
        const policy = resolveStoragePolicy(def);
        if (policy.engine !== 'memory' && this.#adapter) {
            try {
                assertAdapterSatisfiesPolicy(this.#adapter, policy);
            } catch (err) {
                if (
                    err instanceof DataRegistryError &&
                    err.code === 'DATA_BACKEND_UNAVAILABLE' &&
                    this.#allowMemoryFallback
                ) {
                    // intentional test/dev path
                } else {
                    throw err;
                }
            }
        }
        this.#types.set(def.id, Object.freeze({ ...def }));
        log.debug(`Registered data type ${def.id} owner=${def.ownerPluginId}`);
    }

    /**
     * Remove type definitions for a plugin. Does NOT delete persisted records.
     */
    unregisterPlugin(pluginId: string): void {
        for (const [id, def] of this.#types) {
            if (def.ownerPluginId === pluginId) this.#types.delete(id);
        }
    }

    getType(typeId: string): DataTypeDefinition | undefined {
        return this.#types.get(typeId);
    }

    requireType(typeId: string): DataTypeDefinition {
        const def = this.#types.get(typeId);
        if (!def) {
            throw new DataRegistryError(
                'DATA_UNKNOWN_TYPE',
                `Unknown data type '${typeId}'`,
            );
        }
        return def;
    }

    listTypes(): readonly DataTypeDefinition[] {
        return [...this.#types.values()];
    }

    listPersonalDataTypes(): readonly DataTypeDefinition[] {
        return this.listTypes().filter((t) => t.personalData);
    }

    async write(req: DataWriteRequest): Promise<void> {
        const def = this.requireType(req.typeId);
        assertSubjectForScope(def.scope, req.subject);
        if (!canWrite(def, req.requesterPluginId)) {
            throw new DataRegistryError(
                'DATA_UNAUTHORIZED',
                `Write denied to '${req.typeId}' for plugin '${req.requesterPluginId}'`,
            );
        }
        const adapter = this.getAdapter();
        assertAdapterSatisfiesPolicy(adapter, resolveStoragePolicy(def));
        const record: DataRecord = {
            typeId: req.typeId,
            key: req.key,
            subject: { ...req.subject },
            value: req.value,
            ownerPluginId: def.ownerPluginId,
            updatedAt: Date.now(),
        };
        try {
            await this.#safeStorage(() => adapter.put(req.typeId, req.key, record), 'put');
        } catch (err) {
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    async access(req: DataAccessRequest): Promise<readonly unknown[]> {
        const def = this.requireType(req.typeId);
        assertSubjectForScope(def.scope, req.subject);
        if (!canRead(def, req.requesterPluginId)) {
            throw new DataRegistryError(
                'DATA_UNAUTHORIZED',
                `Access denied to '${req.typeId}' for plugin '${req.requesterPluginId}'`,
            );
        }
        if (req.query !== undefined) {
            assertValidAccessQuery(req.query);
        }
        const adapter = this.getAdapter();
        let records = await this.#safeStorage(
            () => adapter.query(req.typeId, req.subject),
            'query',
        );
        if (req.query?.key !== undefined) {
            records = records.filter((r) => r.key === req.query!.key);
        }
        return records.map((r) => r.value);
    }

    async export(
        typeId: string,
        subject: DataSubject,
        requesterPluginId: string,
    ): Promise<DataExportResult> {
        const def = this.requireType(typeId);
        assertSubjectForScope(def.scope, subject);
        if (!canExport(def, requesterPluginId)) {
            throw new DataRegistryError(
                'DATA_EXPORT_DENIED',
                `Export denied for type '${typeId}'`,
            );
        }
        const adapter = this.getAdapter();
        const records = await adapter.query(typeId, subject);
        return {
            typeId,
            records: records.map((r) => r.value),
            exportedAt: Date.now(),
        };
    }

    async delete(
        typeId: string,
        subject: DataSubject,
        requesterPluginId: string,
    ): Promise<DataDeleteResult> {
        const def = this.requireType(typeId);
        assertSubjectForScope(def.scope, subject);
        if (!canDelete(def, requesterPluginId)) {
            throw new DataRegistryError(
                'DATA_UNAUTHORIZED',
                `Delete denied for '${typeId}'`,
            );
        }
        const adapter = this.getAdapter();
        if (!adapter.capabilities.subjectDelete) {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Adapter '${adapter.id}' cannot deleteBySubject`,
            );
        }
        const deleted = await adapter.deleteBySubject(typeId, subject);
        log.info(
            `Deleted ${deleted} records type=${typeId} requester=${requesterPluginId}`,
        );
        return { typeId, deleted };
    }

    /**
     * Core-authorized: delete personal data for a Discord user across all personal types.
     */
    async deleteUserGlobal(userId: string): Promise<number> {
        if (!userId) {
            throw new DataRegistryError(
                'DATA_INVALID_SUBJECT',
                'userId is required for global user deletion',
            );
        }
        const adapter = this.getAdapter();
        if (!adapter.capabilities.subjectDelete) {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Adapter '${adapter.id}' cannot deleteBySubject`,
            );
        }
        let total = 0;
        for (const def of this.listPersonalDataTypes()) {
            total += await adapter.deleteBySubject(def.id, { userId });
        }
        log.info(`Global user delete userId=${userId} deleted=${total}`);
        return total;
    }

    /**
     * Core-authorized: delete guild/server-scoped data across applicable types.
     */
    async deleteGuildServer(guildId: string): Promise<number> {
        if (!guildId) {
            throw new DataRegistryError(
                'DATA_INVALID_SUBJECT',
                'guildId is required for server deletion',
            );
        }
        const adapter = this.getAdapter();
        if (!adapter.capabilities.subjectDelete) {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Adapter '${adapter.id}' cannot deleteBySubject`,
            );
        }
        let total = 0;
        for (const def of this.listTypes()) {
            if (def.scope !== 'guild' && def.scope !== 'server') continue;
            total += await adapter.deleteBySubject(def.id, { guildId });
        }
        log.info(`Guild/server delete guildId=${guildId} deleted=${total}`);
        return total;
    }

    /**
     * Explicit plugin-owned data wipe (authorized owner only), separate from unload.
     */
    async deletePluginData(
        pluginId: string,
        requesterPluginId: string,
    ): Promise<number> {
        if (pluginId !== requesterPluginId) {
            throw new DataRegistryError(
                'DATA_UNAUTHORIZED',
                'Only the owner plugin may delete its persisted data types',
            );
        }
        const adapter = this.getAdapter();
        if (typeof adapter.deleteByType !== 'function') {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Adapter '${adapter.id}' cannot deleteByType for plugin data wipe`,
            );
        }
        let total = 0;
        for (const def of this.listTypes()) {
            if (def.ownerPluginId !== pluginId) continue;
            total += await this.#safeStorage(
                () => adapter.deleteByType(def.id),
                'deleteByType',
            );
        }
        return total;
    }

    async #safeStorage<T>(op: () => Promise<T>, opName: string): Promise<T> {
        try {
            return await op();
        } catch (err) {
            if (err instanceof DataRegistryError) throw err;
            log.error(`Storage ${opName} failed`, {
                op: opName,
                err: err instanceof Error ? err.message : String(err),
            });
            throw new DataRegistryError(
                'DATA_PERSISTENCE_FAILURE',
                `Data storage ${opName} failed`,
            );
        }
    }
}

function assertValidAccessQuery(query: unknown): void {
    if (query === null || typeof query !== 'object' || Array.isArray(query)) {
        throw new DataRegistryError(
            'DATA_UNSUPPORTED_CAPABILITY',
            'Access query must be a plain object with optional key filter',
        );
    }
    const keys = Object.keys(query as Record<string, unknown>);
    for (const k of keys) {
        if (k !== 'key') {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Access query field '${k}' is not supported`,
            );
        }
    }
    const q = query as { key?: unknown };
    if (q.key !== undefined && typeof q.key !== 'string') {
        throw new DataRegistryError(
            'DATA_UNSUPPORTED_CAPABILITY',
            'Access query.key must be a string when provided',
        );
    }
}

export const dataRegistry = new DataRegistryImpl();
