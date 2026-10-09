import type { DataAccessQuery } from '#core/data/types.js';
/**
 * Core installs a generation-scoped SDK bridge for an authorized plugin runtime.
 */

import { dataRegistry, DataRegistryError } from '#core/data/index.js';
import {
    registerContribution,
    revokeContribution,
    revokeAllForPlugin,
    listContributions,
} from '#core/dashboard/index.js';
import { getLogger } from '#core/utils/logger.js';
import { providerRegistry } from '#core/provider/registry.js';
import { assertProviderRegistrationAllowed } from '#core/provider/declarations.js';
import {
    createProviderBinding,
    invalidateBindingsForRuntime,
} from '#core/provider/binding.js';
import { resourceRegistry } from '#core/lifecycle/resourceRegistry.js';
import { getCrossHostBus } from '#core/heart/crossHost.js';
import type { PluginBusHandler } from '#core/heart/crossHost.js';
import {
    assertSdkLogicalChannel,
    physicalPluginChannel,
    parsePhysicalPluginChannel,
} from '#core/crosshost/protocol/pluginChannel.js';
import {
    resolveTrackingId,
    runWithTrackingContextAsync,
} from '#core/crosshost/tracking.js';
import {
    PLUGIN_BUS_DEFAULT_TIMEOUT_MS,
    PLUGIN_BUS_MAX_TIMEOUT_MS,
    PLUGIN_BUS_MIN_TIMEOUT_MS,
    PLUGIN_BUS_MAX_PAYLOAD_BYTES,
} from '#core/crosshost/worker/pluginBus.js';
import { encodeMessage } from '#core/crosshost/protocol/codec.js';
import { eventBus } from '#core/manager/event.js';
import { configManager } from '#core/manager/config.js';
import { httpServer } from '#core/manager/http/server.js';
import { interactionRegistry } from '#core/manager/interaction/registry.js';
import type { RegisterRequirements } from '#core/loader/requirements.js';
import {
    registerRootCommand,
    unregisterRootCommand,
    getRegisteredRoot,
    extendCommand,
} from '#core/loader/commandRegistry.js';
import { HeartFactory } from '#core/heart/index.js';
import { getHeartClient, getHeartPermissions } from '#core/heart/holders.js';
import { SlashCommandBuilder } from 'discord.js';
import type { ProviderCategoryId } from '#core/provider/types.js';
import type { Router } from 'express';
import type {
    ChatInputCommandInteraction,
    ButtonInteraction,
    AnySelectMenuInteraction,
    ModalSubmitInteraction,
} from 'discord.js';
import {
    registerSdkBridge,
    clearSdkBridge,
    getSdkBridge,
    type SdkBridge,
} from './bridge.js';
import type {
    SdkSessionContext,
    SdkRuntimeRequirements,
    SdkDependencyDeclaration,
} from './types.js';
import { SdkError } from './types.js';
import { SDK_VERSION, SDK_CONTRACT_VERSION } from './version.js';
import { scheduler } from '#core/scheduler/index.js';
import { cooldownManager } from '#core/manager/cooldown.js';
import { featureRequirements } from '#core/manager/featureRequirements.js';
import { cacheFacade } from '#core/manager/cacheFacade.js';
import { i18n } from '#core/manager/lang.js';
import { emojis } from '#core/manager/emoji.js';


function ownerKey(pluginId: string, runtimeId: string, generation: number): string {
    return `sdk:${pluginId}:${runtimeId}:${generation}`;
}

function trustForProvider(
    outcome: SdkSessionContext['trustOutcome'],
): 'trusted' | 'bypassed' | 'rejected' | 'unknown-signer' | 'untrusted' {
    if (outcome === 'trusted') return 'trusted';
    if (outcome === 'bypassed') return 'bypassed';
    if (outcome === 'legacy') return 'trusted';
    return 'untrusted';
}


function toDataAccessQuery(query: unknown): DataAccessQuery | undefined {
    if (query === undefined) {
        return undefined;
    }
    if (query === null || typeof query !== 'object' || Array.isArray(query)) {
        throw new DataRegistryError(
            'DATA_UNSUPPORTED_CAPABILITY',
            'Access query must be a plain object with optional key filter',
        );
    }
    let key: string | undefined;
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
        key = value;
    }
    if (key === undefined) {
        return {};
    }
    return { key };
}

export function installPluginSdkBridge(input: {
    pluginId: string;
    runtimeId: string;
    generation: number;
    trustOutcome: SdkSessionContext['trustOutcome'];
    authorized: boolean;
    runtimeRequirements?: SdkRuntimeRequirements;
    dependencies?: readonly SdkDependencyDeclaration[];
}): SdkBridge {
    if (!input.authorized) {
        throw new SdkError({
            code: 'SDK_BRIDGE_UNAUTHORIZED',
            message: `Cannot install SDK bridge for unauthorized plugin '${input.pluginId}'`,
            details: { trustOutcome: input.trustOutcome },
        });
    }

    const log = getLogger(`SDK:${input.pluginId}`);
    const owner = ownerKey(input.pluginId, input.runtimeId, input.generation);
    const unsubs: Array<() => void> = [];
    const chatNames = new Set<string>();
    const rootNames = new Set<string>();
    const buttonIds = new Set<string>();
    const selectIds = new Set<string>();
    const modalIds = new Set<string>();
    const routeBases = new Set<string>();
    const providerKeys: Array<{ category: string; id: string }> = [];
    const scheduledTasks = new Set<string>();
    type SdkChHandler = {
        logical: string;
        physical: string;
        handler: PluginBusHandler;
        userHandler: (
            payload: unknown,
            meta: {
                fromMachineId: string;
                channel: string;
                requestId?: string;
                trackingId?: string;
                messageId?: string;
            },
        ) => unknown | Promise<unknown>;
        resourceId: string;
    };
    const crossHostHandlers = new Map<string, SdkChHandler>();
    /** Per-session concurrent CrossHost request slots (max 128). */
    const crossHostPending = new Map<string, true>();
    let crossHostPendingSeq = 0;
    const featureIds = new Set<string>();
    const cooldownSlugs = new Set<string>();
    const pluginCacheNs = cacheFacade.namespace(`sdk:${input.pluginId}:${input.runtimeId}:${input.generation}`);


    const session: SdkSessionContext = {
        pluginId: input.pluginId,
        runtimeId: input.runtimeId,
        generation: input.generation,
        sdkVersion: SDK_VERSION,
        contractVersion: SDK_CONTRACT_VERSION,
        trustOutcome: input.trustOutcome,
        authorized: true,
    };

    const runtimeRequirements: SdkRuntimeRequirements = Object.freeze({
        minimumIsolation: input.runtimeRequirements?.minimumIsolation,
        requiredCapabilities: Object.freeze([
            ...(input.runtimeRequirements?.requiredCapabilities ?? []),
        ]),
        allowedRuntimes: input.runtimeRequirements?.allowedRuntimes
            ? Object.freeze([...input.runtimeRequirements.allowedRuntimes])
            : undefined,
        preferredRuntime: input.runtimeRequirements?.preferredRuntime,
    });

    const dependencies: readonly SdkDependencyDeclaration[] = Object.freeze(
        (input.dependencies ?? []).map((d) =>
            Object.freeze({
                id: d.id,
                kind: d.kind,
                optional: d.optional ?? false,
                versionRange: d.versionRange,
            }),
        ),
    );

    const logCtx = {
        pluginId: input.pluginId,
        runtimeId: input.runtimeId,
        generation: input.generation,
    };

    const bridge: SdkBridge = {
        session,
        runtimeRequirements,
        dependencies,
        log: (level, message, meta) => {
            const merged = { ...logCtx, ...meta };
            const line = `${message} ${JSON.stringify(merged)}`;
            if (level === 'debug') log.debug(line);
            else if (level === 'info') log.info(line);
            else if (level === 'warn') log.warn(line);
            else log.error(line);
        },
        config: {
            has(key: string): boolean {
                if (configManager.has(input.pluginId)) {
                    const cfg = configManager.get<Record<string, unknown>>(input.pluginId);
                    if (cfg && key in cfg) return true;
                    if (!key.includes('.')) return true;
                }
                return configManager.has(key);
            },
            async get<T = unknown>(key: string): Promise<T | undefined> {
                const cfg = configManager.get<Record<string, unknown>>(input.pluginId);
                if (cfg && key in cfg) return cfg[key] as T;
                if (cfg && !key.includes('.')) return cfg as T;
                const named = configManager.get<T>(key);
                return named ?? undefined;
            },
            async getRaw<T = unknown>(): Promise<T | undefined> {
                return (
                    (configManager.getRaw<T>(input.pluginId) as T | null) ?? undefined
                );
            },
            async set(key: string, value: unknown): Promise<void> {
                if (value === undefined) {
                    throw new SdkError({
                        code: 'SDK_INVALID_CONFIG',
                        message: `Invalid config write for '${key}': value required`,
                    });
                }
                try {
                    await configManager.setPluginScopedValue(
                        input.pluginId,
                        key,
                        value,
                    );
                } catch (err: unknown) {
                    throw new SdkError({
                        code: 'SDK_INVALID_CONFIG',
                        message: `Config write rejected for plugin '${input.pluginId}' key '${key}'`,
                        details: {
                            reason: err instanceof Error ? err.message : String(err),
                        },
                    });
                }
            },
        },
        events: {
            async emit(event: string, ...args: unknown[]): Promise<void> {
                await eventBus.emit(event, ...args);
            },
            on(event, handler) {
                const off = eventBus.on(event, handler, { owner });
                unsubs.push(off);
                return () => {
                    off();
                    const i = unsubs.indexOf(off);
                    if (i >= 0) unsubs.splice(i, 1);
                };
            },
            once(event, handler) {
                const off = eventBus.on(event, handler, { owner, once: true });
                unsubs.push(off);
                return () => {
                    off();
                    const i = unsubs.indexOf(off);
                    if (i >= 0) unsubs.splice(i, 1);
                };
            },
        },
        providers: {
            select<T>(category: string): T | undefined {
                const result = providerRegistry.select(category as ProviderCategoryId);
                if (!result.ok) return undefined;
                return result.provider.implementation as T;
            },
            register(declaration) {
                assertProviderRegistrationAllowed({
                    pluginId: input.pluginId,
                    category: declaration.category,
                    id: declaration.id,
                    priority: declaration.priority,
                    trustOutcome: trustForProvider(input.trustOutcome),
                });
                const trusted =
                    input.trustOutcome === 'trusted' || input.trustOutcome === 'legacy';
                providerRegistry.register({
                    id: declaration.id,
                    category: declaration.category as ProviderCategoryId,
                    version: declaration.version,
                    priority: declaration.priority,
                    pluginId: input.pluginId,
                    trusted,
                    available: declaration.available ?? true,
                    capabilities: declaration.capabilities,
                    implementation: declaration.implementation,
                });
                createProviderBinding({
                    pluginId: input.pluginId,
                    category: declaration.category,
                    providerId: declaration.id,
                    runtimeId: input.runtimeId,
                });
                providerKeys.push({
                    category: declaration.category,
                    id: declaration.id,
                });
                return `${declaration.category}::${declaration.id}`;
            },
        },
        resources: {
            track(trackInput) {
                const handle = resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: trackInput.releaseOn,
                    dispose: trackInput.dispose,
                    label: trackInput.label ?? owner,
                });
                return handle.id;
            },
            untrack(resourceId) {
                resourceRegistry.untrack(input.pluginId, resourceId);
            },
        },
        data: {
            registerType(def) {
                dataRegistry.register({
                    id: def.id,
                    ownerPluginId: input.pluginId,
                    schema: def.schema ?? {},
                    scope: def.scope,
                    personalData: def.personalData,
                    privacyClass: def.privacyClass,
                    retention: def.retention,
                    storage: def.storage,
                });
            },
            async access(typeId, subject, query) {
                try {
                    const normalizedQuery = toDataAccessQuery(query);
                    return await dataRegistry.access({
                        typeId,
                        subject,
                        query: normalizedQuery,
                        requesterPluginId: input.pluginId,
                    });
                } catch (err) {
                    if (err instanceof DataRegistryError) {
                        throw new SdkError({
                            code: err.code,
                            message: err.message,
                        });
                    }
                    throw err;
                }
            },
            async write(typeId, key, subject, value) {
                try {
                    await dataRegistry.write({
                        typeId,
                        key,
                        subject,
                        value,
                        requesterPluginId: input.pluginId,
                    });
                } catch (err) {
                    if (err instanceof DataRegistryError) {
                        throw new SdkError({
                            code: err.code,
                            message: err.message,
                        });
                    }
                    throw err;
                }
            },
            async export(typeId, subject) {
                try {
                    return await dataRegistry.export(typeId, subject, input.pluginId);
                } catch (err) {
                    if (err instanceof DataRegistryError) {
                        throw new SdkError({
                            code: err.code,
                            message: err.message,
                        });
                    }
                    throw err;
                }
            },
            async delete(typeId, subject) {
                try {
                    const res = await dataRegistry.delete(
                        typeId,
                        subject,
                        input.pluginId,
                    );
                    return res.deleted;
                } catch (err) {
                    if (err instanceof DataRegistryError) {
                        throw new SdkError({
                            code: err.code,
                            message: err.message,
                        });
                    }
                    throw err;
                }
            },
        },
        dashboard: {
            contribute(contribution) {
                // Ownership is session-derived only; never read pluginId/runtimeId/generation from input
                const c = {
                    contributionId: contribution.contributionId,
                    kind: contribution.kind as import('#core/dashboard/index.js').DashboardContributionKind,
                    scope: contribution.scope as import('#core/dashboard/index.js').DashboardScope,
                    title: contribution.title,
                    route: contribution.route,
                    apiPath: contribution.apiPath,
                    permissionBits: contribution.permissionBits,
                    capability: contribution.capability,
                    order: contribution.order,
                    payload: contribution.payload,
                };
                if (!c.contributionId || !c.title || !c.kind || !c.scope) {
                    throw new SdkError({
                        code: 'SDK_INVALID_REGISTRATION',
                        message:
                            'Dashboard contribution requires contributionId, kind, scope, title',
                    });
                }
                const permissionBits: readonly string[] = c.permissionBits ?? [];
                const order: number = c.order ?? 0;
                const id = registerContribution({
                    contributionId: c.contributionId,
                    pluginId: input.pluginId,
                    runtimeId: input.runtimeId,
                    generation: input.generation,
                    kind: c.kind,
                    scope: c.scope,
                    title: c.title,
                    route: c.route,
                    apiPath: c.apiPath ?? c.route,
                    permissionBits,
                    capability: c.capability,
                    order,
                    payload: c.payload,
                });
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `dash:${c.contributionId}`,
                    id: `sdk_dash_${input.runtimeId}_${input.generation}_${c.contributionId}`,
                    dispose: () => {
                        revokeContribution(input.pluginId, c.contributionId);
                    },
                });
                return id;
            },
            revoke(contributionId) {
                revokeContribution(input.pluginId, contributionId, {
                    runtimeId: input.runtimeId,
                    generation: input.generation,
                });
                resourceRegistry.untrack(
                    input.pluginId,
                    `sdk_dash_${input.runtimeId}_${input.generation}_${contributionId}`,
                );
            },
            list() {
                return listContributions({ pluginId: input.pluginId }).map((c) => {
                    // SDK-created rows always have ownership; legacy rows fall back to session
                    const runtimeId = c.runtimeId ?? input.runtimeId;
                    const generation = c.generation ?? input.generation;
                    return {
                        contributionId: c.contributionId,
                        kind: c.kind,
                        scope: c.scope,
                        title: c.title,
                        route: c.route,
                        apiPath: c.apiPath,
                        permissionBits: c.permissionBits,
                        capability: c.capability,
                        order: c.order,
                        payload: c.payload,
                        pluginId: c.pluginId,
                        runtimeId,
                        generation,
                    };
                });
            },
        },
        http: {
            registerRouter(basePath: string, router: Router): void {
                if (!basePath.startsWith('/')) {
                    throw new SdkError({
                        code: 'SDK_INVALID_REGISTRATION',
                        message: 'HTTP basePath must start with /',
                    });
                }
                httpServer.registerRouter(basePath, router);
                routeBases.add(basePath);
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `http:${basePath}`,
                    id: `sdk_http_${input.runtimeId}_${input.generation}_${basePath}`,
                    dispose: () => {
                        httpServer.unregisterRouter(basePath);
                        routeBases.delete(basePath);
                    },
                });
            },
            unregisterRouter(basePath: string): void {
                httpServer.unregisterRouter(basePath);
                routeBases.delete(basePath);
                resourceRegistry.untrack(
                    input.pluginId,
                    `sdk_http_${input.runtimeId}_${input.generation}_${basePath}`,
                );
            },
            listMounts(): readonly string[] {
                return httpServer.listMounts().filter((m) => routeBases.has(m));
            },
        },
        commands: {
            async registerRoot(def) {
                const client = getHeartClient();
                if (!client) {
                    throw new SdkError({
                        code: 'SDK_RUNTIME_UNAVAILABLE',
                        message:
                            'Core Discord client is not ready; cannot register application commands',
                    });
                }
                const heart = HeartFactory.create(input.pluginId, client);
                const data = new SlashCommandBuilder()
                    .setName(def.name)
                    .setDescription(def.description);
                if (def.build) def.build(data);

                let registered = false;
                try {
                    registered = await registerRootCommand({
                        heart,
                        pluginId: input.pluginId,
                        data,
                        config: {},
                        execute: def.execute,
                        autocomplete: def.autocomplete,
                        requirements: def.requirements as RegisterRequirements | undefined,
                        resync: def.resync,
                        runtimeId: input.runtimeId,
                        generation: input.generation,
                    });
                } catch (err: unknown) {
                    // Ensure no partial root remains
                    unregisterRootCommand({
                        name: def.name,
                        pluginId: input.pluginId,
                        runtimeId: input.runtimeId,
                        generation: input.generation,
                    });
                    throw err;
                }
                if (!registered) {
                    throw new SdkError({
                        code: 'SDK_INVALID_REGISTRATION',
                        message: `Root command '${def.name}' was not registered (requirements failed)`,
                    });
                }

                const id = `sdk_root_${input.runtimeId}_${input.generation}_${def.name}`;
                rootNames.add(def.name);
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `root:${def.name}`,
                    id,
                    dispose: () => {
                        unregisterRootCommand({
                            name: def.name,
                            pluginId: input.pluginId,
                            runtimeId: input.runtimeId,
                            generation: input.generation,
                        });
                        rootNames.delete(def.name);
                    },
                });

                if (def.resync) {
                    try {
                        await heart.registry.resyncApplicationCommands();
                    } catch (err: unknown) {
                        log.warn(
                            `resync after root command ${def.name} failed: ${
                                err instanceof Error ? err.message : String(err)
                            }`,
                        );
                    }
                }
                return id;
            },
            async extendRoot(def) {
                const client = getHeartClient();
                if (!client) {
                    throw new SdkError({
                        code: 'SDK_RUNTIME_UNAVAILABLE',
                        message:
                            'Core Discord client is not ready; cannot extend application commands',
                    });
                }
                const heart = HeartFactory.create(input.pluginId, client);
                const ok = await extendCommand(
                    heart,
                    input.pluginId,
                    def.rootName,
                    {
                        kind: 'subcommand',
                        name: def.name,
                        description: def.description,
                        execute: def.execute,
                        requirements: def.requirements as RegisterRequirements | undefined,
                    },
                    { resync: def.resync },
                );
                if (!ok) {
                    throw new SdkError({
                        code: 'SDK_INVALID_REGISTRATION',
                        message: `Failed to extend /${def.rootName} with ${def.name}`,
                    });
                }
                const id = `sdk_ext_${input.runtimeId}_${def.rootName}_${def.name}`;
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `ext:${def.rootName}/${def.name}`,
                    id,
                    dispose: () => {
                        // Subcommand removal is structure-sensitive; owner purge via dispatchOwner on unload
                        interactionRegistry.chat.unregisterByOwner(owner);
                    },
                });
                return id;
            },
            registerChat(name, handler, metadata) {
                if (!name.trim()) {
                    throw new SdkError({
                        code: 'SDK_INVALID_REGISTRATION',
                        message: 'Command name required',
                    });
                }
                interactionRegistry.chat.register(
                    name,
                    async (interaction: ChatInputCommandInteraction) => {
                        await handler(interaction);
                    },
                    owner,
                    metadata ? { data: metadata } : undefined,
                );
                chatNames.add(name);
                const id = `sdk_chat_${input.runtimeId}_${input.generation}_${name}`;
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `chat:${name}`,
                    id,
                    dispose: () => {
                        interactionRegistry.chat.unregisterByOwner(owner);
                        chatNames.delete(name);
                    },
                });
                return id;
            },
            registerButton(id, handler) {
                interactionRegistry.button.register(
                    id,
                    async (interaction: ButtonInteraction) => {
                        await handler(interaction);
                    },
                    owner,
                );
                buttonIds.add(id);
                const rid = `sdk_btn_${input.runtimeId}_${input.generation}_${id}`;
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `button:${id}`,
                    id: rid,
                    dispose: () => {
                        interactionRegistry.button.unregisterByOwner(owner);
                        buttonIds.delete(id);
                    },
                });
                return rid;
            },
            registerSelect(id, handler) {
                interactionRegistry.select.register(
                    id,
                    async (interaction: AnySelectMenuInteraction) => {
                        await handler(interaction);
                    },
                    owner,
                );
                selectIds.add(id);
                const rid = `sdk_sel_${input.runtimeId}_${input.generation}_${id}`;
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `select:${id}`,
                    id: rid,
                    dispose: () => {
                        interactionRegistry.select.unregisterByOwner(owner);
                        selectIds.delete(id);
                    },
                });
                return rid;
            },
            registerModal(id, handler) {
                interactionRegistry.modal.register(
                    id,
                    async (interaction: ModalSubmitInteraction) => {
                        await handler(interaction);
                    },
                    owner,
                );
                modalIds.add(id);
                const rid = `sdk_modal_${input.runtimeId}_${input.generation}_${id}`;
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `modal:${id}`,
                    id: rid,
                    dispose: () => {
                        interactionRegistry.modal.unregisterByOwner(owner);
                        modalIds.delete(id);
                    },
                });
                return rid;
            },
            unregister(name: string): void {
                unregisterRootCommand({
                    name,
                    pluginId: input.pluginId,
                    runtimeId: input.runtimeId,
                    generation: input.generation,
                });
                interactionRegistry.chat.unregisterByOwner(owner);
                chatNames.delete(name);
                resourceRegistry.untrack(
                    input.pluginId,
                    `sdk_chat_${input.runtimeId}_${input.generation}_${name}`,
                );
                resourceRegistry.untrack(
                    input.pluginId,
                    `sdk_root_${input.runtimeId}_${input.generation}_${name}`,
                );
            },
        },
        crossHost: {
            isAvailable(): boolean {
                return getCrossHostBus().isAvailable();
            },
            machineId(): string | null {
                return getCrossHostBus().machineId();
            },
            peers(): readonly string[] {
                return getCrossHostBus().peers();
            },
            async send(options) {
                const bus = getCrossHostBus();
                if (!bus.isAvailable()) {
                    throw new SdkError({
                        code: 'CROSSHOST_UNAVAILABLE',
                        message: 'CrossHost is not available',
                    });
                }
                try {
                    assertSdkLogicalChannel(options.channel);
                } catch (err) {
                    const code =
                        err instanceof Error && 'code' in err
                            ? String((err as { code: string }).code)
                            : 'CROSSHOST_CHANNEL_INVALID';
                    throw new SdkError({
                        code,
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                const physical = physicalPluginChannel(input.pluginId, options.channel);
                try {
                    const encoded = encodeMessage(options.payload);
                    if (encoded.byteLength > PLUGIN_BUS_MAX_PAYLOAD_BYTES) {
                        throw new SdkError({
                            code: 'CROSSHOST_PAYLOAD_TOO_LARGE',
                            message: `Payload exceeds ${PLUGIN_BUS_MAX_PAYLOAD_BYTES} bytes`,
                            details: { size: encoded.byteLength },
                        });
                    }
                } catch (err) {
                    if (err instanceof SdkError) throw err;
                    throw new SdkError({
                        code: 'CROSSHOST_TRANSPORT',
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                const trackingId = resolveTrackingId(options.trackingId);
                await runWithTrackingContextAsync(
                    {
                        trackingId,
                        pluginId: input.pluginId,
                        runtimeId: input.runtimeId,
                        generation: input.generation,
                        machineId: bus.machineId() ?? undefined,
                    },
                    () => bus.send(options.target, physical, options.payload),
                );
            },
            async request<T = unknown>(options: {
                target: string;
                channel: string;
                payload: unknown;
                timeoutMs?: number;
                trackingId?: string;
            }): Promise<T> {
                const bus = getCrossHostBus();
                if (!bus.isAvailable()) {
                    throw new SdkError({
                        code: 'CROSSHOST_UNAVAILABLE',
                        message: 'CrossHost is not available',
                    });
                }
                if (options.target === '*') {
                    throw new SdkError({
                        code: 'CROSSHOST_FORBIDDEN',
                        message: 'request() does not allow wildcard target',
                    });
                }
                try {
                    assertSdkLogicalChannel(options.channel);
                } catch (err) {
                    const code =
                        err instanceof Error && 'code' in err
                            ? String((err as { code: string }).code)
                            : 'CROSSHOST_CHANNEL_INVALID';
                    throw new SdkError({
                        code,
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                if (crossHostPending.size >= 128) {
                    throw new SdkError({
                        code: 'CROSSHOST_REQUEST_LIMIT',
                        message: 'Per-session pending CrossHost request limit exceeded',
                        details: { limit: 128 },
                    });
                }
                const physical = physicalPluginChannel(input.pluginId, options.channel);
                let timeout = options.timeoutMs ?? PLUGIN_BUS_DEFAULT_TIMEOUT_MS;
                if (!Number.isFinite(timeout)) timeout = PLUGIN_BUS_DEFAULT_TIMEOUT_MS;
                timeout = Math.min(
                    PLUGIN_BUS_MAX_TIMEOUT_MS,
                    Math.max(PLUGIN_BUS_MIN_TIMEOUT_MS, Math.floor(timeout)),
                );
                const trackingId = resolveTrackingId(options.trackingId);
                try {
                    const encoded = encodeMessage(options.payload);
                    if (encoded.byteLength > PLUGIN_BUS_MAX_PAYLOAD_BYTES) {
                        throw new SdkError({
                            code: 'CROSSHOST_PAYLOAD_TOO_LARGE',
                            message: `Payload exceeds ${PLUGIN_BUS_MAX_PAYLOAD_BYTES} bytes`,
                        });
                    }
                } catch (err) {
                    if (err instanceof SdkError) throw err;
                    throw new SdkError({
                        code: 'CROSSHOST_TRANSPORT',
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                crossHostPendingSeq += 1;
                const slotId = `slot-${crossHostPendingSeq}`;
                crossHostPending.set(slotId, true);
                try {
                    return await runWithTrackingContextAsync(
                        {
                            trackingId,
                            pluginId: input.pluginId,
                            runtimeId: input.runtimeId,
                            generation: input.generation,
                            machineId: bus.machineId() ?? undefined,
                        },
                        () =>
                            bus.request<T>(
                                options.target,
                                physical,
                                options.payload,
                                timeout,
                            ),
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('timeout')) {
                        throw new SdkError({
                            code: 'CROSSHOST_TIMEOUT',
                            message: msg,
                        });
                    }
                    if (err instanceof SdkError) throw err;
                    throw new SdkError({
                        code: 'CROSSHOST_TRANSPORT',
                        message: msg,
                    });
                } finally {
                    crossHostPending.delete(slotId);
                }
            },
            on(channel, userHandler) {
                const bus = getCrossHostBus();
                if (!bus.isAvailable()) {
                    throw new SdkError({
                        code: 'CROSSHOST_UNAVAILABLE',
                        message: 'CrossHost is not available',
                    });
                }
                try {
                    assertSdkLogicalChannel(channel);
                } catch (err) {
                    const code =
                        err instanceof Error && 'code' in err
                            ? String((err as { code: string }).code)
                            : 'CROSSHOST_CHANNEL_INVALID';
                    throw new SdkError({
                        code,
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
                const physical = physicalPluginChannel(input.pluginId, channel);
                const gen = input.generation;
                const rid = input.runtimeId;
                const pid = input.pluginId;
                const wrapped: PluginBusHandler = async (payload, meta) => {
                    // Stale generation: do not invoke
                    const live = getCrossHostBus();
                    if (!live.isAvailable()) return undefined;
                    // session identity is closed over; unload removes this handler
                    const parsed = parsePhysicalPluginChannel(meta.channel);
                    if (!parsed || parsed.pluginId !== pid) return undefined;
                    return userHandler(payload, {
                        fromMachineId: meta.fromMachineId,
                        channel: parsed.logicalChannel,
                        requestId: meta.requestId,
                        trackingId: meta.trackingId,
                        messageId: meta.messageId,
                    });
                };
                const key = `${physical}::${crossHostHandlers.size}::${Date.now()}`;
                const resourceId = `sdk_ch_${rid}_${gen}_${channel}_${key.slice(-8)}`;
                crossHostHandlers.set(key, {
                    logical: channel,
                    physical,
                    handler: wrapped,
                    userHandler,
                    resourceId,
                });
                bus.on(physical, wrapped);
                resourceRegistry.track({
                    pluginId: pid,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `crosshost:${channel}`,
                    id: resourceId,
                    dispose: () => {
                        bus.off(physical, wrapped);
                        crossHostHandlers.delete(key);
                    },
                });
                let active = true;
                return () => {
                    if (!active) return;
                    active = false;
                    bus.off(physical, wrapped);
                    crossHostHandlers.delete(key);
                    try {
                        resourceRegistry.untrack(pid, resourceId);
                    } catch {
                        /* ignore */
                    }
                };
            },
            off(channel, userHandler) {
                const bus = getCrossHostBus();
                for (const [key, entry] of [...crossHostHandlers.entries()]) {
                    if (entry.logical !== channel) continue;
                    if (userHandler && entry.userHandler !== userHandler) continue;
                    bus.off(entry.physical, entry.handler);
                    crossHostHandlers.delete(key);
                    try {
                        resourceRegistry.untrack(input.pluginId, entry.resourceId);
                    } catch {
                        /* ignore */
                    }
                }
            },
        },
        scheduler: {
            async every(name, options, handler) {
                const taskName = `sdk:${input.pluginId}:${input.runtimeId}:${input.generation}:${name}`;
                await scheduler.every(taskName, options, handler);
                scheduledTasks.add(taskName);
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `sched:${name}`,
                    id: `sdk_sched_${input.runtimeId}_${input.generation}_${name}`,
                    dispose: () => {
                        void scheduler.removeTask(taskName);
                        scheduledTasks.delete(taskName);
                    },
                });
                return { name: taskName };
            },
            async cron(name, expression, handler) {
                const taskName = `sdk:${input.pluginId}:${input.runtimeId}:${input.generation}:${name}`;
                await scheduler.cron(taskName, expression, handler);
                scheduledTasks.add(taskName);
                resourceRegistry.track({
                    pluginId: input.pluginId,
                    kind: 'custom',
                    releaseOn: 'unload',
                    label: `sched-cron:${name}`,
                    id: `sdk_sched_${input.runtimeId}_${input.generation}_${name}`,
                    dispose: () => {
                        void scheduler.removeTask(taskName);
                        scheduledTasks.delete(taskName);
                    },
                });
                return { name: taskName };
            },
            async cancel(name) {
                const prefix = `sdk:${input.pluginId}:${input.runtimeId}:${input.generation}:`;
                const taskName = name.startsWith(prefix)
                    ? name
                    : name.startsWith('sdk:')
                      ? name
                      : `${prefix}${name}`;
                if (!taskName.startsWith(prefix)) {
                    throw new SdkError({
                        code: 'SDK_OPERATION_DENIED',
                        message:
                            'Cannot cancel tasks outside this plugin runtime generation',
                    });
                }
                await scheduler.removeTask(taskName);
                scheduledTasks.delete(taskName);
            },
        },
        cooldowns: {
            define(slug, limit, windowSeconds) {
                const owned = `sdk:${input.pluginId}:${input.runtimeId}:${input.generation}:${slug}`;
                cooldownManager.define(owned, limit, windowSeconds);
                cooldownSlugs.add(owned);
            },
            async isRateLimited(slug, ctx) {
                const ownedPrefix = `sdk:${input.pluginId}:${input.runtimeId}:${input.generation}:`;
                const owned = slug.startsWith(ownedPrefix)
                    ? slug
                    : `${ownedPrefix}${slug}`;
                if (!owned.startsWith(ownedPrefix)) {
                    throw new SdkError({
                        code: 'SDK_OPERATION_DENIED',
                        message: 'Cannot access cooldown buckets outside this runtime generation',
                    });
                }
                const coreCtx = {
                    userId: ctx.userId ?? 'anonymous',
                    commandId: ctx.commandId ?? ctx.key ?? slug,
                    guildId: ctx.guildId,
                };
                const result = await cooldownManager.isRateLimited(owned, coreCtx);
                return {
                    limited: result.limited,
                    remaining: result.remaining,
                };
            },
            async refund(slug, ctx) {
                const ownedPrefix = `sdk:${input.pluginId}:${input.runtimeId}:${input.generation}:`;
                const owned = slug.startsWith(ownedPrefix)
                    ? slug
                    : `${ownedPrefix}${slug}`;
                if (!owned.startsWith(ownedPrefix)) {
                    throw new SdkError({
                        code: 'SDK_OPERATION_DENIED',
                        message: 'Cannot refund cooldown buckets outside this runtime generation',
                    });
                }
                const coreCtx = {
                    userId: ctx.userId ?? 'anonymous',
                    commandId: ctx.commandId ?? ctx.key ?? slug,
                    guildId: ctx.guildId,
                };
                await cooldownManager.refund(owned, coreCtx);
            },
        },
        permissions: {
            async hasBit(userId, bit, guildId) {
                const { manager } = getHeartPermissions();
                if (!manager) {
                    throw new SdkError({
                        code: 'SDK_RUNTIME_UNAVAILABLE',
                        message: 'Permissions subsystem not initialized',
                    });
                }
                return manager.hasBit(userId, bit, guildId);
            },
            async requireBit(userId, bit, guildId) {
                const { manager } = getHeartPermissions();
                if (!manager) {
                    throw new SdkError({
                        code: 'SDK_RUNTIME_UNAVAILABLE',
                        message: 'Permissions subsystem not initialized',
                    });
                }
                const ok = await manager.hasBit(userId, bit, guildId);
                if (!ok) {
                    throw new SdkError({
                        code: 'SDK_PERMISSION_DENIED',
                        message: `Missing permission bit '${bit}'`,
                        details: { bit },
                    });
                }
            },
        },
        features: {
            register(feature) {
                featureRequirements.register({
                    id: feature.id,
                    pluginId: input.pluginId,
                    description: feature.description,
                    intents: feature.intents as never,
                    softDisabled: feature.softDisabled,
                });
                featureIds.add(feature.id);
            },
        },
        locale: {
            t(namespace, key, variables) {
                return i18n.get(
                    namespace,
                    key,
                    variables as never,
                );
            },
        },
        emoji: {
            get(key) {
                return emojis.get(key);
            },
            parse(text) {
                return emojis.parse(text);
            },
        },
        cache: {
            get(key) {
                return pluginCacheNs.get(key);
            },
            set(key, value, ttlMs) {
                return pluginCacheNs.set(key, value, ttlMs);
            },
            delete(key) {
                return pluginCacheNs.delete(key);
            },
        },
        diagnostics: {
            increment(name, value = 1) {
                log.info(`metric.increment ${name}=${value}`, {
                    metric: name,
                    value,
                    pluginId: input.pluginId,
                    runtimeId: input.runtimeId,
                    generation: input.generation,
                });
            },
            timing(name, durationMs) {
                log.info(`metric.timing ${name}=${durationMs}ms`, {
                    metric: name,
                    durationMs,
                    pluginId: input.pluginId,
                    runtimeId: input.runtimeId,
                    generation: input.generation,
                });
            },
        },
        guild: {
            resolveName(guildId) {
                const client = getHeartClient();
                return client?.guilds.cache.get(guildId)?.name;
            },
        },
    };

    registerSdkBridge(input.pluginId, bridge);

    resourceRegistry.track({
        pluginId: input.pluginId,
        kind: 'custom',
        releaseOn: 'unload',
        label: `sdk-bridge:${owner}`,
        id: `sdk_bridge_${input.runtimeId}_${input.generation}`,
        dispose: () => {
            eventBus.unregisterByOwner(owner);
            for (const off of unsubs) {
                try {
                    off();
                } catch {
                    /* ignore */
                }
            }
            unsubs.length = 0;
            interactionRegistry.chat.unregisterByOwner(owner);
            interactionRegistry.button.unregisterByOwner(owner);
            interactionRegistry.select.unregisterByOwner(owner);
            interactionRegistry.modal.unregisterByOwner(owner);
            interactionRegistry.autocomplete.unregisterByOwner(owner);
            for (const rootName of rootNames) {
                unregisterRootCommand({
                    name: rootName,
                    pluginId: input.pluginId,
                    runtimeId: input.runtimeId,
                    generation: input.generation,
                });
            }
            rootNames.clear();
            chatNames.clear();
            buttonIds.clear();
            selectIds.clear();
            modalIds.clear();
            for (const base of routeBases) {
                try {
                    httpServer.unregisterRouter(base);
                } catch {
                    /* ignore */
                }
            }
            routeBases.clear();
            for (const pk of providerKeys) {
                try {
                    providerRegistry.unregister(
                        pk.category as ProviderCategoryId,
                        pk.id,
                    );
                } catch {
                    /* ignore */
                }
            }
            providerKeys.length = 0;
            invalidateBindingsForRuntime(input.runtimeId);
            for (const task of [...scheduledTasks]) {
                try {
                    void scheduler.removeTask(task);
                } catch {
                    /* ignore */
                }
            }
            scheduledTasks.clear();
        },
    });

    return bridge;
}

export function uninstallPluginSdkBridge(
    pluginId: string,
    runtimeId?: string,
    generation?: number,
): void {
    let bridge: SdkBridge | undefined;
    try {
        bridge = getSdkBridge(pluginId, runtimeId, generation);
    } catch (err: unknown) {
        // Ambiguous multi-session lookup must not bulk-destroy generations
        if (
            err instanceof SdkError &&
            err.code === 'SDK_BRIDGE_AMBIGUOUS' &&
            generation === undefined
        ) {
            throw err;
        }
        bridge = undefined;
    }

    if (runtimeId && bridge && bridge.session.runtimeId !== runtimeId) {
        return;
    }
    if (generation !== undefined && bridge && bridge.session.generation !== generation) {
        return;
    }

    const rid = runtimeId ?? bridge?.session.runtimeId;
    const gen = generation ?? bridge?.session.generation;
    // Without a concrete generation, refuse runtime-wide resource wipe
    if (rid !== undefined && gen === undefined) {
        throw new SdkError({
            code: 'SDK_BRIDGE_AMBIGUOUS',
            message:
                'uninstallPluginSdkBridge requires generation when multiple sessions may exist for a runtime',
            details: { pluginId, runtimeId: rid },
        });
    }
    if (rid) {
        try {
            const list = resourceRegistry.list(pluginId);
            const isOwnedResource = (id: string): boolean => {
                if (gen !== undefined) {
                    if (id === `sdk_bridge_${rid}_${gen}`) return true;
                    const prefixes = [
                        `sdk_http_${rid}_${gen}_`,
                        `sdk_chat_${rid}_${gen}_`,
                        `sdk_btn_${rid}_${gen}_`,
                        `sdk_sel_${rid}_${gen}_`,
                        `sdk_modal_${rid}_${gen}_`,
                        `sdk_dash_${rid}_${gen}_`,
                        `sdk_sched_${rid}_${gen}_`,
                        `sdk_root_${rid}_${gen}_`,
                        `sdk_cmd_${rid}_${gen}_`,
                        `sdk_ch_${rid}_${gen}_`,
                    ];
                    return prefixes.some((pre) => id.startsWith(pre));
                }
                return false;
            };
            for (const h of list) {
                if (isOwnedResource(h.id)) {
                    try {
                        void Promise.resolve(h.dispose());
                    } catch {
                        /* ignore */
                    }
                    resourceRegistry.untrack(pluginId, h.id);
                }
            }
        } catch {
            /* ignore */
        }
        invalidateBindingsForRuntime(rid);
        if (bridge) {
            const owner = ownerKey(
                pluginId,
                bridge.session.runtimeId,
                bridge.session.generation,
            );
            eventBus.unregisterByOwner(owner);
            interactionRegistry.chat.unregisterByOwner(owner);
            interactionRegistry.button.unregisterByOwner(owner);
            interactionRegistry.select.unregisterByOwner(owner);
            interactionRegistry.modal.unregisterByOwner(owner);
        }
    }

    revokeAllForPlugin(pluginId, runtimeId, generation);
    clearSdkBridge(pluginId, runtimeId, generation);
    // Only drop data types when no remaining sessions for this plugin
    try {
        getSdkBridge(pluginId);
    } catch {
        dataRegistry.unregisterPlugin(pluginId);
    }
}
