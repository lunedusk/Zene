import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { type Client } from 'discord.js';
import {
    shouldDisablePluginForConfig,
    formatPluginDisableMessage,
    getPluginDisableReason
} from '#core/validation/pluginGate.js';
import { getLogger } from '#core/utils/logger.js';
import { HeartFactory } from '#core/heart/index.js';
import { BasePlugin, PluginState, type PluginManifest } from '#core/bases/Plugin.js';
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
import { discoverPlugins, sortDependencies } from './discovery.js';
import {
    PluginBootStatus,
    type DiscoveredPlugin,
    type IntegrityStatus,
    type PreloadedPlugin,
} from './types.js';

export { PluginBootStatus } from './types.js';
export type { DiscoveredPlugin, PreloadedPlugin, IntegrityStatus } from './types.js';

const log = getLogger('PluginManager');

export class PluginManager extends EventEmitter {
    private readonly pluginsDir: string;
    public readonly registry = new Map<string, BasePlugin>();
    private preloadedPlugins: PreloadedPlugin[] = [];
    private readonly bootStatuses = new Map<string, PluginBootStatus>();
    private readonly integrityById = new Map<string, IntegrityStatus>();
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

    private async runDiscovery(): Promise<Map<string, DiscoveredPlugin>> {
        const result = await discoverPlugins(this.pluginsDir, this.coreVersion);
        for (const [id, status] of result.integrityById) {
            this.integrityById.set(id, status);
        }
        for (const [id, dir] of result.pluginDirs) {
            this.pluginDirs.set(id, dir);
        }
        for (const [id, status] of result.bootStatuses) {
            this.bootStatuses.set(id, status);
        }
        return result.discovered;
    }

    public async preloadAll(): Promise<void> {
        log.info('Initiating Plugin Preload Sequence...');
        
        await this.initCoreVersion();

        const discoveredMap = await this.runDiscovery();
        if (discoveredMap.size === 0) return;

        const sortedPlugins = sortDependencies(discoveredMap);
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

                const discoveredMap = await this.runDiscovery();
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