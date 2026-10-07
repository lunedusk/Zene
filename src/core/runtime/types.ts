/**
 * Phase 2D — Plugin execution runtime isolation model.
 *
 * Trust (Phase 1) and capability authority are separate.
 * In-process never claims native ESM module-graph deletion.
 */

/** Isolation strength — ordered for comparison (higher = stronger). */
export type IsolationLevel =
    | 'in-process'
    | 'worker'
    | 'process'
    | 'container'
    | 'external';

export const ISOLATION_RANK: Readonly<Record<IsolationLevel, number>> = {
    'in-process': 1,
    worker: 2,
    process: 3,
    container: 4,
    external: 5,
};

export type RuntimeHealth =
    | 'starting'
    | 'ready'
    | 'degraded'
    | 'unresponsive'
    | 'stopping'
    | 'stopped'
    | 'failed';

/**
 * Plugin / deployment runtime policy.
 * Preference ≠ minimum requirement ≠ allowed set.
 * Runtime-only today; signed runtime fields remain TARGET.
 */
export interface RuntimePolicy {
    /** Preferred isolation when available. */
    readonly preferred: IsolationLevel;
    /**
     * Hard floor. Selection MUST NOT choose below this rank,
     * even if preferred is unavailable and weaker runtimes exist.
     */
    readonly minimum: IsolationLevel;
    /** Allowed runtimes (must include preferred and any fallback candidates). */
    readonly allowed: readonly IsolationLevel[];
    /** When preferred unavailable, try next allowed ≥ minimum (by rank ascending among allowed). */
    readonly allowFallback: boolean;
}

export const DEFAULT_RUNTIME_POLICY: Readonly<RuntimePolicy> = Object.freeze({
    preferred: 'process',
    minimum: 'process',
    allowed: ['process'] as const,
    allowFallback: false,
});

export interface RuntimeCapabilityMatrix {
    readonly isolation: IsolationLevel;
    readonly executionIsolation: boolean;
    readonly memorySpaceIsolation: boolean;
    readonly failureIsolation: boolean;
    readonly filesystemIsolation: boolean;
    readonly networkIsolation: boolean;
    /** Can terminate the entire execution context (not just logical unload). */
    readonly disposableContext: boolean;
    readonly typicalStartupMs: 'low' | 'medium' | 'high';
    readonly guarantees: string;
}

export const RUNTIME_CAPABILITY_MATRIX: Readonly<
    Record<IsolationLevel, RuntimeCapabilityMatrix>
> = {
    'in-process': {
        isolation: 'in-process',
        executionIsolation: false,
        memorySpaceIsolation: false,
        failureIsolation: false,
        filesystemIsolation: false,
        networkIsolation: false,
        disposableContext: false,
        typicalStartupMs: 'low',
        guarantees:
            'Logical unload + resource cleanup + fresh import evaluation. No guaranteed ESM graph GC.',
    },
    worker: {
        isolation: 'worker',
        executionIsolation: true,
        memorySpaceIsolation: true,
        failureIsolation: true,
        filesystemIsolation: false,
        networkIsolation: false,
        disposableContext: true,
        typicalStartupMs: 'low',
        guarantees:
            'Worker thread termination destroys worker heap/context. Not full OS process isolation.',
    },
    process: {
        isolation: 'process',
        executionIsolation: true,
        memorySpaceIsolation: true,
        failureIsolation: true,
        filesystemIsolation: false,
        networkIsolation: false,
        disposableContext: true,
        typicalStartupMs: 'medium',
        guarantees: 'Child process exit destroys process address space. Shares host FS/network unless further constrained.',
    },
    container: {
        isolation: 'container',
        executionIsolation: true,
        memorySpaceIsolation: true,
        failureIsolation: true,
        filesystemIsolation: true,
        networkIsolation: true,
        disposableContext: true,
        typicalStartupMs: 'high',
        guarantees:
            'Container destroy removes container FS/network namespace (engine-dependent). Docker not mandatory.',
    },
    external: {
        isolation: 'external',
        executionIsolation: true,
        memorySpaceIsolation: true,
        failureIsolation: true,
        filesystemIsolation: true,
        networkIsolation: true,
        disposableContext: true,
        typicalStartupMs: 'high',
        guarantees:
            'External orchestrator (e.g. Pterodactyl) owns lifecycle. Optional backend — not a Zene dependency.',
    },
};

/** In-process lifecycle hooks — never sent across isolation boundaries. */
export interface InProcessLifecycleHooks {
    readonly setup: () => Promise<void>;
    readonly enable: () => Promise<void>;
    readonly disable: () => Promise<void>;
    readonly unload: () => Promise<void>;
}

export interface RuntimeLaunchRequest {
    readonly pluginId: string;
    /** Optional legacy URL field; isolated backends prefer pluginDir + entryRelative. */
    readonly entryUrl?: string;
    /** Absolute authorized plugin root (must contain entry). */
    readonly pluginDir?: string;
    /** Entrypoint relative to pluginDir (no path escape). */
    readonly entryRelative?: string;
    readonly policy: RuntimePolicy;
    /** Explicit filtered env for isolated backends — never full parent env. */
    readonly env?: Readonly<Record<string, string>>;
    /**
     * Required when policy selects in-process. Invoked by RuntimeManager.lifecycle.
     * Must not be used for worker/process (non-serializable).
     */
    readonly inProcessHooks?: InProcessLifecycleHooks;
}

export type RuntimeSelectionCode =
    | 'selected'
    | 'preferred_unavailable_fallback'
    | 'rejected_below_minimum'
    | 'rejected_none_available'
    | 'rejected_policy';

export interface RuntimeSelectionSuccess {
    readonly ok: true;
    readonly level: IsolationLevel;
    readonly code: 'selected' | 'preferred_unavailable_fallback';
    readonly message: string;
}

export interface RuntimeSelectionFailure {
    readonly ok: false;
    readonly code: 'rejected_below_minimum' | 'rejected_none_available' | 'rejected_policy';
    readonly message: string;
    readonly attempted?: readonly IsolationLevel[];
}

export type RuntimeSelectionResult = RuntimeSelectionSuccess | RuntimeSelectionFailure;

/** Structured IPC/RPC envelope — no live object graphs across isolation. */
export interface RuntimeMessage {
    readonly v: 1;
    readonly id: string;
    readonly type: string;
    readonly payload: unknown;
    readonly error?: { readonly code: string; readonly message: string };
}

export interface RuntimeHandle {
    readonly id: string;
    readonly pluginId: string;
    readonly level: IsolationLevel;
    health: RuntimeHealth;
    /** Post a structured message (no-op / local for in-process). */
    post(message: RuntimeMessage): Promise<void>;
    /** Terminate execution context according to isolation level. */
    terminate(reason?: string): Promise<void>;
}
