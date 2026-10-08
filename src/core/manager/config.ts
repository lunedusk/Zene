import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { FileWatcher, type WatchEvent } from '#core/watcher/index.js';
import { getLogger } from '#core/utils/logger.js';
import {
    expandValue,
    applyUntaggedRandPersists,
    redactExpandedForApi,
    registerConfigPlaceholderSource,
} from '#core/placeholder/index.js';
import {
    formatIssues,
    inferPluginIdFromConfigName,
    loadPluginConfigRules,
    loadPluginConfigSchema,
    validateValue,
} from '#core/validation/index.js';
import { writeJson5Preserving, persistPlaceholdersInJson5File } from '#core/loader/json5SurgicalWrite.js';

const log = getLogger('ConfigManager');

type JsonObject = Record<string, unknown>;

export class ConfigManager {
    private readonly rawCache = new Map<string, unknown>();
    private readonly runtimeCache = new Map<string, unknown>();
    private readonly liveConfigs = new Map<string, Record<string, unknown>>();
    private readonly targetDir: string;
    private watcher: FileWatcher | null = null;
    private isReloading = false;
    private readonly configValidationFailures = new Map<string, string[]>();

    constructor(targetDir?: string) {
        this.targetDir = targetDir ? path.resolve(targetDir) : path.join(process.cwd(), 'configuration');
        registerConfigPlaceholderSource(() => {
            const core = this.runtimeCache.get('core') as Record<string, unknown> | undefined;
            return core?.placeholders;
        });
    }

    private recordConfigFailure(pluginId: string | null, name: string): void {
        if (!pluginId) return;
        const list = this.configValidationFailures.get(pluginId) ?? [];
        if (!list.includes(name)) list.push(name);
        this.configValidationFailures.set(pluginId, list);
    }

    private async validateConfigObject(
        name: string,
        filePath: string,
        data: unknown,
    ): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
        const pluginId = inferPluginIdFromConfigName(name);
        const schema = await loadPluginConfigSchema(pluginId, name);
        const rules = await loadPluginConfigRules(pluginId, name);

        const result = await validateValue(
            data,
            {
                kind: 'config',
                filePath,
                name,
                pluginId,
            },
            schema,
            rules,
        );

        if (!result.ok) {
            this.recordConfigFailure(pluginId, name);
            return { ok: false, message: formatIssues(result.issues) };
        }
        return { ok: true, data: result.data };
    }

    private async parseExpandValidate(
        name: string,
        filePath: string,
        rawContent: string,
        persistUntaggedRand: boolean,
    ): Promise<{ raw: unknown; runtime: unknown } | null> {
        let parsed: unknown;
        try {
            parsed = JSON5.parse(rawContent);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Failed to parse config file [${name}.json5]: ${message}`);
            return null;
        }

        const rawClone = JSON5.parse(JSON5.stringify(parsed)) as unknown;

        const expandResult = expandValue(rawClone, {
            failClosed: undefined,
            resolveEmoji: false,
            collectUntaggedRand: persistUntaggedRand,
            softMiss: 'absent',
        });

        let rawForStore = parsed;
        if (persistUntaggedRand && expandResult.untaggedRandPersists.size > 0) {
            rawForStore = applyUntaggedRandPersists(parsed, expandResult.untaggedRandPersists);
            try {
                const mode = await persistPlaceholdersInJson5File(
                    filePath,
                    expandResult.untaggedRandPersists,
                    rawForStore as Record<string, unknown>,
                );
                log.info(
                    `Persisted ${expandResult.untaggedRandPersists.size} untagged rand value(s) into ${name}.json5 (${mode})`,
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(`Failed to persist untagged rand for [${name}]: ${message}`);
            }
        }

        const validated = await this.validateConfigObject(name, filePath, expandResult.value);
        if (!validated.ok) {
            log.error(`Config validation failed [${name}.json5]: ${validated.message}`);
            const pid = inferPluginIdFromConfigName(name);
            if (pid) log.error(`[${pid}] Plugin will be DISABLED due to invalid configuration.`);
            return null;
        }

        return { raw: rawForStore, runtime: validated.data };
    }

    private async atomicWriteJson5(targetPath: string, data: JsonObject): Promise<void> {
        await writeJson5Preserving(targetPath, data as Record<string, unknown>);
    }

    public getConfigValidationFailures(): ReadonlyMap<string, readonly string[]> {
        return this.configValidationFailures;
    }

    public hasConfigValidationFailure(pluginId: string): boolean {
        const list = this.configValidationFailures.get(pluginId);
        return !!list && list.length > 0;
    }

    public async init(hotReload: boolean = false): Promise<void> {
        log.info('Initializing Configuration Manager...');
        await fs.mkdir(this.targetDir, { recursive: true });
        await this.loadAll();

        if (hotReload) {
            this.watcher = new FileWatcher(this.targetDir, { includePatterns: ['**/*.json5'] });
            this.watcher.on('events', (events: WatchEvent[]) =>
                this.handleWatchEvents(events).catch((err) => {
                    log.error(`Fatal error in Config Watcher: ${(err as Error).message}`);
                }),
            );
            this.watcher.start();
            log.info('Configuration Manager hot-reload active.');
        }
    }

    private async handleWatchEvents(events: WatchEvent[]): Promise<void> {
        for (const event of events) {
            const name = path.basename(event.path, '.json5');
            if (event.type === 'deleted') {
                this.rawCache.delete(name);
                this.runtimeCache.delete(name);
                const liveRef = this.liveConfigs.get(name);
                if (liveRef) {
                    for (const key of Object.keys(liveRef)) {
                        delete liveRef[key];
                    }
                }
                log.info(`Unloaded configuration: [${name}]`);
            } else {
                await this.reloadFile(name);
            }
        }
    }

    public async reloadAll(): Promise<boolean> {
        log.info('Force reloading all configurations from disk...');
        return await this.loadAll();
    }

    public async reloadFile(name: string): Promise<boolean> {
        const filePath = path.join(this.targetDir, `${name}.json5`);
        try {
            const rawContent = await fs.readFile(filePath, 'utf-8');
            const result = await this.parseExpandValidate(name, filePath, rawContent, true);
            if (!result) return false;

            this.rawCache.set(name, result.raw);
            this.runtimeCache.set(name, result.runtime);
            this.updateLiveReference(name, result.runtime as Record<string, unknown>);
            log.debug(`Successfully reloaded configuration: [${name}.json5]`);
            return true;
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') {
                log.error(`Cannot reload config [${name}]: File does not exist.`);
            } else {
                log.error(`Failed to reload config file [${name}.json5]: ${err.message}`);
            }
            return false;
        }
    }

    public getLoadedConfigs(): string[] {
        return Array.from(this.runtimeCache.keys());
    }

    private async loadAll(): Promise<boolean> {
        if (this.isReloading) return false;
        this.isReloading = true;
        try {
            const entries = await fs.readdir(this.targetDir, { withFileTypes: true });
            const newRaw = new Map<string, unknown>();
            const newRuntime = new Map<string, unknown>();
            let loadedCount = 0;

            for (const entry of entries) {
                if (entry.isDirectory() || !entry.name.endsWith('.json5')) continue;
                const configName = entry.name.replace(/\.json5$/, '');
                const filePath = path.join(this.targetDir, entry.name);
                try {
                    const rawContent = await fs.readFile(filePath, 'utf-8');
                    const result = await this.parseExpandValidate(configName, filePath, rawContent, true);
                    if (!result) continue;

                    newRaw.set(configName, result.raw);
                    newRuntime.set(configName, result.runtime);
                    this.updateLiveReference(configName, result.runtime as Record<string, unknown>);
                    loadedCount++;
                } catch (parseError: unknown) {
                    const err = parseError instanceof Error ? parseError : new Error(String(parseError));
                    log.error(`Failed to load config file [${entry.name}]: ${err.message}`);
                }
            }

            this.rawCache.clear();
            this.runtimeCache.clear();
            for (const [k, v] of newRaw) this.rawCache.set(k, v);
            for (const [k, v] of newRuntime) this.runtimeCache.set(k, v);

            log.info(`Successfully loaded ${loadedCount} configuration files.`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('config.loaded', { count: loadedCount }))
            .catch(() => undefined);

            return true;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Critical failure reading configurations: ${err.message}`);
            return false;
        } finally {
            this.isReloading = false;
        }
    }

    private updateLiveReference(name: string, newData: Record<string, unknown>): void {
        if (!this.liveConfigs.has(name)) {
            this.liveConfigs.set(name, {});
        }
        const currentRef = this.liveConfigs.get(name)!;
        this.deepMutate(currentRef, newData);
    }

    private deepMutate(target: Record<string, unknown>, source: Record<string, unknown>): void {
        for (const key of Object.keys(target)) {
            if (!(key in source)) {
                delete target[key];
            }
        }
        for (const key of Object.keys(source)) {
            const sourceVal = source[key];
            const targetVal = target[key];
            if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
                if (!targetVal || typeof targetVal !== 'object' || Array.isArray(targetVal)) {
                    target[key] = {};
                }
                this.deepMutate(
                    target[key] as Record<string, unknown>,
                    sourceVal as Record<string, unknown>,
                );
            } else {
                target[key] = sourceVal;
            }
        }
    }

    public get<T = Record<string, unknown>>(name: string): Readonly<T> | null {
        if (!this.runtimeCache.has(name)) return null;
        if (!this.liveConfigs.has(name)) {
            this.liveConfigs.set(name, {});
        }
        return this.liveConfigs.get(name) as unknown as Readonly<T>;
    }

    public getRaw<T = Record<string, unknown>>(name: string): Readonly<T> | null {
        if (!this.rawCache.has(name)) return null;
        return JSON5.parse(JSON5.stringify(this.rawCache.get(name))) as T;
    }

    public getRedacted<T = Record<string, unknown>>(name: string): Readonly<T> | null {
        if (!this.runtimeCache.has(name)) return null;
        return redactExpandedForApi(this.runtimeCache.get(name)) as T;
    }

    public getStrict<T = Record<string, unknown>>(name: string): Readonly<T> {
        const config = this.get<T>(name);
        if (!config) {
            throw new Error(`Required configuration [${name}.json5] is missing or failed to parse.`);
        }
        return config;
    }

    public has(name: string): boolean {
        return this.runtimeCache.has(name);
    }

    public dumpSnapshot(): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [name, value] of this.runtimeCache.entries()) {
            out[name] = JSON5.parse(JSON5.stringify(value));
        }
        return out;
    }

    /**
     * Plugin-scoped config mutation with validation against loaded schema/rules.
     * Only mutates the named plugin configuration document.
     */
    public async setPluginScopedValue(
        pluginId: string,
        key: string,
        value: unknown,
    ): Promise<void> {
        if (!pluginId.trim() || !key.trim()) {
            throw new Error('pluginId and key are required');
        }
        if (key.includes('..') || key.startsWith('/')) {
            throw new Error(`Invalid config key '${key}'`);
        }
        const name = pluginId;
        const currentRaw =
            (this.getRaw<Record<string, unknown>>(name) as Record<string, unknown> | null) ??
            {};
        const nextRaw: Record<string, unknown> = { ...currentRaw, [key]: value };
        const filePath = path.join(this.targetDir, `${name}.json5`);
        const expandResult = expandValue(nextRaw, {
            failClosed: undefined,
            resolveEmoji: false,
            collectUntaggedRand: false,
            softMiss: 'absent',
        });
        const validated = await this.validateConfigObject(
            name,
            filePath,
            expandResult.value,
        );
        if (!validated.ok) {
            throw new Error(`Config validation failed for [${name}]: ${validated.message}`);
        }
        this.rawCache.set(name, nextRaw);
        this.runtimeCache.set(name, validated.data);
        if (
            validated.data &&
            typeof validated.data === 'object' &&
            !Array.isArray(validated.data)
        ) {
            this.updateLiveReference(name, validated.data as Record<string, unknown>);
        }
        log.info(`Plugin-scoped config updated [${name}] key=${key}`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('config.plugin.updated', {
                    pluginId,
                    key,
                    at: Date.now(),
                }),
            )
            .catch(() => undefined);
    }

    public applySnapshot(raw: Record<string, unknown>): void {
        this.rawCache.clear();
        this.runtimeCache.clear();
        for (const name of Object.keys(raw)) {
            const value = raw[name];
            const rawClone = JSON5.parse(JSON5.stringify(value)) as unknown;
            const expandResult = expandValue(rawClone, {
                failClosed: undefined,
                resolveEmoji: false,
                collectUntaggedRand: false,
                softMiss: 'absent',
            });
            this.rawCache.set(name, value);
            this.runtimeCache.set(name, expandResult.value);
            if (
                expandResult.value &&
                typeof expandResult.value === 'object' &&
                !Array.isArray(expandResult.value)
            ) {
                this.updateLiveReference(name, expandResult.value as Record<string, unknown>);
            }
        }
        for (const name of [...this.liveConfigs.keys()]) {
            if (!this.runtimeCache.has(name)) {
                const liveRef = this.liveConfigs.get(name);
                if (liveRef) {
                    for (const key of Object.keys(liveRef)) {
                        delete liveRef[key];
                    }
                }
                this.liveConfigs.delete(name);
            }
        }
        log.info(`Config snapshot applied (${this.rawCache.size} entries, no disk I/O)`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('config.snapshot.applied', { entries: this.rawCache.size }))
            .catch(() => undefined);

    }
}

export const configManager = new ConfigManager();
