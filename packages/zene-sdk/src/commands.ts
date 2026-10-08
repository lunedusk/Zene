/**
 * Platform-neutral command registration contracts.
 * Discord-specific builders/interactions live under `@lunedusk/zene-sdk/discord`.
 */

/** Opaque requirements evaluated by the Core host — never grant authority by themselves. */
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

export interface SdkBridgeCommandsNeutral {
    unregister(name: string): void;
}
