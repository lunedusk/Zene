/**
 * Controlled host bridge contract — plugin-facing types only.
 * Host (Core) constructs and injects an authorized implementation.
 * There is no global mutable registry in the published package.
 */

import type {
    SdkSessionContext,
    SdkRuntimeRequirements,
    SdkDependencyDeclaration,
} from './types.js';
import { SdkError } from './types.js';
import type { SdkBridgeHttp } from './http.js';
import type {
    SdkBridgeScheduler,
    SdkBridgeCooldowns,
    SdkBridgePermissions,
    SdkBridgeFeatures,
    SdkBridgeLocale,
    SdkBridgeEmoji,
    SdkBridgeCache,
    SdkBridgeDiagnostics,
    SdkBridgeGuild,
} from './domains.js';

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
        query?: unknown,
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

/** Plugin registration input — no ownership fields. */
export interface SdkDashboardContributionRegistration {
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

/** Host-authored list/read DTO. */
export interface SdkDashboardContributionView extends SdkDashboardContributionRegistration {
    readonly pluginId: string;
    readonly runtimeId: string;
    readonly generation: number;
}

/** @deprecated Prefer SdkDashboardContributionRegistration */
export type SdkDashboardContributionInput = SdkDashboardContributionRegistration;

export interface SdkBridgeDashboard {
    contribute(contribution: SdkDashboardContributionRegistration): string;
    revoke(contributionId: string): void;
    list(): readonly SdkDashboardContributionView[];
}

export interface SdkBridgeCommands {
    registerRoot(def: unknown): Promise<string>;
    extendRoot(def: unknown): Promise<string>;
    registerChat(
        name: string,
        handler: (...args: never[]) => Promise<void>,
        metadata?: { description?: string },
    ): string;
    registerButton(id: string, handler: (...args: never[]) => Promise<void>): string;
    registerSelect(id: string, handler: (...args: never[]) => Promise<void>): string;
    registerModal(id: string, handler: (...args: never[]) => Promise<void>): string;
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

/**
 * Host-constructed capability surface for one authorized plugin runtime generation.
 * Plugins receive this via createPluginSdk(identity, bridge) — they never install it.
 */
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
