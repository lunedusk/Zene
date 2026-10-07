/**
 * Phase 2B — Plugin lifecycle, resource ownership, and modification model.
 *
 * PluginState on BasePlugin remains the compatibility surface (UNLOADED/SETUP/…).
 * LifecyclePhase is the formal orchestration model used by LifecycleController.
 *
 * ESM reality: "unload" is logical (registries + resources released). Node does not
 * guarantee V8 module-record reclamation after dynamic import cache-busting.
 */

/** Formal lifecycle phases for orchestration (deterministic transitions). */
export type LifecyclePhase =
    | 'unloaded'
    | 'loading'
    | 'loaded'
    | 'enabling'
    | 'enabled'
    | 'disabling'
    | 'disabled'
    | 'unloading'
    | 'failed';

export type LifecycleOperation =
    | 'load'
    | 'enable'
    | 'disable'
    | 'unload'
    | 'reload';

/** Resource categories that exist in current Zene (plugin-owned, not resident core). */
export type ResourceKind =
    | 'event-subscription'
    | 'http-route'
    | 'interaction'
    | 'handler'
    | 'provider-registration'
    | 'timer'
    | 'custom';

export interface ResourceHandle {
    readonly id: string;
    readonly kind: ResourceKind;
    readonly pluginId: string;
    /** When to release: disable-time vs only on full unload. */
    readonly releaseOn: 'disable' | 'unload';
    readonly dispose: () => void | Promise<void>;
    readonly label?: string;
}

export interface CleanupFailure {
    readonly resourceId: string;
    readonly kind: ResourceKind;
    readonly message: string;
}

export interface CleanupReport {
    readonly pluginId: string;
    readonly attempted: number;
    readonly succeeded: number;
    readonly failures: readonly CleanupFailure[];
}

/**
 * Modification axes — extension ≠ replacement ≠ physical source mutation.
 * Defaults deny sensitive physical mutation.
 */
export interface ModificationPolicy {
    readonly extensionAllowed: boolean;
    readonly replacementAllowed: boolean;
    /** Changing files under a signed plugin tree. Default false. */
    readonly sourceMutationAllowed: boolean;
    /** Mutation of integrity-critical paths (manifest, signed payload). Default false. */
    readonly sensitivePathMutationAllowed: boolean;
}

export const DEFAULT_MODIFICATION_POLICY: Readonly<ModificationPolicy> = Object.freeze({
    /** Phase 2E: extension only via explicit registered extension points. */
    extensionAllowed: false,
    /** Phase 2E: no generic Core replacement. */
    replacementAllowed: false,
    sourceMutationAllowed: false,
    sensitivePathMutationAllowed: false,
});

export type ArtifactIntegrityState =
    | 'valid'
    | 'unknown'
    | 'invalidated-by-mutation'
    | 'failed-verification';

export interface LifecycleTransitionError {
    readonly pluginId: string;
    readonly from: LifecyclePhase;
    readonly operation: LifecycleOperation;
    readonly message: string;
}
