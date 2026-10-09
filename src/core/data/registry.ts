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
    DataTypeCatalogueEntry,
    DataTypeDefinition,
    DataWriteRequest,
} from './types.js';

const log = getLogger('DataRegistry');

type RegistryMode = 'uninitialized' | 'ready';

/**
 * Active plugin access requires the definition in #types.
 * #catalogue is loaded from / persisted to the adapter's dedicated metadata namespace.
 */

function subjectHasField(subject: DataSubject): boolean {
    return (
        subject.userId !== undefined ||
        subject.guildId !== undefined ||
        subject.pluginId !== undefined
    );
}

function subjectsEqual(a: DataSubject, b: DataSubject): boolean {
    return (
        a.userId === b.userId &&
        a.guildId === b.guildId &&
        a.pluginId === b.pluginId
    );
}

class DataRegistryImpl {
    readonly #types = new Map<string, DataTypeDefinition>();
    /** Survives unload; used only for Core privacy / owner wipe operations. */
    readonly #catalogue = new Map<string, DataTypeCatalogueEntry>();
    #adapter: DataStorageAdapter | null = null;
    #mode: RegistryMode = 'uninitialized';
    #allowMemoryFallback = false;

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

    /**
     * Load durable privacy catalogue from the active adapter into memory.
     * Must complete before privacy deletion after process restart.
     */
    async loadCatalogue(): Promise<void> {
        const adapter = this.getAdapter();
        const entries = await this.#safeStorage(
            () => adapter.listCatalogueEntries(),
            'listCatalogue',
        );
        this.#catalogue.clear();
        for (const entry of entries) {
            if (!entry.id || !entry.ownerPluginId || !entry.scope) {
                throw new DataRegistryError(
                    'DATA_PERSISTENCE_FAILURE',
                    'Incomplete catalogue metadata; refusing to load unsafe entry',
                );
            }
            this.#catalogue.set(
                entry.id,
                Object.freeze({
                    id: entry.id,
                    ownerPluginId: entry.ownerPluginId,
                    scope: entry.scope,
                    personalData: Boolean(entry.personalData),
                    privacyClass: entry.privacyClass,
                }),
            );
        }
        log.info(`Loaded ${this.#catalogue.size} catalogue entries from storage`);
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

    async register(def: DataTypeDefinition): Promise<void> {
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
        const catalogued = this.#catalogue.get(def.id);
        if (catalogued && catalogued.ownerPluginId !== def.ownerPluginId) {
            throw new DataRegistryError(
                'DATA_DUPLICATE_OWNER',
                `Data type '${def.id}' catalogue owned by '${catalogued.ownerPluginId}', cannot re-register by '${def.ownerPluginId}'`,
            );
        }

        const policy = resolveStoragePolicy(def);
        if (this.#adapter) {
            try {
                assertAdapterSatisfiesPolicy(this.#adapter, policy);
            } catch (err) {
                if (
                    err instanceof DataRegistryError &&
                    err.code === 'DATA_BACKEND_UNAVAILABLE' &&
                    this.#allowMemoryFallback &&
                    policy.engine !== 'memory' &&
                    !(policy.alias !== undefined && policy.alias !== '')
                ) {
                    // durable-engine mismatch may be tolerated in explicit memory-fallback tests
                } else {
                    throw err;
                }
            }
        }

        const entry: DataTypeCatalogueEntry = Object.freeze({
            id: def.id,
            ownerPluginId: def.ownerPluginId,
            scope: def.scope,
            personalData: def.personalData,
            privacyClass: def.privacyClass,
        });
        // Durable catalogue BEFORE active definition is usable for writes
        if (this.#adapter) {
            await this.#safeStorage(
                () => this.#adapter!.putCatalogueEntry(entry),
                'putCatalogue',
            );
        }
        this.#catalogue.set(def.id, entry);
        this.#types.set(def.id, Object.freeze({ ...def }));
        log.debug(`Registered data type ${def.id} owner=${def.ownerPluginId}`);
    }

    /**
     * Remove active type definitions for a plugin. Does NOT delete persisted records.
     * Catalogue entries remain for Core privacy deletion.
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

    /** Test/Core inspection of retained privacy catalogue (not a public SDK surface). */
    listCatalogueEntries(): readonly DataTypeCatalogueEntry[] {
        return [...this.#catalogue.values()];
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
        await this.#safeStorage(
            () => adapter.put(req.typeId, req.key, record),
            'put',
        );
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

        if (req.query?.key !== undefined) {
            const record = await this.#safeStorage(
                () => adapter.get(req.typeId, req.query!.key!),
                'get',
            );
            if (!record) return [];
            if (!subjectsEqual(record.subject, req.subject)) {
                return [];
            }
            return [record.value];
        }

        const records = await this.#safeStorage(
            () => adapter.query(req.typeId, req.subject),
            'query',
        );
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
        const records = await this.#safeStorage(
            () => adapter.query(typeId, subject),
            'query',
        );
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
        if (!subjectHasField(subject)) {
            throw new DataRegistryError(
                'DATA_INVALID_SUBJECT',
                'Subject-scoped delete requires at least one subject field; whole-type deletion uses Core deleteByType',
            );
        }
        const adapter = this.getAdapter();
        if (!adapter.capabilities.subjectDelete) {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Adapter '${adapter.id}' cannot deleteBySubject`,
            );
        }
        const deleted = await this.#safeStorage(
            () => adapter.deleteBySubject(typeId, subject),
            'deleteBySubject',
        );
        log.info(
            `Deleted ${deleted} records type=${typeId} requester=${requesterPluginId}`,
        );
        return { typeId, deleted };
    }

    /**
     * Core-authorized: delete personal data for a Discord user across catalogue entries
     * (including types whose plugins have been unloaded).
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
        for (const entry of this.#catalogue.values()) {
            if (!entry.personalData) continue;
            total += await this.#safeStorage(
                () => adapter.deleteBySubject(entry.id, { userId }),
                'deleteBySubject',
            );
        }
        log.info(`Global user delete userId=${userId} deleted=${total}`);
        return total;
    }

    /**
     * Core-authorized: delete guild/server-scoped data across catalogue entries
     * (including unloaded plugins).
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
        for (const entry of this.#catalogue.values()) {
            if (entry.scope !== 'guild' && entry.scope !== 'server') continue;
            total += await this.#safeStorage(
                () => adapter.deleteBySubject(entry.id, { guildId }),
                'deleteBySubject',
            );
        }
        log.info(`Guild server delete guildId=${guildId} deleted=${total}`);
        return total;
    }

    /**
     * Explicit plugin-owned data wipe (authorized owner only), separate from unload.
     * Uses catalogue so wipe works after unload of active definitions.
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
        for (const entry of this.#catalogue.values()) {
            if (entry.ownerPluginId !== pluginId) continue;
            total += await this.#safeStorage(
                () => adapter.deleteByType(entry.id),
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
            const name = err instanceof Error ? err.name : 'Error';
            const adapterId = this.#adapter?.id ?? 'none';
            // Never log raw driver messages — may contain secrets, payloads, or URIs.
            log.error(`Storage ${opName} failed`, {
                op: opName,
                code: 'DATA_PERSISTENCE_FAILURE',
                adapterId,
                errorName: name,
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
    for (const [field, value] of Object.entries(query)) {
        if (field !== 'key') {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                `Access query field '${field}' is not supported`,
            );
        }
        if (value !== undefined && typeof value !== 'string') {
            throw new DataRegistryError(
                'DATA_UNSUPPORTED_CAPABILITY',
                'Access query.key must be a string when provided',
            );
        }
    }
}

export const dataRegistry = new DataRegistryImpl();
