/**
 * Phase 2C — Typed analytics / telemetry envelope (operational vs marketing).
 */

export type AnalyticsPrivacyClass =
    | 'operational'
    | 'security'
    | 'audit'
    | 'marketing'
    | 'product'
    | 'authentication'
    | 'privacy-sensitive';

export type AnalyticsRetentionClass = 'live' | 'short' | 'standard' | 'long' | 'legal';

export interface AnalyticsEventEnvelope {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly eventType: string;
    readonly schemaVersion: 1;
    readonly privacyClass: AnalyticsPrivacyClass;
    readonly retentionClass: AnalyticsRetentionClass;
    readonly source: string;
    readonly requestId?: string;
    readonly correlationId?: string;
    readonly actorUserId?: string;
    readonly anonymousSessionId?: string;
    readonly guildId?: string;
    readonly botContext?: string;
    readonly dimensions?: Readonly<Record<string, string | number | boolean | null>>;
    readonly properties?: Readonly<Record<string, unknown>>;
}

export interface PublicTelemetryMetricConfig {
    readonly metricId: string;
    readonly enabled: boolean;
    readonly displayName: string;
    readonly aggregation: 'sum' | 'avg' | 'max' | 'last' | 'count';
    readonly maxTimeRangeSec: number;
    readonly privacyClass: AnalyticsPrivacyClass;
}

export interface MarketingAttribution {
    readonly utmSource?: string;
    readonly utmMedium?: string;
    readonly utmCampaign?: string;
    readonly utmTerm?: string;
    readonly utmContent?: string;
    readonly referrer?: string;
    readonly landingRoute?: string;
}

export function newAnalyticsEventId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `ae_${Date.now().toString(36)}_${process.hrtime.bigint().toString(36)}`;
}
