import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoClientWorkerAuthority } from './crossHostForwarder.js';
import { resolveDataPlaneRoute, shouldRetryOnStale } from './crossHostDataPlane.js';

describe('crossHostForwarder security', () => {
    it('rejects client worker spoof headers', () => {
        const bad = assertNoClientWorkerAuthority({ 'x-force-worker': 'w1' });
        assert.equal(bad.ok, false);
        const ok = assertNoClientWorkerAuthority({ 'x-request-id': 'r1' });
        assert.equal(ok.ok, true);
    });

    it('does not retry non-idempotent mutations on stale', () => {
        assert.equal(
            shouldRetryOnStale({
                guildId: '1',
                operation: 'mutate',
                requestId: 'r',
                idempotent: false,
            }),
            false,
        );
        assert.equal(
            shouldRetryOnStale({
                guildId: '1',
                operation: 'read',
                requestId: 'r',
            }),
            true,
        );
    });

    it('resolveDataPlaneRoute fails on bad guild', () => {
        const r = resolveDataPlaneRoute(
            { guildId: '', operation: 'read', requestId: 'r' },
            { totalShards: 1, shardMap: { ownerOf: () => 'w1' } },
            'w1',
        );
        assert.equal(r.ok, false);
    });
});
