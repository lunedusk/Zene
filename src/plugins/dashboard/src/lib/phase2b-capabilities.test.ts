/**
 * Phase 2B pure-module tests.
 * Run: npx tsx --test src/plugins/dashboard/src/lib/phase2b-capabilities.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseSubscriptionScope,
    newEventId,
} from './realtime/eventContract.js';
import {
    authorizeSubscription,
    authorizeEventDelivery,
    scopeMatchesEvent,
} from './realtime/subscriptionAuthz.js';
import type { ResolvedPermissions } from '#core/types/permissions.js';
import {
    compileTsxDraft,
    publishTsxIfValid,
    checkTsxCompatibility,
} from './tsxRuntimeContract.js';
import { evalVisibilityExpr } from '#core/types/dashSdk.js';
import { isSessionActive, isSudoValid } from '#core/types/identitySession.js';
import {
    resolveResourceRoute,
    revalidateResourceRoute,
} from '#core/crosshost/resourceRouter.js';

function actor(bits: string[], botOwner = false): {
    userId: string;
    isEnvOwner: boolean;
    resolved: ResolvedPermissions;
} {
    return {
        userId: 'u1',
        isEnvOwner: botOwner,
        resolved: {
            botOwner,
            bits: new Set(bits),
            resolvedAt: Math.floor(Date.now() / 1000),
        },
    };
}

describe('realtime subscription + delivery', () => {
    it('parses scopes and rejects garbage', () => {
        assert.deepEqual(parseSubscriptionScope('registry'), { kind: 'registry' });
        assert.equal(parseSubscriptionScope('guild:123')?.guildId, '123');
        assert.equal(parseSubscriptionScope('nope'), null);
    });

    it('unauthorized subscription rejected', () => {
        const a = actor([]);
        assert.equal(authorizeSubscription(a, { kind: 'fleet' }), false);
        assert.equal(authorizeSubscription(actor(['bot.fleet.view']), { kind: 'fleet' }), true);
    });

    it('guild event delivery denied without bot-wide server view', () => {
        const a = actor(['server.members.view']);
        assert.equal(
            authorizeEventDelivery(a, {
                eventId: 'e1',
                type: 'layout.updated',
                occurredAt: new Date().toISOString(),
                resource: { type: 'layout', guildId: 'g1' },
                payload: {},
            }),
            false,
        );
        assert.equal(
            authorizeEventDelivery(actor(['bot.servers.view']), {
                eventId: 'e1',
                type: 'layout.updated',
                occurredAt: new Date().toISOString(),
                resource: { type: 'layout', guildId: 'g1' },
                payload: {},
            }),
            true,
        );
    });

    it('scope matches guild events', () => {
        assert.equal(
            scopeMatchesEvent(
                { kind: 'guild', guildId: 'g1' },
                {
                    eventId: '1',
                    type: 'x',
                    occurredAt: '',
                    resource: { type: 'guild', guildId: 'g1' },
                    payload: {},
                },
            ),
            true,
        );
        assert.equal(
            scopeMatchesEvent(
                { kind: 'guild', guildId: 'g1' },
                {
                    eventId: '1',
                    type: 'x',
                    occurredAt: '',
                    resource: { type: 'guild', guildId: 'g2' },
                    payload: {},
                },
            ),
            false,
        );
    });

    it('event ids are unique', () => {
        const a = newEventId();
        const b = newEventId();
        assert.notEqual(a, b);
        assert.ok(a.length > 10);
    });
});

describe('identity session helpers', () => {
    it('revoked and expired sessions inactive', () => {
        const now = Date.now();
        assert.equal(
            isSessionActive({
                sessionId: 's',
                userId: 'u',
                createdAt: now,
                lastSeenAt: now,
                expiresAt: now + 10000,
            }),
            true,
        );
        assert.equal(
            isSessionActive({
                sessionId: 's',
                userId: 'u',
                createdAt: now,
                lastSeenAt: now,
                expiresAt: now + 10000,
                revokedAt: now - 1,
            }),
            false,
        );
        assert.equal(
            isSudoValid({
                sessionId: 's',
                userId: 'u',
                createdAt: now,
                lastSeenAt: now,
                expiresAt: now + 10000,
                sudoUntil: now + 5000,
            }),
            true,
        );
    });
});

describe('visibility expressions', () => {
    it('AND/OR/NOT evaluate', () => {
        const ctx = {
            bits: new Set(['bot.plugins.view']),
            isOwner: false,
            userId: 'u',
        };
        assert.equal(
            evalVisibilityExpr(
                { type: 'and', of: [{ type: 'bit', bit: 'bot.plugins.view' }, { type: 'not', of: { type: 'owner' } }] },
                ctx,
            ),
            true,
        );
        assert.equal(
            evalVisibilityExpr({ type: 'or', of: [{ type: 'bit', bit: 'nope' }, { type: 'owner' }] }, ctx),
            false,
        );
    });
});

describe('trusted TSX', () => {
    it('empty source fails compile and cannot publish over good version', () => {
        const bad = compileTsxDraft({
            artifactId: 'a1',
            authorUserId: 'o',
            source: '  ',
            version: 1,
            zeneVersionCompat: '0.5.7',
            dashSdkCompat: '2',
            runtimeCompat: 'tsx-1',
        });
        assert.equal(bad.ok, false);
        const good = compileTsxDraft({
            artifactId: 'a1',
            authorUserId: 'o',
            source: 'export default function Page(){ return null }',
            version: 1,
            zeneVersionCompat: '0.5.7',
            dashSdkCompat: '2',
            runtimeCompat: 'tsx-1',
        });
        assert.equal(good.ok, true);
        const published = publishTsxIfValid(good.meta, null);
        assert.equal(published.ok, true);
        const blocked = publishTsxIfValid(bad.meta, published.ok ? published.published : null);
        assert.equal(blocked.ok, false);
        if (!blocked.ok) assert.ok(blocked.kept);
    });

    it('runtime mismatch rejected', () => {
        const r = checkTsxCompatibility({
            zeneVersion: '0.5.7',
            dashSdkCompat: '2',
            requiredSdk: '2',
            runtimeCompat: 'a',
            requiredRuntime: 'b',
        });
        assert.equal(r.ok, false);
    });
});

describe('cross-host still authoritative', () => {
    it('client cannot supply ownership — only guild affinity', () => {
        const map = { ownerOf: () => 'w1', getGeneration: () => 3 };
        const r = resolveResourceRoute('123456789012345678', { totalShards: 1, shardMap: map });
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.equal(r.workerId, 'w1');
            assert.equal(r.generation, 3);
            const stale = revalidateResourceRoute(r, {
                totalShards: 1,
                shardMap: { ownerOf: () => 'w2', getGeneration: () => 3 },
            });
            assert.equal(stale.ok, false);
        }
    });
});

describe('requestId strength', () => {
    it('newEventId looks like uuid', () => {
        const id = newEventId();
        assert.match(id, /^[0-9a-f-]{36}$/i);
    });
});
