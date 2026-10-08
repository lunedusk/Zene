import type { SdkVersion, SdkContractVersion } from './version.js';

export type PluginId = string;
export type ContributionId = string;
export type RuntimeGeneration = number;

export type DataScope =
    | 'user'
    | 'guild'
    | 'plugin'
    | 'server'
    | 'global'
    | 'system';

export type PrivacyClass =
    | 'public'
    | 'internal'
    | 'personal'
    | 'sensitive'
    | 'secret';

export interface PluginIdentity {
    readonly id: PluginId;
    readonly name: string;
    readonly version: string;
    readonly author?: string;
    readonly description?: string;
}

export interface SdkCapabilityRequirement {
    readonly id: string;
    readonly optional?: boolean;
}

export interface SdkRuntimeRequirements {
    readonly minimumIsolation?:
        | 'in-process'
        | 'worker'
        | 'process'
        | 'container'
        | 'external';
    readonly preferredRuntime?:
        | 'in-process'
        | 'worker'
        | 'process'
        | 'container'
        | 'external';
    readonly requiredCapabilities?: readonly string[];
    readonly allowedRuntimes?: readonly string[];
}

export type SdkDependencyKind =
    | 'plugin'
    | 'component'
    | 'provider'
    | 'runtime';

export interface SdkDependencyDeclaration {
    readonly id: string;
    readonly kind: SdkDependencyKind;
    readonly optional?: boolean;
    readonly versionRange?: string;
}

export interface SdkSessionContext {
    readonly pluginId: PluginId;
    readonly runtimeId: string;
    readonly generation: RuntimeGeneration;
    readonly sdkVersion: SdkVersion;
    readonly contractVersion?: SdkContractVersion;
    readonly trustOutcome: 'trusted' | 'bypassed' | 'legacy' | 'unknown';
    readonly authorized: boolean;
}

export interface SdkErrorBody {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export class SdkError extends Error {
    readonly code: string;
    readonly details?: Readonly<Record<string, string | number | boolean>>;
    constructor(body: SdkErrorBody) {
        super(body.message);
        this.name = 'SdkError';
        this.code = body.code;
        this.details = body.details;
    }
}

/** Opaque host-evaluated command requirements — metadata only, not authority. */
export interface SdkCommandRequirements {
    readonly mode?: 'soft' | 'strict';
    readonly crossHost?: boolean;
    readonly crossHostRole?: 'worker' | 'orchestrator';
    readonly isSharded?: boolean;
    readonly standalone?: boolean;
    readonly modes?: ReadonlyArray<'standalone' | 'sharded' | 'crosshost'>;
    readonly env?: Readonly<Record<string, string | number | boolean | null>>;
    readonly envTruthy?: readonly string[];
    readonly nodeVersion?: string;
    readonly plugins?: readonly string[];
}
