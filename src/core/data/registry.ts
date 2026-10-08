/**
 * Authoritative Core Data Registry — single registry for typed plugin data + privacy ops.
 */

import { getLogger } from '#core/utils/logger.js';
import { MemoryDataAdapter } from './adapters/memory.js';
import type {
    DataAccessRequest,
    DataDeleteResult,
    DataExportResult,
    DataStorageAdapter,
    DataSubject,
    DataTypeDefinition,
} from './types.js';

const log = getLogger('DataRegistry');

export class DataRegistryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DataRegistryError';
    }
}

class DataRegistryImpl {
    readonly #types = new Map<string, DataTypeDefinition>();
    #adapter: DataStorageAdapter = new MemoryDataAdapter();

    setAdapter(adapter: DataStorageAdapter): void {
        this.#adapter = adapter;
        log.info(`Data storage adapter set: ${adapter.id}`);
    }

    register(def: DataTypeDefinition): void {
        if (!def.id || def.id.includes('..') || def.id.includes('/')) {
            throw new DataRegistryError(`Invalid data type id '${def.id}'`);
        }
        const existing = this.#types.get(def.id);
        if (existing && existing.ownerPluginId !== def.ownerPluginId) {
            throw new DataRegistryError(
                `Data type '${def.id}' owned by '${existing.ownerPluginId}', cannot re-register by '${def.ownerPluginId}'`,
            );
        }
        this.#types.set(def.id, def);
        log.debug(`Registered data type ${def.id} owner=${def.ownerPluginId}`);
    }

    unregisterPlugin(pluginId: string): void {
        for (const [id, def] of this.#types) {
            if (def.ownerPluginId === pluginId) this.#types.delete(id);
        }
    }

    getType(typeId: string): DataTypeDefinition | undefined {
        return this.#types.get(typeId);
    }

    listTypes(): readonly DataTypeDefinition[] {
        return [...this.#types.values()];
    }

    listPersonalDataTypes(): readonly DataTypeDefinition[] {
        return this.listTypes().filter((t) => t.personalData);
    }

    async access(req: DataAccessRequest): Promise<readonly unknown[]> {
        const def = this.#types.get(req.typeId);
        if (!def) {
            throw new DataRegistryError(`Unknown data type '${req.typeId}'`);
        }
        if (
            def.ownerPluginId !== req.requesterPluginId &&
            def.privacyClass !== 'public'
        ) {
            throw new DataRegistryError(
                `Access denied to '${req.typeId}' for plugin '${req.requesterPluginId}'`,
            );
        }
        return this.#adapter.query(req.typeId, req.query ?? req.subject);
    }

    async export(
        typeId: string,
        subject: DataSubject,
        requesterPluginId: string,
    ): Promise<DataExportResult> {
        const def = this.#types.get(typeId);
        if (!def) throw new DataRegistryError(`Unknown data type '${typeId}'`);
        if (!def.personalData && def.privacyClass === 'secret') {
            throw new DataRegistryError(`Export denied for secret type '${typeId}'`);
        }
        void requesterPluginId;
        const records = await this.#adapter.query(typeId, subject);
        const filtered = records.filter((r) => matchesSubject(r, subject));
        return { typeId, records: filtered, exportedAt: Date.now() };
    }

    async delete(
        typeId: string,
        subject: DataSubject,
        requesterPluginId: string,
    ): Promise<DataDeleteResult> {
        const def = this.#types.get(typeId);
        if (!def) throw new DataRegistryError(`Unknown data type '${typeId}'`);
        if (
            def.ownerPluginId !== requesterPluginId &&
            def.privacyClass === 'secret'
        ) {
            throw new DataRegistryError(`Delete denied for '${typeId}'`);
        }
        const deleted = await this.#adapter.deleteBySubject(typeId, subject);
        log.info(
            `Deleted ${deleted} records type=${typeId} requester=${requesterPluginId}`,
        );
        return { typeId, deleted };
    }

    async deleteUserGlobal(userId: string): Promise<number> {
        let total = 0;
        for (const def of this.listPersonalDataTypes()) {
            total += await this.#adapter.deleteBySubject(def.id, { userId });
        }
        return total;
    }

    async deleteServer(guildId: string): Promise<number> {
        let total = 0;
        for (const def of this.listTypes()) {
            if (def.scope === 'guild' || def.scope === 'server') {
                total += await this.#adapter.deleteBySubject(def.id, { guildId });
            }
        }
        return total;
    }

    async deletePlugin(pluginId: string): Promise<number> {
        let total = 0;
        for (const def of this.listTypes()) {
            if (def.ownerPluginId === pluginId) {
                total += await this.#adapter.deleteBySubject(def.id, { pluginId });
                this.#types.delete(def.id);
            }
        }
        return total;
    }
}

function matchesSubject(record: unknown, subject: DataSubject): boolean {
    if (!record || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    if (subject.userId && r.userId !== subject.userId) return false;
    if (subject.guildId && r.guildId !== subject.guildId) return false;
    if (subject.pluginId && r.pluginId !== subject.pluginId) return false;
    return true;
}

export const dataRegistry = new DataRegistryImpl();
