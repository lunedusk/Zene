/** Plugin-owned scheduling — no global start/stop. */
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

export interface SdkCooldownContext {
    /** Subject of the rate limit (defaults to anonymous if omitted). */
    readonly userId?: string;
    readonly guildId?: string;
    readonly channelId?: string;
    /**
     * Logical operation id within the plugin (command name, route, job, etc.).
     * Maps to Core CooldownContext.commandId. Falls back to `key` or the slug.
     */
    readonly commandId?: string;
    /** Alias for commandId when not command-scoped. */
    readonly key?: string;
}

export interface SdkBridgeCooldowns {
    define(slug: string, limit: number, windowSeconds: number): void;
    isRateLimited(
        slug: string,
        ctx: SdkCooldownContext,
    ): Promise<{ limited: boolean; remaining: number; resetAt?: number }>;
    refund(slug: string, ctx: SdkCooldownContext): Promise<void>;
}

export interface SdkBridgePermissions {
    hasBit(userId: string, bit: string, guildId?: string): Promise<boolean>;
    requireBit(userId: string, bit: string, guildId?: string): Promise<void>;
}

export interface SdkFeatureDeclaration {
    readonly id: string;
    readonly description?: string;
    readonly intents?: readonly string[];
    readonly softDisabled?: boolean;
}

export interface SdkBridgeFeatures {
    register(feature: SdkFeatureDeclaration): void;
}

export interface SdkBridgeLocale {
    t(namespace: string, key: string, variables?: Readonly<Record<string, string | number>>): string;
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
    /** Read-only eligibility/info helpers — no gate/access mutation. */
    resolveName(guildId: string): string | undefined;
}
