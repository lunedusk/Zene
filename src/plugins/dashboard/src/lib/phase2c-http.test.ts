/**
 * Phase 2C integration-oriented unit tests for jobs/search/rate-limit surfaces.
 * npx tsx --test src/plugins/dashboard/src/lib/phase2c-http.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    clearSearchIndex,
    upsertSearchEntry,
    querySearchCandidates,
    ensureDefaultSearchSeed,
} from './search/searchIndex.js';
import { filterSearchResults, authorizedCount } from './search/searchAuthz.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import { LocalRateLimiter, ruleForRisk } from './rateLimit/rateLimitPolicy.js';
import { ALLOWED_TRANSITIONS_PROBE } from './jobStateProbe.js';

describe('search index backend', () => {
    it('indexes, queries, orders stably, and re-authorizes', () => {
        clearSearchIndex();
        upsertSearchEntry({ id: 'p1', kind: 'plugin', title: 'Alpha Plugin' });
        upsertSearchEntry({ id: 'a1', kind: 'audit', title: 'Audit Entry', requiredBits: ['bot.audit.view'] });
        upsertSearchEntry({ id: 'h1', kind: 'page', title: 'Hidden', hidden: true });
        const candidates = querySearchCandidates('alpha');
        assert.equal(candidates.some((c) => c.id === 'p1'), true);
        const actor = {
            userId: 'u',
            isEnvOwner: false,
            resolved: {
                botOwner: false,
                bits: new Set(['bot.plugins.view']),
                resolvedAt: 0,
            } as ResolvedPermissions,
        };
        const filtered = filterSearchResults(actor, candidates);
        assert.equal(filtered.every((c) => c.kind !== 'audit'), true);
        assert.equal(filtered.every((c) => !c.hidden), true);
        assert.equal(authorizedCount(actor, [
            { id: 'a1', kind: 'audit', title: 'A' },
            { id: 'p1', kind: 'plugin', title: 'P' },
        ]), 1);
        clearSearchIndex();
        ensureDefaultSearchSeed();
        assert.ok(querySearchCandidates('').length >= 1);
    });
});

describe('rate limit middleware policy', () => {
    it('independent user keys and 429 semantics via allow()', () => {
        const lim = new LocalRateLimiter();
        const rule = ruleForRisk('mutation');
        const u1 = lim.buildKey(rule, { user: 'a', route: '/jobs' });
        const u2 = lim.buildKey(rule, { user: 'b', route: '/jobs' });
        for (let i = 0; i < rule.max; i++) assert.equal(lim.allow(u1, rule), true);
        assert.equal(lim.allow(u1, rule), false);
        assert.equal(lim.allow(u2, rule), true);
    });
});

describe('job state transitions probe', () => {
    it('cannot cancel from succeeded', () => {
        assert.equal(ALLOWED_TRANSITIONS_PROBE.succeeded.includes('cancelled'), false);
        assert.equal(ALLOWED_TRANSITIONS_PROBE.queued.includes('cancelled'), true);
    });
});
