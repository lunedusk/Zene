import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { Dirent } from 'node:fs';
import { type Client } from 'discord.js';
import {
    shouldDisablePluginForConfig,
    formatPluginDisableMessage,
    getPluginDisableReason
} from '#core/validation/pluginGate.js';
import { getLogger } from '#core/utils/logger.js';
import { HeartFactory } from '#core/heart/index.js';
import { BasePlugin, PluginState, type PluginManifest } from '#core/bases/Plugin.js';
import { PackageManager } from '#core/helpers/integrity/manifest.js';
import { SemVer } from '#core/utils/semver.js';
import { secrets } from '#core/helpers/secretManager.js';
import { NodeVersion } from '#core/utils/nodever.js';
import { resolvePluginPublicKey } from '#core/helpers/integrity/publicKey.js';
import { CommandLoader } from './commands.js';
import { MiddlewareLoader } from './middlewares.js';
import { freezeCommandStructure } from './commandRegistry.js';
import { configLoader } from './config.js';
import { DependencyLoader } from './dependency.js';
import { emojiLoader } from './emoji.js';
import { EventLoader } from './events.js';
import { langLoader } from './lang.js';
import { RouteLoader } from './routes.js';
import { HandlerLoader } from './handler.js';
import { handlerRegistry } from '#core/manager/handler/registry.js';
import { int, number } from 'zod';

const log = getLogger('PluginManager');

interface DiscoveredPlugin {
    dir: string;
    manifest: PluginManifest;
}

interface PreloadedPlugin extends DiscoveredPlugin {
    PluginClass: new () => BasePlugin;
}

export enum PluginBootStatus {
    Pending = 'PENDING',
    Preloaded = 'PRELOADED',
    Success = 'SUCCESS',
    Failed = 'FAILED',
    Skipped = 'SKIPPED'
}

export class PluginManager extends EventEmitter {
    private readonly pluginsDir: string;
    public readonly registry = new Map<string, BasePlugin>();
    private preloadedPlugins: PreloadedPlugin[] = [];
    private readonly bootStatuses = new Map<string, PluginBootStatus>();
    private readonly integrityById = new Map<string, 'signed' | 'unsigned' | 'failed' | 'bypassed'>();
    private readonly pluginDirs = new Map<string, string>();

    private readonly LIFECYCLE_TIMEOUT_MS = 15000;
    private coreVersion: string = '0.0.0';

    constructor(baseDir: string = process.cwd()) {
        super();
        this.pluginsDir = path.join(baseDir, 'plugins');
        (globalThis as { __zenePluginManager?: PluginManager }).__zenePluginManager = this;
    }

    private async initCoreVersion(): Promise<void> {
        try {
            const pkgPath = path.join(process.cwd(), 'package.json');
            const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
            this.coreVersion = JSON.parse(pkgRaw).version || '0.0.0';
            log.debug(`Zene Core Version resolved to: v${this.coreVersion}`);
        } catch {
            log.warn('Could not read core package.json. Zene version checks may fail.');
        }
    }

    private async withTimeout<T>(promise: Promise<T>, pluginId: string, phase: string): Promise<T> {
        let timeoutHandle: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`[${pluginId}] ${phase} timed out after ${this.LIFECYCLE_TIMEOUT_MS}ms.`));
            }, this.LIFECYCLE_TIMEOUT_MS);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
    }

    private sortDependencies(plugins: Map<string, DiscoveredPlugin>): DiscoveredPlugin[] {
        const sorted: DiscoveredPlugin[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (pluginId: string, requiredBy?: string) => {
            if (visiting.has(pluginId)) {
                throw new Error(`Circular dependency detected: '${pluginId}' -> '${requiredBy}'`);
            }
            if (visited.has(pluginId)) return;

            visiting.add(pluginId);

            const plugin = plugins.get(pluginId);
            if (!plugin) {
                throw new Error(`Missing required dependency: '${pluginId}' (Required by '${requiredBy}')`);
            }

            if (plugin.manifest.dependencies) {
                for (const depId of plugin.manifest.dependencies) {
                    visit(depId, pluginId);
                }
            }

            visiting.delete(pluginId);
            visited.add(pluginId);
            sorted.push(plugin);
        };

        const orderedKeys = [...plugins.keys()].sort((a, b) => {
            const pa = plugins.get(a)!.manifest.priority ?? 0;
            const pb = plugins.get(b)!.manifest.priority ?? 0;
            return pa - pb;
        });

        for (const pluginId of orderedKeys) {
            try {
                visit(pluginId);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Dependency resolution failed for '${pluginId}': ${err.message}. Plugin will not load.`);
                plugins.delete(pluginId);
            }
        }

        return sorted;
    }

    private async discoverPlugins(): Promise<Map<string, DiscoveredPlugin>> {
        const discovered = new Map<string, DiscoveredPlugin>();
        
        const allowUncertified = secrets.getBoolean('allowUnCertifiedPlugins', false);
        const whitelistedStr = secrets.getOptional('whitelistedPlugins');
        
        const whitelistedSet = new Set(
            whitelistedStr ? whitelistedStr.split(',').map(s => s.trim()).filter(Boolean) : []
        );

        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
            
            await Promise.all(entries.map(async (entry: Dirent) => {
                if (!entry.isDirectory()) return;

                const pluginDir = path.join(this.pluginsDir, entry.name);
                const nvxPath = path.join(pluginDir, 'manifest.nvx');
                const jsonPath = path.join(pluginDir, 'manifest.json');

                try {
                    let manifest: PluginManifest | null = null;
                    let integrityPassed = false;
                    
                    const hasNvx = await fs.access(nvxPath).then(() => true).catch(() => false);

                    if (hasNvx) {
                        try {
                            manifest = await PackageManager.unpackAndVerify(
                                pluginDir,
                                resolvePluginPublicKey(entry.name),
                                'manifest.nvx',
                            );
                            integrityPassed = true;
                            this.integrityById.set(manifest.id, 'signed');
                        } catch (verifyError: unknown) {
                            const err = verifyError as Error;
                            log.warn(`[${entry.name}] INTEGRITY FAILURE: ${err.message}`);
                        }
                    }

                    if (!integrityPassed) {
                        const isWhitelisted = whitelistedSet.has(entry.name);
                        
                        if (!allowUncertified && !isWhitelisted) {
                            log.error(`[${entry.name}] Rejected: Integrity check failed/missing, and unsigned plugins are disabled.`);
                            return; 
                        }

                        log.warn(`[${entry.name}] BYPASS ACTIVE: Loading plugin via manifest.json without cryptographic guarantees.`);
                        
                        const jsonRaw = await fs.readFile(jsonPath, 'utf-8').catch(() => {
                            throw new Error('Missing manifest.json fallback. Cannot load bypassed plugin.');
                        });
                        
                        const parsed: unknown = JSON.parse(jsonRaw);
                        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                            throw new Error('Invalid manifest.json: Expected a JSON object.');
                        }
                        const raw = parsed as Record<string, unknown>;
                        const nodeDepsRaw = raw.node_dependencies ?? raw.nodeDependencies;
                        let nodeDependencies: Record<string, string> | undefined;
                        if (typeof nodeDepsRaw === 'object' && nodeDepsRaw !== null && !Array.isArray(nodeDepsRaw)) {
                            const map: Record<string, string> = {};
                            for (const [k, v] of Object.entries(nodeDepsRaw as Record<string, unknown>)) {
                                if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
                                    map[k.trim()] = v.trim();
                                }
                            }
                            if (Object.keys(map).length > 0) nodeDependencies = map;
                        }
                        manifest = {
                            id: typeof raw.id === 'string' ? raw.id : '',
                            name: typeof raw.name === 'string' ? raw.name : '',
                            version: typeof raw.version === 'string' ? raw.version : '',
                            description: typeof raw.description === 'string' ? raw.description : undefined,
                            author: typeof raw.author === 'string' ? raw.author : undefined,
                            dependencies: Array.isArray(raw.dependencies)
                                ? raw.dependencies.filter((d): d is string => typeof d === 'string')
                                : undefined,
                            zene_version: (typeof raw.zene_version === 'string' || Array.isArray(raw.zene_version))
                                ? (raw.zene_version as string | string[])
                                : undefined,
                            node_version: typeof raw.node_version === 'string' ? raw.node_version : undefined,
                            priority: typeof raw.priority === 'number' ? raw.priority : undefined,
                            nodeDependencies,
                        };
                        if (manifest.id) this.integrityById.set(manifest.id, 'bypassed');

                        if (!manifest.id || !manifest.name || !manifest.version) {
                            throw new Error('Invalid manifest.json: Missing required fields (id, name, version).');
                        }
                    }

                    if (manifest!.zene_version) {
                        let zeneOk = false;
                        try {
                            zeneOk = SemVer.satisfies(this.coreVersion, manifest!.zene_version as string | string[]);
                        } catch {
                            zeneOk = false;
                        }
                        if (!zeneOk) {
                            log.warn(`[${manifest!.id}] Incompatible Core Version. Plugin requires ${JSON.stringify(manifest!.zene_version)}, but core is v${this.coreVersion}. Skipping.`);
                            return;
                        }
                    }
                    if (manifest!.node_version && !NodeVersion.satisfies(manifest!.node_version)) {
                        const currentNode = NodeVersion.current().toString();
                        log.warn(
                            `[${manifest!.id}] Incompatible Node.js version. ` +
                            `Plugin requires ${manifest!.node_version}, but runtime is v${currentNode}. Skipping.`,
                        );
                        return;
                    }

                    discovered.set(manifest!.id, { dir: pluginDir, manifest: manifest! });
                    this.pluginDirs.set(manifest!.id, pluginDir);
                    this.bootStatuses.set(manifest!.id, PluginBootStatus.Pending);
                    
                } catch (error: unknown) {
                    const err = error as Error;
                    log.error(`[${entry.name}] CRITICAL LOAD ERROR: ${err.message}`);
                }
            }));
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') log.info('No plugins directory found. Skipping load.');
            else throw error;
        }

        return discovered;
    }
    
    public async preloadAll(): Promise<void> {
        log.info('Initiating Plugin Preload Sequence...');
        
        await this.initCoreVersion();

        const discoveredMap = await this.discoverPlugins();
        if (discoveredMap.size === 0) return;

        const sortedPlugins = this.sortDependencies(discoveredMap);
        log.info(`Resolved dependency graph for ${sortedPlugins.length} authorized plugins.`);

        for (const plugin of sortedPlugins) {
            const id = plugin.manifest.id;
            
            try {
                await DependencyLoader.installFromPackageJson(plugin.dir, id, plugin.manifest.nodeDependencies);
                await configLoader.syncPlugin(plugin.dir, id);
                await langLoader.syncPlugin(plugin.dir, id);

                const entryPath = path.join(plugin.dir, 'index.js');
                const baseUrl = pathToFileURL(entryPath).href;
                const importUrl = `${baseUrl}?v=${Date.now()}`;

                const Module = await import(importUrl).catch(err => {
                    throw new Error(`Failed to evaluate entrypoint: ${err.message}`);
                });

                const PluginClass = Module.default;
                if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof BasePlugin)) {
                    throw new Error(`Entrypoint does not export a valid BasePlugin class as default.`);
                }

                this.preloadedPlugins.push({ ...plugin, PluginClass });
                this.bootStatuses.set(id, PluginBootStatus.Preloaded);
                log.debug(`[${id}] Preload complete. Assets synced and verified code cached.`);

            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.bootStatuses.set(id, PluginBootStatus.Failed);
                log.error(`[${id}] Failed during preload phase: ${err.message}`);
            }
        }
    }

    public getPreloadedPluginDirs(): Array<{ dir: string; id: string }> {
        return this.preloadedPlugins.map((p) => ({
            dir: p.dir,
            id: p.manifest.id,
        }));
    }

    public excludePreloadedPlugin(pluginId: string, reason: string): void {
        const before = this.preloadedPlugins.length;
        this.preloadedPlugins = this.preloadedPlugins.filter((p) => p.manifest.id !== pluginId);
        this.bootStatuses.set(pluginId, PluginBootStatus.Failed);
        if (this.preloadedPlugins.length < before) {
            log.warn(`[${pluginId}] Removed from preload set (${reason}); will not boot.`);
        }
    }

    public async bootAll(baseClient: Client<true>): Promise<void> {
        const totalStart = performance.now();
        log.info('Initiating Plugin Boot Sequence...');

        for (const plugin of this.preloadedPlugins) {
            const { dir, manifest, PluginClass } = plugin;
            const id = manifest.id;
            const start = performance.now();

            if (shouldDisablePluginForConfig(id)) {
                this.bootStatuses.set(id, PluginBootStatus.Skipped);
                log.error(formatPluginDisableMessage(id));
                const reason = getPluginDisableReason(id);
                this.emit(
                    'pluginFailed',
                    manifest,
                    new Error(formatPluginDisableMessage(id) || 'Validation failed')
                );
                continue;
            }

            if (manifest.dependencies) {
                let skip = false;
                for (const depId of manifest.dependencies) {
                    const status = this.bootStatuses.get(depId);
                    if (status !== PluginBootStatus.Success && status !== PluginBootStatus.Preloaded) {
                        this.bootStatuses.set(id, PluginBootStatus.Skipped);
                        log.warn(`[${id}] Skipped boot. Dependency '${depId}' failed or was skipped.`);
                        skip = true;
                        break;
                    }
                }
                if (skip) continue;
            }

            log.info(`[${id}] Booting v${manifest.version}...`);

            try {
                const scopedHeart = HeartFactory.create(id, baseClient);
                const instance: BasePlugin = new PluginClass();
                instance._injectCore(scopedHeart); 
                
                instance._setState(PluginState.Setup);
                if (typeof instance.onSetup === 'function') {
                    await this.withTimeout(instance.onSetup(), id, 'onSetup()');
                }
                
                await MiddlewareLoader.loadForPlugin(dir, id, scopedHeart);
                await EventLoader.loadForPlugin(dir, id, scopedHeart);
                await CommandLoader.loadForPlugin(dir, id, scopedHeart);
                await HandlerLoader.loadForPlugin(dir, id, scopedHeart);
                await RouteLoader.loadForPlugin(dir, id, scopedHeart);
                

                instance._setState(PluginState.Enabled);
                await this.withTimeout(instance.onEnable(), id, 'onEnable()');

                this.registry.set(id, instance);
                this.bootStatuses.set(id, PluginBootStatus.Success);
                
                const timeMs = (performance.now() - start).toFixed(2);
                log.info(`[${id}] Successfully enabled in ${timeMs}ms.`);
                void import('#core/manager/event.js')
                    .then(({ eventBus }) =>
                        eventBus.emitConcurrent('plugin.enabled', {
                            pluginId: id,
                            durationMs: timeMs,
                        }),
                    )
                    .catch(() => undefined);

                this.emit('pluginLoaded', manifest);

            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.bootStatuses.set(id, PluginBootStatus.Failed);
                log.error(`[${id}] Critical failure during boot sequence: ${err.message}`, { stack: err.stack });
                this.emit('pluginFailed', manifest, err);
            }
        }

        if (baseClient) await emojiLoader.init(baseClient);

        freezeCommandStructure();

        const activeCount = this.registry.size;
        const totalTime = ((performance.now() - totalStart) / 1000).toFixed(2);
        const totalTimeMs = Math.round((performance.now() - totalStart));

        log.info(`Ecosystem Boot Complete in ${totalTime}s. [Loaded: ${activeCount}]`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('system.plugins.booted', {
                    count: activeCount,
                    durationMs: Math.round(totalTimeMs * 1000),
                }),
            )
            .catch(() => undefined);

        this.emit('ecosystemReady', { loaded: activeCount, timeSec: totalTime });
    }

    public async disable(pluginId: string): Promise<boolean> {
        const plugin = this.registry.get(pluginId);
        
        if (!plugin) {
            log.warn(`[${pluginId}] Teardown requested but plugin is not active in the registry.`);
            return false;
        }

        log.info(`[${pluginId}] Initiating surgical deconstruction...`);
        const start = performance.now();

        try {
            if (plugin.state === PluginState.Enabled) {
                await this.withTimeout(plugin.onDisable(), pluginId, 'onDisable');
                plugin._setState(PluginState.Disabled);
            }
            const { interactionRegistry } = await import('#core/manager/interaction/registry.js');
            interactionRegistry.unregisterPlugin(pluginId);
            log.debug(`[${pluginId}] Purged Discord interactions.`);

            const { eventBus } = await import('#core/manager/event.js');
            eventBus.unregisterByOwner(pluginId);
            log.debug(`[${pluginId}] Purged EventBus subscriptions.`);

            const { httpServer } = await import('#core/manager/http/server.js');
            const apiNamespace = `/api/plugins/${pluginId}`;
            httpServer.unregisterRouter(apiNamespace);
            log.debug(`[${pluginId}] Unmounted API namespace: ${apiNamespace}`);
            await handlerRegistry.unregisterPlugin(pluginId);
            log.debug(`[${pluginId}] Purged handler registrations.`);

            this.registry.delete(pluginId);
            this.bootStatuses.set(pluginId, PluginBootStatus.Pending);

            const duration = (performance.now() - start).toFixed(2);
            log.info(`[${pluginId}] Deconstruction complete in ${duration}ms.`);
            
            this.emit('pluginDisabled', pluginId);
            return true;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[${pluginId}] Fatal error during teardown: ${err.message}`);
            plugin._setState(PluginState.Error);
            return false;
        }
    }

    public getIntegrityStatus(pluginId: string): 'signed' | 'unsigned' | 'failed' | 'bypassed' | 'unknown' {
        return this.integrityById.get(pluginId) ?? 'unknown';
    }

    public listLoadedPlugins(): BasePlugin[] {
        return Array.from(this.registry.values());
    }

    public getPluginDir(pluginId: string): string | null {
        return this.pluginDirs.get(pluginId) ?? null;
    }

    public async shutdownAll(): Promise<void> {
        log.info('Initiating graceful shutdown of all plugins...');
        
        const activePlugins = Array.from(this.registry.values()).reverse();

        for (const plugin of activePlugins) {
            try {
                if (plugin.isEnabled) {
                    await this.withTimeout(plugin.onDisable(), plugin.manifest.id, 'onDisable()');
                    plugin._setState(PluginState.Disabled);
                    log.info(`[${plugin.manifest.id}] Shut down successfully.`);
                }
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${plugin.manifest.id}] Error during shutdown: ${err.message}`);
            }
        }
        const activeIds = Array.from(this.registry.keys()).reverse();
        for (const id of activeIds) {
            await handlerRegistry.unregisterPlugin(id);
        }
        
        this.registry.clear();
        this.bootStatuses.clear();
        this.integrityById.clear();
        this.pluginDirs.clear();
        this.emit('ecosystemOffline');
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('system.plugins.shutdown', { at: Date.now() }),
            )
            .catch(() => undefined);
    }

    public async reload(pluginString: string, baseClient: Client<true>): Promise<{ success: string[], failed: string[] }> {
        const ids = pluginString.split('$').map(id => id.trim()).filter(Boolean);
        const results = { success: [] as string[], failed: [] as string[] };

        for (const pluginId of ids) {
            log.info(`[${pluginId}] Commencing Hot-Reload Sequence...`);
            
            try {
                if (this.registry.has(pluginId)) {
                    const disabled = await this.disable(pluginId);
                    if (!disabled) throw new Error(`Failed to gracefully disable plugin: ${pluginId}`);
                }

                const discoveredMap = await this.discoverPlugins();
                const plugin = discoveredMap.get(pluginId);
                
                if (!plugin) throw new Error(`Plugin [${pluginId}] not found on disk or failed integrity checks.`);

                await DependencyLoader.installFromPackageJson(plugin.dir, pluginId, plugin.manifest.nodeDependencies);
                
                await configLoader.syncPlugin(plugin.dir, pluginId);
                await langLoader.syncPlugin(plugin.dir, pluginId);

                const { configManager } = await import('#core/manager/config.js');
                const { i18n } = await import('#core/manager/lang.js');
                const {
                    shouldDisablePluginForConfig,
                    formatPluginDisableMessage,
                    getPluginDisableReason
                } = await import('#core/validation/pluginGate.js');

                try {
                    await configManager.reloadAll();
                    await i18n.reloadAll();
                } catch (e) {
                    log.warn(
                        `[${pluginId}] Failed to refresh Config/Lang cache: ${(e as Error).message}`
                    );
                }

                if (shouldDisablePluginForConfig(pluginId)) {
                    const reason = getPluginDisableReason(pluginId);
                    const detail = formatPluginDisableMessage(pluginId);
                    throw new Error(detail || `Validation failed for ${pluginId}`);
                }

                const entryPath = path.join(plugin.dir, 'index.js');
                const baseUrl = pathToFileURL(entryPath).href;
                const importUrl = `${baseUrl}?v=${Date.now()}`; 
                
                const Module = await import(importUrl).catch(err => {
                    throw new Error(`Failed to evaluate entrypoint: ${err.message}`);
                });

                const PluginClass = Module.default;
                if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof BasePlugin)) {
                    throw new Error(`Entrypoint does not export a valid BasePlugin class as default.`);
                }

                const scopedHeart = HeartFactory.create(pluginId, baseClient);
                const instance: BasePlugin = new PluginClass();
                instance._injectCore(scopedHeart); 
                
                instance._setState(PluginState.Setup);
                if (typeof instance.onSetup === 'function') {
                    await this.withTimeout(instance.onSetup(), pluginId, 'onSetup()');
                }
                
                await MiddlewareLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                await EventLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                await CommandLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                await HandlerLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                await RouteLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                

                instance._setState(PluginState.Enabled);
                await this.withTimeout(instance.onEnable(), pluginId, 'onEnable()');

                this.registry.set(pluginId, instance);
                this.bootStatuses.set(pluginId, PluginBootStatus.Success);

                log.info(`[${pluginId}] Hot-Reload Complete. New code is online.`);
                this.emit('pluginLoaded', plugin.manifest);
                
                results.success.push(pluginId);

            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.bootStatuses.set(pluginId, PluginBootStatus.Failed);
                log.error(`[${pluginId}] Fatal error during hot-reload: ${err.message}`);
                results.failed.push(pluginId);
            }
        }

        if (results.success.length > 0) {
            try {
                const { interactionHandler } = await import('#core/manager/interaction/handler.js');
                const { secrets } = await import('#core/helpers/secretManager.js');
                
                log.info('Resynchronizing Discord Application Commands after hot-reload...');
                await interactionHandler.syncCommands(baseClient, secrets.getOptional('GuildID'));

                if (baseClient) {
                    log.info('Resynchronizing Emojis after hot-reload...');
                    await emojiLoader.init(baseClient);
                }
            } catch (syncErr) {
                log.error(`Failed to resync assets after reload: ${(syncErr as Error).message}`);
            }
        }

        return results;
    }
}

export const pluginManager = new PluginManager();