import { assertNoActiveDependents } from '#core/lifecycle/index.js';
import { verifyDependencyClosure } from '#core/helpers/integrity/dependencyClosure.js';
import { assertExecutionAuthorized } from '#core/helpers/integrity/authenticatedContext.js';
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
                assertExecutionAuthorized(id);
                await verifyDependencyClosure(id, plugin.dir);
                await DependencyLoader.installFromPackageJson(plugin.dir, id, plugin.manifest.nodeDependencies);
                await configLoader.syncPlugin(plugin.dir, id);
                await langLoader.syncPlugin(plugin.dir, id);

                // Security: NEVER import/execute plugin entrypoint during preload.
                // Executable code loads only after RuntimeManager establishes the selected runtime
                // (in-process hooks path or isolated host). Preload records metadata only.
                const entryPath = path.join(plugin.dir, 'index.js');
                try {
                    await fs.access(entryPath);
                } catch {
                    throw new Error(`Entrypoint missing: ${entryPath}`);
                }

                // Omit PluginClass — isolated plugins must not import executable code at preload
                this.preloadedPlugins.push({ ...plugin });
                this.bootStatuses.set(id, PluginBootStatus.Preloaded);
                log.debug(`[${id}] Preload complete (metadata/deps only; no plugin code executed).`);

            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.bootStatuses.set(id, PluginBootStatus.Failed);
                log.error(`[${id}] Failed during preload phase: ${err.message}`);
            }
        }
    }

    public getBootStatus(pluginId: string): PluginBootStatus | undefined {
        return this.bootStatuses.get(pluginId);
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
            const { dir, manifest } = plugin;
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
                const { resolvePluginRuntimePolicy, runtimeManager } = await import(
                    '#core/runtime/manager.js'
                );
                const rtPolicy = resolvePluginRuntimePolicy(id);
                const entryRelative = 'index.js';

                // Single RuntimeManager path for every backend (including in-process).
                if (rtPolicy.preferred === 'in-process' || rtPolicy.minimum === 'in-process') {
                    // Materialize first so Core never executes the mutable discovery path.
                    const { getAuthenticatedPluginContext } = await import(
                        '#core/helpers/integrity/authenticatedContext.js'
                    );
                    const {
                        materializeVerifiedArtifact,
                        snapshotDirectoryForExecution,
                    } = await import(
                        '#core/helpers/integrity/artifactMaterialization.js'
                    );
                    const authCtx = getAuthenticatedPluginContext(id);
                    let execDir = dir;
                    if (authCtx?.signedPayload?.integrity.files?.length) {
                        const mat = await materializeVerifiedArtifact({
                            pluginId: id,
                            sourceDir: dir,
                            artifactDigest: authCtx.signedPayload.integrity.rootDigest,
                            files: authCtx.signedPayload.integrity.files,
                            entryRelative,
                        });
                        execDir = mat.materializedRoot;
                    } else {
                        const mat = await snapshotDirectoryForExecution({
                            pluginId: id,
                            sourceDir: dir,
                            entryRelative,
                        });
                        execDir = mat.materializedRoot;
                    }

                    // Import executable only from materialized snapshot (never during preload).
                    const entryPath = path.join(execDir, 'index.js');
                    const importUrl = `${pathToFileURL(entryPath).href}?boot=${Date.now()}`;
                    const Module = await import(importUrl).catch((err: Error) => {
                        throw new Error(`Failed to evaluate in-process entrypoint: ${err.message}`);
                    });
                    const PluginClass = Module.default;
                    if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof BasePlugin)) {
                        throw new Error(`Entrypoint does not export a valid BasePlugin class as default.`);
                    }

                    const scopedHeart = HeartFactory.create(id, baseClient);
                    const instance: BasePlugin = new PluginClass();
                    instance._injectCore(scopedHeart);

                    const { selection, handle } = await runtimeManager.establish({
                        pluginId: id,
                        pluginDir: execDir,
                        entryRelative,
                        policy: {
                            preferred: 'in-process',
                            minimum: 'in-process',
                            allowed: ['in-process'],
                            allowFallback: false,
                        },
                        inProcessHooks: {
                            setup: async () => {
                                instance._setState(PluginState.Setup);
                                if (typeof instance.onSetup === 'function') {
                                    await this.withTimeout(instance.onSetup(), id, 'onSetup()');
                                }
                                await MiddlewareLoader.loadForPlugin(dir, id, scopedHeart);
                                await EventLoader.loadForPlugin(dir, id, scopedHeart);
                                await CommandLoader.loadForPlugin(dir, id, scopedHeart);
                                await HandlerLoader.loadForPlugin(dir, id, scopedHeart);
                                await RouteLoader.loadForPlugin(dir, id, scopedHeart);
                            },
                            enable: async () => {
                                instance._setState(PluginState.Enabled);
                                await this.withTimeout(instance.onEnable(), id, 'onEnable()');
                            },
                            disable: async () => {
                                if (typeof instance.onDisable === 'function') {
                                    await this.withTimeout(instance.onDisable(), id, 'onDisable()');
                                }
                                instance._setState(PluginState.Disabled);
                            },
                            unload: async () => {
                                instance._setState(PluginState.Unloaded);
                            },
                        },
                    });
                    if (!selection.ok || !handle) {
                        throw new Error(
                            `RuntimeManager rejected in-process for ${id}: ${
                                selection.ok === false ? selection.message : 'no handle'
                            }`,
                        );
                    }
                    await runtimeManager.lifecycle(id, 'setup');
                    await runtimeManager.lifecycle(id, 'enable');
                    this.registry.set(id, instance);
                    this.bootStatuses.set(id, PluginBootStatus.Success);
                    this.pluginDirs.set(id, dir);
                    void import('#core/lifecycle/index.js')
                        .then(({ lifecycleController, markArtifactVerified }) => {
                            lifecycleController.setPhase(id, 'enabled');
                            markArtifactVerified(id);
                        })
                        .catch(() => undefined);
                } else {
                    // Worker/Process/Container: shared host loads the same authorized entry artifact.
                    const { selection, handle } = await runtimeManager.establish({
                        pluginId: id,
                        pluginDir: dir,
                        entryRelative,
                        policy: rtPolicy,
                    });
                    if (!selection.ok || !handle) {
                        throw new Error(
                            `RuntimeManager rejected for ${id}: ${
                                selection.ok === false ? selection.message : 'no handle'
                            }`,
                        );
                    }
                    const setupRes = await runtimeManager.lifecycle(id, 'setup');
                    const enableRes = await runtimeManager.lifecycle(id, 'enable');
                    if (setupRes.type === 'host.lifecycle.result' && !setupRes.payload.ok) {
                        throw new Error(setupRes.payload.error || 'setup failed');
                    }
                    if (enableRes.type === 'host.lifecycle.result' && !enableRes.payload.ok) {
                        throw new Error(enableRes.payload.error || 'enable failed');
                    }
                    this.bootStatuses.set(id, PluginBootStatus.Success);
                    this.pluginDirs.set(id, dir);
                    log.info(
                        `[${id}] Isolated runtime online level=${handle.level} id=${handle.id}`,
                    );
                    void import('#core/lifecycle/index.js')
                        .then(({ lifecycleController, markArtifactVerified }) => {
                            lifecycleController.setPhase(id, 'enabled');
                            markArtifactVerified(id);
                        })
                        .catch(() => undefined);
                }

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
                // R: no orphan runtime after establish+setup/enable failure
                try {
                    const { runtimeManager } = await import('#core/runtime/manager.js');
                    await runtimeManager.terminate(id, 'boot-failure');
                } catch {
                    /* ignore */
                }
                try {
                    const { clearAuthenticatedPluginContext } = await import(
                        '#core/helpers/integrity/authenticatedContext.js'
                    );
                    clearAuthenticatedPluginContext(id);
                } catch {
                    /* ignore */
                }
                this.emit('pluginFailed', manifest, err);
            }
        }

        if (baseClient) await emojiLoader.init(baseClient);

        freezeCommandStructure();

        let activeCount = [...this.bootStatuses.values()].filter(
            (s) => s === PluginBootStatus.Success,
        ).length;
        try {
            const { countLoadedPluginRuntimeRecords } = await import(
                '#core/runtime/pluginRuntimeRecord.js'
            );
            const fromRecords = countLoadedPluginRuntimeRecords();
            if (fromRecords > activeCount) activeCount = fromRecords;
        } catch {
            /* ignore */
        }
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
        assertNoActiveDependents(pluginId, 'disable');
        assertNoActiveDependents(pluginId, 'unload');
        const plugin = this.registry.get(pluginId);
        const { runtimeManager } = await import('#core/runtime/manager.js');
        const isolatedHandle = runtimeManager.get(pluginId);

        // Isolated plugins may not appear in registry — still must tear down runtime.
        if (!plugin && !isolatedHandle) {
            log.warn(`[${pluginId}] Teardown requested but plugin is not active.`);
            return false;
        }

        // Dependency awareness: warn if other enabled plugins declare this as a dependency.
        for (const [otherId, other] of this.registry) {
            if (otherId === pluginId) continue;
            const deps = other.manifest.dependencies;
            if (deps?.includes(pluginId) && other.isEnabled) {
                log.warn(
                    `[${pluginId}] Disable requested while dependent plugin '${otherId}' is still enabled. ` +
                        `Disable dependents first for a clean dependency-aware teardown.`,
                );
            }
        }

        log.info(`[${pluginId}] Initiating surgical deconstruction...`);
        const start = performance.now();

        try {
            const { lifecycleController, resourceRegistry } = await import(
                '#core/lifecycle/index.js'
            );
            lifecycleController.setPhase(pluginId, 'disabling');

            if (isolatedHandle) {
                try {
                    await runtimeManager.lifecycle(pluginId, 'disable');
                } catch (lifeErr: unknown) {
                    log.warn(
                        `[${pluginId}] Isolated disable lifecycle: ${(lifeErr as Error).message}`,
                    );
                }
                await runtimeManager.terminate(pluginId, 'disable');
            }

            if (plugin && plugin.state === PluginState.Enabled) {
                await this.withTimeout(plugin.onDisable(), pluginId, 'onDisable');
                plugin._setState(PluginState.Disabled);
            }

            // Phase 2B: explicit resource ownership cleanup (continues after failures)
            const cleanup = await resourceRegistry.release(pluginId, 'disable');
            if (cleanup.failures.length > 0) {
                log.warn(
                    `[${pluginId}] ${cleanup.failures.length}/${cleanup.attempted} owned resource(s) failed cleanup.`,
                );
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

            // Phase 2B: drop plugin-owned provider registrations (category::id with pluginId)
            try {
                const { providerRegistry } = await import('#core/provider/registry.js');
                for (const reg of providerRegistry.list()) {
                    if (reg.pluginId === pluginId) {
                        providerRegistry.unregister(reg.category, reg.id);
                        log.debug(
                            `[${pluginId}] Unregistered provider ${reg.category}/${reg.id}`,
                        );
                    }
                }
            } catch (provErr: unknown) {
                log.warn(
                    `[${pluginId}] Provider registry cleanup issue: ${(provErr as Error).message}`,
                );
            }

            // Full unload-owned resources after subsystem purge
            await resourceRegistry.release(pluginId, 'unload');

            this.registry.delete(pluginId);
            this.bootStatuses.set(pluginId, PluginBootStatus.Pending);
            lifecycleController.setPhase(pluginId, 'unloaded');
            lifecycleController.clear(pluginId);

            const duration = (performance.now() - start).toFixed(2);
            log.info(`[${pluginId}] Deconstruction complete in ${duration}ms.`);
            
            this.emit('pluginDisabled', pluginId);
            return true;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`[${pluginId}] Fatal error during teardown: ${err.message}`);
            if (plugin) plugin._setState(PluginState.Error);
            try {
                await runtimeManager.terminate(pluginId, 'disable-error');
            } catch {
                /* ignore */
            }
            try {
                const { lifecycleController } = await import('#core/lifecycle/index.js');
                lifecycleController.setPhase(pluginId, 'failed');
            } catch {
                /* ignore */
            }
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

        const { runtimeManager } = await import('#core/runtime/manager.js');
        // Terminate ALL isolated runtimes first (Process/Worker), not only registry instances
        for (const handle of [...runtimeManager.list()]) {
            try {
                await runtimeManager.lifecycle(handle.pluginId, 'disable').catch(() => undefined);
                await runtimeManager.terminate(handle.pluginId, 'shutdown');
                log.info(`[${handle.pluginId}] Isolated runtime terminated (${handle.level}).`);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${handle.pluginId}] Error terminating runtime: ${err.message}`);
            }
        }
        
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
        this.preloadedPlugins = [];
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
                assertNoActiveDependents(pluginId, 'reload');
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

                // Unified reload via RuntimeManager — isolated plugins never imported into Core
                const { resolvePluginRuntimePolicy, runtimeManager } = await import(
                    '#core/runtime/manager.js'
                );
                const rtPolicy = resolvePluginRuntimePolicy(pluginId);
                const entryRelative = 'index.js';

                if (rtPolicy.preferred === 'in-process' || rtPolicy.minimum === 'in-process') {
                    const entryPath = path.join(plugin.dir, 'index.js');
                    const importUrl = `${pathToFileURL(entryPath).href}?reload=${Date.now()}`;
                    const Module = await import(importUrl).catch((err: Error) => {
                        throw new Error(`Failed to evaluate entrypoint: ${err.message}`);
                    });
                    const PluginClass = Module.default;
                    if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof BasePlugin)) {
                        throw new Error(`Entrypoint does not export a valid BasePlugin class as default.`);
                    }
                    const scopedHeart = HeartFactory.create(pluginId, baseClient);
                    const instance: BasePlugin = new PluginClass();
                    instance._injectCore(scopedHeart);
                    const established = await runtimeManager.establish({
                        pluginId,
                        pluginDir: plugin.dir,
                        entryRelative,
                        policy: {
                            preferred: 'in-process',
                            minimum: 'in-process',
                            allowed: ['in-process'],
                            allowFallback: false,
                        },
                        inProcessHooks: {
                            setup: async () => {
                                instance._setState(PluginState.Setup);
                                if (typeof instance.onSetup === 'function') {
                                    await this.withTimeout(instance.onSetup(), pluginId, 'onSetup()');
                                }
                                await MiddlewareLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                                await EventLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                                await CommandLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                                await HandlerLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                                await RouteLoader.loadForPlugin(plugin.dir, pluginId, scopedHeart);
                            },
                            enable: async () => {
                                instance._setState(PluginState.Enabled);
                                await this.withTimeout(instance.onEnable(), pluginId, 'onEnable()');
                            },
                            disable: async () => {
                                if (typeof instance.onDisable === 'function') {
                                    await this.withTimeout(instance.onDisable(), pluginId, 'onDisable()');
                                }
                                instance._setState(PluginState.Disabled);
                            },
                            unload: async () => {
                                instance._setState(PluginState.Unloaded);
                            },
                        },
                    });
                    if (!established.selection.ok || !established.handle) {
                        throw new Error(
                            `Reload runtime rejected: ${established.selection.ok === false ? established.selection.message : 'no handle'}`,
                        );
                    }
                    await runtimeManager.lifecycle(pluginId, 'setup');
                    await runtimeManager.lifecycle(pluginId, 'enable');
                    this.registry.set(pluginId, instance);
                } else {
                    const established = await runtimeManager.establish({
                        pluginId,
                        pluginDir: plugin.dir,
                        entryRelative,
                        policy: rtPolicy,
                    });
                    if (!established.selection.ok || !established.handle) {
                        throw new Error(
                            `Reload isolated runtime rejected: ${established.selection.ok === false ? established.selection.message : 'no handle'}`,
                        );
                    }
                    const setupRes = await runtimeManager.lifecycle(pluginId, 'setup');
                    const enableRes = await runtimeManager.lifecycle(pluginId, 'enable');
                    if (setupRes.type === 'host.lifecycle.result' && !setupRes.payload.ok) {
                        await runtimeManager.terminate(pluginId, 'reload-setup-fail');
                        throw new Error(setupRes.payload.error || 'setup failed');
                    }
                    if (enableRes.type === 'host.lifecycle.result' && !enableRes.payload.ok) {
                        await runtimeManager.terminate(pluginId, 'reload-enable-fail');
                        throw new Error(enableRes.payload.error || 'enable failed');
                    }
                }

                this.bootStatuses.set(pluginId, PluginBootStatus.Success);
                log.info(`[${pluginId}] Hot-Reload Complete via RuntimeManager.`);
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