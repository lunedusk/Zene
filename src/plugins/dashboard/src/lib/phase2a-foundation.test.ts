/**
 * Phase 2A foundation unit tests (pure modules / no logger boot).
 * Run: npx tsx --test src/plugins/dashboard/src/lib/phase2a-foundation.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveResourceRoute,
    revalidateResourceRoute,
    retryClassForMethod,
} from '#core/crosshost/resourceRouter.js';
import { hashRequestPayload } from './durableIdempotency.js';
import { toPageResult, serviceOk, ServiceError } from './requestContext.js';

describe('resourceRouter', () => {
    it('resolves guild and captures generation', () => {
        const map = {
            ownerOf(shardId: number) {
                return shardId === 0 ? 'w-a' : 'w-b';
            },
            getGeneration() {
                return 7;
            },
        };
        const r = resolveResourceRoute('123456789012345678', { totalShards: 2, shardMap: map });
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.equal(r.generation, 7);
            assert.ok(r.workerId === 'w-a' || r.workerId === 'w-b');
            const okStill = revalidateResourceRoute(r, { totalShards: 2, shardMap: map });
            assert.equal(okStill.ok, true);
            const moved = revalidateResourceRoute(r, {
                totalShards: 2,
                shardMap: {
                    ownerOf: () => 'other',
                    getGeneration: () => 7,
                },
            });
            assert.equal(moved.ok, false);
            if (!moved.ok) assert.equal(moved.code, 'STALE_ROUTE');
        }
    });

    it('detects generation change as STALE_ROUTE', () => {
        const map = {
            ownerOf: () => 'w-a',
            getGeneration: () => 1,
        };
        const r = resolveResourceRoute('123456789012345678', { totalShards: 1, shardMap: map });
        assert.equal(r.ok, true);
        if (r.ok) {
            const stale = revalidateResourceRoute(r, {
                totalShards: 1,
                shardMap: { ownerOf: () => 'w-a', getGeneration: () => 2 },
            });
            assert.equal(stale.ok, false);
        }
    });

    it('classifies GET as safe retry and POST as never', () => {
        assert.equal(retryClassForMethod('GET'), 'safe_read_retry');
        assert.equal(retryClassForMethod('POST'), 'never_auto_retry');
    });
});

describe('service contracts', () => {
    it('page result shape', () => {
        const page = toPageResult([1, 2], 10, { page: 1, limit: 2, offset: 0 });
        assert.equal(page.pagination.totalPages, 5);
        assert.equal(page.items.length, 2);
    });

    it('ServiceError carries http status', () => {
        const e = new ServiceError('VERSION_CONFLICT', 'conflict', 409);
        assert.equal(e.httpStatus, 409);
        assert.equal(serviceOk({ a: 1 }).ok, true);
    });

    it('request hash is stable', () => {
        assert.equal(hashRequestPayload({ x: 1 }), hashRequestPayload({ x: 1 }));
        assert.notEqual(hashRequestPayload({ x: 1 }), hashRequestPayload({ x: 2 }));
    });
});
