/**
 * Phase 2C pure-module tests.
 * npx tsx --test src/plugins/dashboard/src/lib/phase2c-platform.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildMarketingEvent,
    buildOperationalEvent,
    filterPublicMetrics,
    isPublicMetricAllowed,
} from './analytics/ingest.js';
import {
    authorizeSearchCandidate,
    filterSearchResults,
    authorizedCount,
    type SearchActor,
    type SearchCandidate,
} from './search/searchAuthz.js';
import { CACHE_POLICIES, cacheKey, assertAuthSensitiveKey } from './cache/cacheClasses.js';
import { LocalRateLimiter, ruleForRisk, SUDO_REQUIRED_OPERATIONS } from './rateLimit/rateLimitPolicy.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import type { PublicTelemetryMetricConfig } from '#core/types/analytics.js';

function actor(bits: string[], owner = false): SearchActor {
    return {
        userId: 'u1',
        isEnvOwner: owner,
        resolved: {
            botOwner: owner,
            bits: new Set(bits),
            resolvedAt: Math.floor(Date.now() / 1000),
        } as ResolvedPermissions,
    };
}

describe('analytics', () => {
    it('operational and marketing envelopes are typed and separate privacy classes', () => {
        const op = buildOperationalEvent({ eventType: 'api.latency', source: 'dash', requestId: 'r1' });
        assert.equal(op.privacyClass, 'operational');
        assert.equal(op.schemaVersion, 1);
        const m = buildMarketingEvent({
            eventType: 'cta.click',
            source: 'public',
            attribution: { utmSource: 'twitter', landingRoute: '/' },
            anonymousSessionId: 'anon1',
        });
        assert.equal(m.privacyClass, 'marketing');
        assert.equal(m.dimensions?.utm_source, 'twitter');
        assert.equal(m.actorUserId, undefined);
    });

    it('public metrics require explicit allowlist and never security/audit', () => {
        const configs: PublicTelemetryMetricConfig[] = [
            {
                metricId: 'guilds_total',
                enabled: true,
                displayName: 'Guilds',
                aggregation: 'last',
                maxTimeRangeSec: 86400,
                privacyClass: 'operational',
            },
            {
                metricId: 'auth_failures',
                enabled: true,
                displayName: 'Auth fails',
                aggregation: 'sum',
                maxTimeRangeSec: 3600,
                privacyClass: 'security',
            },
        ];
        assert.equal(isPublicMetricAllowed('guilds_total', configs), true);
        assert.equal(isPublicMetricAllowed('auth_failures', configs), false);
        assert.equal(filterPublicMetrics(configs).length, 1);
    });
});

describe('search authorization', () => {
    it('omits unauthorized and hidden; counts use same filter', () => {
        const a = actor(['bot.plugins.view']);
        const candidates: SearchCandidate[] = [
            { id: '1', kind: 'plugin', title: 'P' },
            { id: '2', kind: 'audit', title: 'A' },
            { id: '3', kind: 'override', title: 'O', ownerOnly: true },
            { id: '4', kind: 'page', title: 'H', hidden: true },
            { id: '5', kind: 'metric', title: 'M', requiredBits: ['bot.analytics.view'] },
        ];
        const filtered = filterSearchResults(a, candidates);
        assert.equal(filtered.some((c) => c.kind === 'audit'), false);
        assert.equal(filtered.some((c) => c.kind === 'override'), false);
        assert.equal(filtered.some((c) => c.hidden), false);
        assert.equal(filtered.some((c) => c.kind === 'metric'), false);
        assert.equal(filtered.some((c) => c.kind === 'plugin'), true);
        assert.equal(authorizedCount(a, candidates), filtered.length);
        assert.equal(authorizeSearchCandidate(actor([], true), candidates[2]!), true);
    });
});

describe('cache classes', () => {
    it('defines distinct classes and guards user keys', () => {
        assert.ok(CACHE_POLICIES.some((p) => p.class === 'authorization'));
        assert.ok(CACHE_POLICIES.some((p) => p.class === 'registry'));
        const k = cacheKey({ userId: 'u1', resourceId: 'x' });
        assert.doesNotThrow(() => assertAuthSensitiveKey('u1', k));
        assert.throws(() => assertAuthSensitiveKey('u2', k));
    });
});

describe('rate limiting', () => {
    it('enforces local window and sudo list exists', () => {
        const lim = new LocalRateLimiter();
        const rule = ruleForRisk('authentication');
        const key = lim.buildKey(rule, { ip: '1.1.1.1', route: '/auth' });
        for (let i = 0; i < rule.max; i++) assert.equal(lim.allow(key, rule), true);
        assert.equal(lim.allow(key, rule), false);
        assert.ok(SUDO_REQUIRED_OPERATIONS.includes('data_rights.delete'));
    });
});
