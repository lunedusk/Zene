/**
 * Controlled Core bridge — sole path from public SDK into Core authority.
 */

import type {
    SdkSessionContext,
    SdkRuntimeRequirements,
    SdkDependencyDeclaration,
} from './types.js';
import { SdkError } from './types.js';
import type { Router } from 'express';
import type {
    ChatInputCommandInteraction,
    ButtonInteraction,
    AnySelectMenuInteraction,
    ModalSubmitInteraction,
} from 'discord.js';

export type BridgeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SdkBridgeLog {
    (level: BridgeLogLevel, message: string, meta?: Readonly<Record<string, unknown>>): void;
}

export interface SdkBridgeConfig {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    has(key: string): boolean;
    getRaw<T = unknown>(): Promise<T | undefined>;
}

export interface SdkBridgeEventBus {
    emit(event: string, ...args: unknown[]): Promise<void>;
    on(event: string, handler: (...args: unknown[]) => void | Promise<void>): () => void;
    once(event: string, handler: (...args: unknown[]) => void | Promise<void>): () => void;
}

export interface SdkBridgeProvider {
    select<T>(category: string): T | undefined;
    register(declaration: {
        category: string;
        id: string;
        version: string;
        priority: number;
        implementation: unknown;
        capabilities?: readonly string[];
        available?: boolean;
    }): string;
}

export interface SdkBridgeResource {
    track(input: {
        kind: string;
        label?: string;
        releaseOn: 'disable' | 'unload';
        dispose: () => void | Promise<void>;
    }): string;
    untrack(resourceId: string): void;
}

export interface SdkBridgeData {
    registerType(definition: {
        id: string;
        schema?: unknown;
        scope: import('./types.js').DataScope;
        personalData: boolean;
        privacyClass: import('./types.js').PrivacyClass;
        retention?: string;
        storage?: {
            engine: 'memory' | 'sqlite' | 'postgres' | 'mongo' | 'surreal' | 'redis';
            alias?: string;
            requireDurable?: boolean;
            requireSubjectDelete?: boolean;
        };
    }): void;
    access(
        typeId: string,
        subject: { userId?: string; guildId?: string; pluginId?: string },
        query?: { readonly key?: string },
    ): Promise<readonly unknown[]>;
    write(
        typeId: string,
        key: string,
        subject: { userId?: string; guildId?: string; pluginId?: string },
        value: unknown,
    ): Promise<void>;
    export(
        typeId: string,
        subject: { userId?: string; guildId?: string; pluginId?: string },
    ): Promise<{ typeId: string; records: readonly unknown[]; exportedAt: number }>;
    delete(
        typeId: string,
        subject: { userId?: string; guildId?: string; pluginId?: string },
    ): Promise<number>;
}

/** Plugin registration input — ownership is session-derived, never caller-controlled. */
export interface SdkDashboardContributionInput {
    readonly contributionId: string;
    readonly kind: string;
    readonly scope: string;
    readonly title: string;
    readonly route?: string;
    readonly apiPath?: string;
    readonly permissionBits?: readonly string[];
    readonly capability?: string;
    readonly order?: number;
    readonly payload?: Readonly<Record<string, unknown>>;
}

/** Public list DTO with host-authored ownership. */
export interface SdkDashboardContributionView extends SdkDashboardContributionInput {
    readonly pluginId: string;
    readonly runtimeId: string;
    readonly generation: number;
}

export interface SdkBridgeDashboard {
    contribute(contribution: SdkDashboardContributionInput): string;
    revoke(contributionId: string): void;
    list(): readonly SdkDashboardContributionView[];
}

export interface SdkBridgeHttp {
    registerRouter(basePath: string, router: Router): void;
    unregisterRouter(basePath: string): void;
    listMounts(): readonly string[];
}

export interface SdkRootCommandRegistration {
    readonly name: string;
    readonly description: string;
    /** Optional builder mutation for options/subcommands. */
    readonly build?: (builder: import('discord.js').SlashCommandBuilder) => void;
    readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    readonly autocomplete?: (
        interaction: import('discord.js').AutocompleteInteraction,
    ) => Promise<void>;
    readonly requirements?: import('./types.js').SdkCommandRequirements;
    readonly resync?: boolean;
}

export interface SdkCommandExtension {
    readonly rootName: string;
    readonly name: string;
    readonly description: string;
    readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    readonly requirements?: import('./types.js').SdkCommandRequirements;
    readonly resync?: boolean;
}

export interface SdkBridgeCommands {
    /**
     * Register a root application command through Core commandRegistry + InteractionRegistry.
     */
    registerRoot(def: SdkRootCommandRegistration): Promise<string>;
    /**
     * Extend an existing root with a subcommand through Core extendCommand.
     */
    extendRoot(def: SdkCommandExtension): Promise<string>;
    registerChat(
        name: string,
        handler: (interaction: ChatInputCommandInteraction) => Promise<void>,
        metadata?: { description?: string },
    ): string;
    registerButton(
        id: string,
        handler: (interaction: ButtonInteraction) => Promise<void>,
    ): string;
    registerSelect(
        id: string,
        handler: (interaction: AnySelectMenuInteraction) => Promise<void>,
    ): string;
    registerModal(
        id: string,
        handler: (interaction: ModalSubmitInteraction) => Promise<void>,
    ): string;
    unregister(name: string): void;
}

export interface SdkCrossHostMeta {
    readonly fromMachineId: string;
    readonly channel: string;
    readonly requestId?: string;
    readonly trackingId?: string;
    readonly messageId?: string;
}

export type SdkCrossHostHandler = (
    payload: unknown,
    meta: SdkCrossHostMeta,
) => unknown | Promise<unknown>;

export interface SdkBridgeCrossHost {
    isAvailable(): boolean;
    machineId(): string | null;
    peers(): readonly string[];
    send(options: {
        target: string;
        channel: string;
        payload: unknown;
        trackingId?: string;
    }): Promise<void>;
    request<T = unknown>(options: {
        target: string;
        channel: string;
        payload: unknown;
        timeoutMs?: number;
        trackingId?: string;
    }): Promise<T>;
    on(channel: string, handler: SdkCrossHostHandler): () => void;
    off(channel: string, handler?: SdkCrossHostHandler): void;
}

export interface SdkBridgeScheduler {
    every(
        name: string,
        options: { seconds?: number; minutes?: number; hours?: number },
        handler: () => void | Promise<void>,
    ): Promise<{ name: string }>;
    cron(
        name: string,
        expression: string,
        handler: () => void | Promise<void>,
    ): Promise<{ name: string }>;
    cancel(name: string): Promise<void>;
}

export interface SdkBridgeCooldowns {
    define(slug: string, limit: number, windowSeconds: number): void;
    isRateLimited(
        slug: string,
        ctx: {
            userId?: string;
            guildId?: string;
            channelId?: string;
            commandId?: string;
            key?: string;
        },
    ): Promise<{ limited: boolean; remaining: number }>;
    refund(
        slug: string,
        ctx: {
            userId?: string;
            guildId?: string;
            channelId?: string;
            commandId?: string;
            key?: string;
        },
    ): Promise<void>;
}

export interface SdkBridgePermissions {
    hasBit(userId: string, bit: string, guildId?: string): Promise<boolean>;
    requireBit(userId: string, bit: string, guildId?: string): Promise<void>;
}

export interface SdkBridgeFeatures {
    register(feature: {
        id: string;
        description?: string;
        intents?: readonly string[];
        softDisabled?: boolean;
    }): void;
}

export interface SdkBridgeLocale {
    t(
        namespace: string,
        key: string,
        variables?: Readonly<Record<string, string | number>>,
    ): string;
}

export interface SdkBridgeEmoji {
    get(key: string): string | null;
    parse(text: string): string;
}

export interface SdkBridgeCache {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
}

export interface SdkBridgeDiagnostics {
    increment(name: string, value?: number): void;
    timing(name: string, durationMs: number): void;
}

export interface SdkBridgeGuild {
    resolveName(guildId: string): string | undefined;
}

export interface SdkBridge {
    readonly session: SdkSessionContext;
    readonly log: SdkBridgeLog;
    readonly config: SdkBridgeConfig;
    readonly events: SdkBridgeEventBus;
    readonly providers: SdkBridgeProvider;
    readonly resources: SdkBridgeResource;
    readonly data: SdkBridgeData;
    readonly dashboard: SdkBridgeDashboard;
    readonly http: SdkBridgeHttp;
    readonly commands: SdkBridgeCommands;
    readonly crossHost: SdkBridgeCrossHost;
    readonly scheduler: SdkBridgeScheduler;
    readonly cooldowns: SdkBridgeCooldowns;
    readonly permissions: SdkBridgePermissions;
    readonly features: SdkBridgeFeatures;
    readonly locale: SdkBridgeLocale;
    readonly emoji: SdkBridgeEmoji;
    readonly cache: SdkBridgeCache;
    readonly diagnostics: SdkBridgeDiagnostics;
    readonly guild: SdkBridgeGuild;
    readonly runtimeRequirements: SdkRuntimeRequirements;
    readonly dependencies: readonly SdkDependencyDeclaration[];
}

/** Key: pluginId::runtimeId::generation — generations never overwrite each other. */
const bridges = new Map<string, SdkBridge>();

export function sdkBridgeKey(
    pluginId: string,
    runtimeId: string,
    generation: number,
): string {
    return `${pluginId}::${runtimeId}::${generation}`;
}

export function registerSdkBridge(pluginId: string, bridge: SdkBridge): void {
    if (!bridge.session.authorized) {
        throw new SdkError({
            code: 'SDK_BRIDGE_UNAUTHORIZED',
            message: `Cannot install SDK bridge for unauthorized plugin '${pluginId}'`,
            details: { trustOutcome: bridge.session.trustOutcome },
        });
    }
    if (bridge.session.pluginId !== pluginId) {
        throw new SdkError({
            code: 'SDK_BRIDGE_IDENTITY_MISMATCH',
            message: 'Bridge session pluginId must match registration key',
        });
    }
    const key = sdkBridgeKey(
        pluginId,
        bridge.session.runtimeId,
        bridge.session.generation,
    );
    bridges.set(key, bridge);
}

/**
 * Resolve a session-bound bridge.
 * Production callers MUST supply runtimeId + generation.
 * pluginId-only lookup is allowed only when exactly one session is registered
 * for that plugin (host/test convenience); multiple sessions → deterministic error.
 */
export function getSdkBridge(
    pluginId: string,
    runtimeId?: string,
    generation?: number,
): SdkBridge {
    if (runtimeId !== undefined && generation !== undefined) {
        const b = bridges.get(sdkBridgeKey(pluginId, runtimeId, generation));
        if (!b) {
            throw new SdkError({
                code: 'SDK_BRIDGE_MISSING',
                message: `No SDK bridge for plugin '${pluginId}' runtime '${runtimeId}' generation ${generation}`,
            });
        }
        return b;
    }
    const matches: SdkBridge[] = [];
    for (const [key, b] of bridges) {
        if (!(key.startsWith(`${pluginId}::`) || key === pluginId)) continue;
        if (runtimeId !== undefined && b.session.runtimeId !== runtimeId) continue;
        if (generation !== undefined && b.session.generation !== generation) continue;
        matches.push(b);
    }
    if (matches.length === 0) {
        throw new SdkError({
            code: 'SDK_BRIDGE_MISSING',
            message: `No SDK bridge registered for plugin '${pluginId}' (unloaded or never authorized)`,
        });
    }
    if (matches.length > 1) {
        // details values must be string | number | boolean
        const sessionList = matches
            .map((m) => `${m.session.runtimeId}#${m.session.generation}`)
            .join(',');
        throw new SdkError({
            code: 'SDK_BRIDGE_AMBIGUOUS',
            message: `Multiple SDK sessions exist for plugin '${pluginId}'; specify runtimeId and generation`,
            details: {
                sessionCount: matches.length,
                sessions: sessionList,
            },
        });
    }
    return matches[0]!;
}

export function clearSdkBridge(
    pluginId: string,
    runtimeId?: string,
    generation?: number,
): void {
    if (runtimeId !== undefined && generation !== undefined) {
        bridges.delete(sdkBridgeKey(pluginId, runtimeId, generation));
        return;
    }
    if (runtimeId !== undefined) {
        for (const key of [...bridges.keys()]) {
            if (key.startsWith(`${pluginId}::${runtimeId}::`)) {
                bridges.delete(key);
            }
        }
        return;
    }
    for (const key of [...bridges.keys()]) {
        if (key.startsWith(`${pluginId}::`) || key === pluginId) {
            bridges.delete(key);
        }
    }
}

export function assertBridgeAuthorized(bridge: SdkBridge, operation: string): void {
    if (!bridge.session.authorized) {
        throw new SdkError({
            code: 'SDK_OPERATION_DENIED',
            message: `SDK operation '${operation}' denied: session not authorized`,
            details: { trustOutcome: bridge.session.trustOutcome },
        });
    }
}

export function assertBridgeGeneration(
    bridge: SdkBridge,
    runtimeId: string,
    generation: number,
): void {
    if (
        bridge.session.runtimeId !== runtimeId ||
        bridge.session.generation !== generation
    ) {
        throw new SdkError({
            code: 'SDK_STALE_GENERATION',
            message: `Stale SDK generation for plugin '${bridge.session.pluginId}'`,
            details: {
                expectedRuntimeId: runtimeId,
                expectedGeneration: generation,
            },
        });
    }
}
