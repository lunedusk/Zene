/**
 * Phase 1 dashboard security unit tests.
 * Imports only pure modules to avoid logger/secretManager ESM init cycles.
 * Run: npx tsx --test src/plugins/dashboard/src/lib/phase1-security.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    projectExternalRegistry,
    projectRegistryDiagnostics,
} from './registryProjection.js';
import type { DashRegistrySnapshot } from '#core/types/dashSdk.js';
import { clientMayReceive } from './sseDeliveryPolicy.js';
import {
    assertExpectedVersion,
    hashIdempotencyPayload,
    idempotencyLookup,
    idempotencyStoreResult,
    HttpError,
    DASH_ERROR_CODES,
} from './http.js';
import { resolveGuildRoute, assertRouteStillValid } from '#core/crosshost/routingIntent.js';
import { normalizePluginDashboardManifest } from '#core/types/dashSdk.js';

describe('external registry projection', () => {
    const snapshot: DashRegistrySnapshot = {
        version: 3,
        generatedAt: 1,
        assetOrigin: 'http://assets',
        plugins: [
            {
                pluginId: 'core',
                signed: 'signed',
                unsignedBadge: false,
                state: 'enabled',
                manifest: {
                    schemaVersion: 1,
                    pluginId: 'core',
                    surfaces: [],
                    dashCompat: '1',
                },
                surfaces: [
                    {
                        id: 'visible-page',
                        kind: 'page',
                        tier: 1,
                        title: 'Visible',
                        pluginId: 'core',
                        visibleEstimate: true,
                    },
                    {
                        id: 'hidden-page',
                        kind: 'page',
                        tier: 1,
                        title: 'Secret',
                        pluginId: 'core',
                        visibleEstimate: false,
                        blockedReason: 'bits',
                    },
                ],
            },
            {
                pluginId: 'empty-plugin',
                signed: 'unsigned',
                unsignedBadge: true,
                state: 'enabled',
                manifest: null,
                surfaces: [],
            },
        ],
    };

    it('omits unauthorized surfaces and blockedReason', () => {
        const external = projectExternalRegistry(snapshot);
        assert.equal(external.registrySchemaVersion, 2);
        assert.equal(external.plugins.length, 1);
        assert.equal(external.plugins[0]!.surfaces.length, 1);
        assert.equal(external.plugins[0]!.surfaces[0]!.id, 'visible-page');
        const json = JSON.stringify(external);
        assert.equal(json.includes('blockedReason'), false);
        assert.equal(json.includes('visibleEstimate'), false);
        assert.equal(json.includes('hidden-page'), false);
    });

    it('diagnostics still expose blocked reasons for authorized callers', () => {
        const diag = projectRegistryDiagnostics(snapshot);
        assert.ok(diag.surfaces.some((s) => s.surfaceId === 'hidden-page' && s.blockedReason === 'bits'));
    });
});

describe('SSE delivery filter', () => {
    it('allows heartbeat to any client', () => {
        assert.equal(
            clientMayReceive(
                { userId: 'u', bits: new Set(), isEnvOwner: false },
                { type: 'heartbeat' },
            ),
            true,
        );
    });

    it('blocks guild-scoped events for users without bot-wide server view', () => {
        assert.equal(
            clientMayReceive(
                { userId: 'u', bits: new Set(['server.members.view']), isEnvOwner: false },
                { type: 'layout.updated', guildId: 'g1' },
            ),
            false,
        );
    });

    it('allows guild-scoped events for bot.servers.view', () => {
        assert.equal(
            clientMayReceive(
                { userId: 'u', bits: new Set(['bot.servers.view']), isEnvOwner: false },
                { type: 'layout.updated', guildId: 'g1' },
            ),
            true,
        );
    });
});

describe('API primitives', () => {
    it('version conflict throws VERSION_CONFLICT', () => {
        assert.throws(
            () => assertExpectedVersion(1, 2),
            (e: unknown) => e instanceof HttpError && e.code === DASH_ERROR_CODES.VERSION_CONFLICT,
        );
    });

    it('idempotency same hash replays; different hash conflicts', () => {
        const key = {
            actorId: 'a',
            operation: 'ban',
            resourceKey: 'u1',
            idempotencyKey: 'k1',
            requestHash: hashIdempotencyPayload({ x: 1 }),
        };
        assert.equal(idempotencyLookup(key).status, 'miss');
        idempotencyStoreResult(key, { ok: true });
        const replay = idempotencyLookup(key);
        assert.equal(replay.status, 'replay');
        const conflict = idempotencyLookup({
            ...key,
            requestHash: hashIdempotencyPayload({ x: 2 }),
        });
        assert.equal(conflict.status, 'conflict');
    });
});

describe('routing intent', () => {
    it('resolves guild via affinity and ownerOf', () => {
        const totalShards = 2;
        const map = {
            ownerOf(shardId: number) {
                return shardId === 0 ? 'worker-a' : 'worker-b';
            },
        };
        const result = resolveGuildRoute('123456789012345678', { totalShards, shardMap: map });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.ok(result.route.workerId === 'worker-a' || result.route.workerId === 'worker-b');
            const still = assertRouteStillValid(result.route, map);
            assert.equal(still.ok, true);
            const moved = assertRouteStillValid(result.route, {
                ownerOf: () => 'worker-other',
            });
            assert.equal(moved.ok, false);
            if (!moved.ok) assert.equal(moved.code, 'STALE_ROUTE');
        }
    });
});

describe('SDK V1 normalizer', () => {
    it('accepts schemaVersion 1 manifests', () => {
        const m = normalizePluginDashboardManifest(
            {
                schemaVersion: 1,
                pluginId: 'p',
                dashCompat: '1',
                surfaces: [{ id: 'home', kind: 'page', tier: 1, title: 'Home' }],
            },
            'p',
        );
        assert.ok(m);
        assert.equal(m!.surfaces.length, 1);
    });

    it('rejects invalid schema', () => {
        assert.equal(normalizePluginDashboardManifest({ schemaVersion: 99, surfaces: [] }, 'p'), null);
    });
});
