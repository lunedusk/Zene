



import type {
    AnalyticsEventEnvelope,
    AnalyticsPrivacyClass,
    MarketingAttribution,
    PublicTelemetryMetricConfig,
} from '#core/types/analytics.js';
import { newAnalyticsEventId } from '#core/types/analytics.js';

export function buildOperationalEvent(input: {
    eventType: string;
    source: string;
    requestId?: string;
    correlationId?: string;
    actorUserId?: string;
    guildId?: string;
    dimensions?: Record<string, string | number | boolean | null>;
    properties?: Record<string, unknown>;
    privacyClass?: AnalyticsPrivacyClass;
    retentionClass?: AnalyticsEventEnvelope['retentionClass'];
}): AnalyticsEventEnvelope {
    return {
        eventId: newAnalyticsEventId(),
        occurredAt: new Date().toISOString(),
        eventType: input.eventType,
        schemaVersion: 1,
        privacyClass: input.privacyClass ?? 'operational',
        retentionClass: input.retentionClass ?? 'standard',
        source: input.source,
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorUserId: input.actorUserId,
        guildId: input.guildId,
        dimensions: input.dimensions,
        properties: input.properties,
    };
}

export function buildMarketingEvent(input: {
    eventType: string;
    source: string;
    attribution?: MarketingAttribution;
    anonymousSessionId?: string;
    actorUserId?: string;
    requestId?: string;
    properties?: Record<string, unknown>;
}): AnalyticsEventEnvelope {
    const dims: Record<string, string | number | boolean | null> = {};
    const a = input.attribution;
    if (a?.utmSource) dims.utm_source = a.utmSource;
    if (a?.utmMedium) dims.utm_medium = a.utmMedium;
    if (a?.utmCampaign) dims.utm_campaign = a.utmCampaign;
    if (a?.utmTerm) dims.utm_term = a.utmTerm;
    if (a?.utmContent) dims.utm_content = a.utmContent;
    if (a?.referrer) dims.referrer = a.referrer;
    if (a?.landingRoute) dims.landing_route = a.landingRoute;
    return {
        eventId: newAnalyticsEventId(),
        occurredAt: new Date().toISOString(),
        eventType: input.eventType,
        schemaVersion: 1,
        privacyClass: 'marketing',
        retentionClass: 'standard',
        source: input.source,
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        anonymousSessionId: input.anonymousSessionId,
        dimensions: dims,
        properties: input.properties,
    };
}


export function isPublicMetricAllowed(
    metricId: string,
    configs: readonly PublicTelemetryMetricConfig[],
): boolean {
    const c = configs.find((x) => x.metricId === metricId);
    if (!c || !c.enabled) return false;
    if (c.privacyClass === 'privacy-sensitive' || c.privacyClass === 'security' || c.privacyClass === 'audit') {
        return false;
    }
    return true;
}

export function filterPublicMetrics(
    configs: readonly PublicTelemetryMetricConfig[],
): PublicTelemetryMetricConfig[] {
    return configs.filter((c) => isPublicMetricAllowed(c.metricId, configs));
}
