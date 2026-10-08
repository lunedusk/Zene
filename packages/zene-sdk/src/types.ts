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

export type SdkIsolationLevel =
    | 'in-process'
    | 'worker'
    | 'process'
    | 'container'
    | 'external';

export interface SdkRuntimeRequirements {
    readonly minimumIsolation?: SdkIsolationLevel;
    readonly preferredRuntime?: SdkIsolationLevel;
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

export type SdkTrustOutcome = 'trusted' | 'bypassed' | 'legacy' | 'unknown';

export interface SdkSessionContext {
    readonly pluginId: PluginId;
    readonly runtimeId: string;
    readonly generation: RuntimeGeneration;
    readonly sdkVersion: SdkVersion;
    /** Capability contract generation the bridge was installed for. */
    readonly contractVersion?: SdkContractVersion;
    readonly trustOutcome: SdkTrustOutcome;
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
