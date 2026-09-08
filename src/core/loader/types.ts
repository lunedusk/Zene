import type { BasePlugin, PluginManifest } from '#core/bases/Plugin.js';

export interface DiscoveredPlugin {
    dir: string;
    manifest: PluginManifest;
}

export interface PreloadedPlugin extends DiscoveredPlugin {
    PluginClass: new () => BasePlugin;
}

export enum PluginBootStatus {
    Pending = 'PENDING',
    Preloaded = 'PRELOADED',
    Success = 'SUCCESS',
    Failed = 'FAILED',
    Skipped = 'SKIPPED',
}

export type IntegrityStatus = 'signed' | 'unsigned' | 'failed' | 'bypassed';

export interface IntegrityGateOptions {
    readonly allowUncertified: boolean;
    readonly whitelistedSet: ReadonlySet<string>;
    readonly coreVersion: string;
    readonly resolvePublicKey: (folderName: string) => string;
}

export interface IntegrityGateResult {
    readonly manifest: PluginManifest | null;
    readonly status: IntegrityStatus | null;
    /** When true, caller should skip this plugin directory. */
    readonly rejected: boolean;
}
