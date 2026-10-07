import type { BasePlugin, PluginManifest } from '#core/bases/Plugin.js';
import type { TrustDecision } from '#core/helpers/integrity/trustDecision.js';

export interface DiscoveredPlugin {
    dir: string;
    manifest: PluginManifest;
    /** Phase 1C: explicit trust outcome (trusted | bypassed | …). */
    trust?: TrustDecision;
}

export interface PreloadedPlugin extends DiscoveredPlugin {
    /**
     * Optional: only resolved for in-process boot path.
     * Isolated plugins must not have their entrypoint imported into Core during preload.
     */
    PluginClass?: new () => BasePlugin;
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
    /** Phase 1C: trust decision (present when a conclusive outcome was reached). */
    readonly trust?: TrustDecision;
}
