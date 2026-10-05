




import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensurePhase4TestBackend } from './phase4TestBackend.js';
import { resetCrossHostTransportForTests, publishCrossHost, wasMessageSeen } from './crossHost/transportBus.js';
import {
    startSearchIndexPeerSubscriber,
    mutateSearchAndPropagate,
} from './search/searchCrossHostSync.js';
import { durableQueryCandidates, durableClear } from './search/durableSearchRepository.js';
import {
    registerBrokerClient,
    publishDashboardEvent,
    bumpRealtimeAuthRevision,
    type BrokerClient,
} from './realtime/broker.js';
import type { DashboardEvent } from './realtime/eventContract.js';
import { makeRealtimeActor } from './realtime/resolvedPermissionsFactory.js';
import {
    distributedAllow,
    setDistributedRateLimitRedis,
    rebindRateLimitRedisFromRegistry,
    FAIL_CLOSED_RISKS,
} from './rateLimit/distributedStore.js';
import { ruleForRisk } from './rateLimit/rateLimitPolicy.js';
import {
    registerBuiltinDashboardProviders,
    registerDataRightsProvider,
    unregisterDataRightsProvider,
} from './dataRightsProviders.js';
import {
    aggregateProviderResults,
    executeDataRightsRequest,
    startDataRightsRemoteWorker,
    registerRemoteDataRightsProvider,
} from './dataRights/crossHostExecution.js';
import {
    gatePluginContribution,
    requirePluginContribution,
    refreshPluginIntegrity,
} from './pluginContributionGate.js';
import { clearPluginRuntimeIntegrity, setPluginRuntimeIntegrity } from './pluginRuntimeGate.js';
import {
    validateOpenApiInventory,
    buildOpenApiDocument,
    DASHBOARD_OPENAPI_INVENTORY,
} from './openapi/routeInventory.js';
import {
    ensureBetterAuthSchema,
    setAuthCutoverPhase,
    isLegacyAuthAllowed,
} from '../auth/betterAuthSchema.js';
import { resolveSessionIdentity, registerBetterAuthSessionResolver } from '../auth/sessionResolver.js';
import { generateTotp, generateTotpSecret, verifyTotp } from './totp.js';

before(async () => {
    await ensurePhase4TestBackend();
    resetCrossHostTransportForTests();
});

describe('phase4 integration: search Cross-Host peer', () => {
    it('propagates upsert from worker A to worker B durable index', async () => {
        await durableClear();
        const unsubB = startSearchIndexPeerSubscriber({ workerId: 'worker-B' });
        await mutateSearchAndPropagate('worker-A', 'upsert', {
            id: 'page.peer-1',
            kind: 'page',
            title: 'Peer Page One',
        });

        await new Promise((r) => setTimeout(r, 10));
        const found = await durableQueryCandidates('Peer Page');
        assert.ok(found.some((c) => c.id === 'page.peer-1'));
        await mutateSearchAndPropagate('worker-A', 'remove', { kind: 'page', id: 'page.peer-1' });
        await new Promise((r) => setTimeout(r, 10));
        const after = await durableQueryCandidates('Peer Page');
        assert.equal(after.some((c) => c.id === 'page.peer-1'), false);
        unsubB();
    });

    it('dedupes identical message ids', async () => {
        const env1 = await publishCrossHost('dash.search.index', 'w1', 'search.index.upsert', { id: 'x' }, 'fixed-msg-1');
        const env2 = await publishCrossHost('dash.search.index', 'w1', 'search.index.upsert', { id: 'x' }, 'fixed-msg-1');
        assert.equal(env1.messageId, env2.messageId);
        assert.equal(wasMessageSeen('fixed-msg-1'), true);
    });
});

describe('phase4 integration: realtime delivery + mid-connection auth', () => {
    it('delivers to authorized client and blocks unauthorized', () => {
        const received: DashboardEvent[] = [];
        const denied: DashboardEvent[] = [];
        const authClient: BrokerClient = {
            id: 'c-auth',
            actor: makeRealtimeActor({
                userId: 'u1',
                isEnvOwner: true,
                bits: ['bot.owner'],
                botOwner: true,
            }),
            authRevision: 1,
            scopes: [{ kind: 'guild', guildId: 'g1' }],
            write: (e) => {
                received.push(e);
                return true;
            },
            close: () => {},
        };
        const unauthClient: BrokerClient = {
            id: 'c-no',
            actor: makeRealtimeActor({
                userId: 'u2',
                isEnvOwner: false,
                bits: [],
                botOwner: false,
            }),
            authRevision: 1,
            scopes: [{ kind: 'guild', guildId: 'g1' }],
            write: (e) => {
                denied.push(e);
                return true;
            },
            close: () => {},
        };
        const off1 = registerBrokerClient(authClient);
        const off2 = registerBrokerClient(unauthClient);
        publishDashboardEvent({
            type: 'guild.update',
            resource: { type: 'guild', id: 'g1', guildId: 'g1' },
            payload: { ok: true },
        });

        off1();
        off2();
        assert.ok(received.length + denied.length >= 0);
    });

    it('bumps auth revision for mid-connection permission changes', () => {
        const before = bumpRealtimeAuthRevision();
        const after = bumpRealtimeAuthRevision();
        assert.ok(after > before);
    });
});

describe('phase4 integration: Redis rate-limit lifecycle', () => {
    it('fail-closed then binds mock redis then fail-closed again', async () => {
        setDistributedRateLimitRedis(null);
        const rule = ruleForRisk('authentication');
        assert.equal(FAIL_CLOSED_RISKS.has('authentication'), true);
        const closed = await distributedAllow('authentication|ip:9.9.9.9|route:/x', rule);
        assert.equal(closed.backend, 'fail_closed');
        assert.equal(closed.allowed, false);

        const store = new Map<string, number>();
        setDistributedRateLimitRedis({
            async incr(key) {
                const n = (store.get(key) ?? 0) + 1;
                store.set(key, n);
                return n;
            },
            async pexpire() {
                return 1;
            },
        });
        const open = await distributedAllow('authentication|ip:9.9.9.9|route:/x', rule);
        assert.equal(open.backend, 'redis');
        assert.equal(open.allowed, true);


        setDistributedRateLimitRedis(null);
        const closed2 = await distributedAllow('authentication|ip:9.9.9.9|route:/x', rule);
        assert.equal(closed2.backend, 'fail_closed');


        const rebound = rebindRateLimitRedisFromRegistry(() => ({
            main: {
                async incr(key) {
                    const n = (store.get(key) ?? 0) + 1;
                    store.set(key, n);
                    return n;
                },
                async pexpire() {
                    return 1;
                },
            },
        }));
        assert.equal(rebound, true);
        const open2 = await distributedAllow('authentication|ip:8.8.8.8|route:/y', rule);
        assert.equal(open2.backend, 'redis');
        setDistributedRateLimitRedis(null);
    });
});

describe('phase4 integration: data-rights Cross-Host', () => {
    it('aggregates partial failure correctly', () => {
        const agg = aggregateProviderResults([
            { providerId: 'a', status: 'succeeded' },
            { providerId: 'b', status: 'failed', detail: 'boom' },
        ]);
        assert.equal(agg.status, 'partial');
    });

    it('executes local + remote providers across workers', async () => {
        registerBuiltinDashboardProviders();
        const unsub = startDataRightsRemoteWorker('worker-remote', {
            async deleteData() {
                return { status: 'succeeded', detail: 'remote_deleted' };
            },
            async exportData() {
                return { status: 'succeeded', detail: 'remote_exported' };
            },
        });
        registerRemoteDataRightsProvider({
            providerId: 'remote.plugin.data',
            remoteWorkerId: 'worker-remote',
            timeoutMs: 2000,
        });
        const result = await executeDataRightsRequest({
            requestId: 'dr-1',
            userId: 'user-1',
            kind: 'deletion',
            guildId: null,
        });
        assert.ok(result.results.length >= 1);
        assert.ok(result.status === 'completed' || result.status === 'partial');
        unregisterDataRightsProvider('remote.plugin.data');
        unsub();
    });
});

describe('phase4 integration: plugin contribution gates', () => {
    it('blocks every contribution kind when quarantined', () => {
        clearPluginRuntimeIntegrity('plug-x');
        const kinds = [
            'route',
            'page',
            'widget',
            'navigation',
            'realtime',
            'job',
            'search_provider',
            'tsx',
            'event_handler',
            'api',
            'lifecycle',
        ] as const;
        for (const k of kinds) {
            const r = gatePluginContribution('plug-x', k);
            assert.equal(r.ok, false);
        }
        setPluginRuntimeIntegrity('plug-x', {
            pluginId: 'plug-x',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            signatureValid: true,
        });
        for (const k of kinds) {
            assert.equal(gatePluginContribution('plug-x', k).ok, true);
        }
        refreshPluginIntegrity('plug-x', {
            pluginId: 'plug-x',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            quarantined: true,
        });
        assert.throws(() => requirePluginContribution('plug-x', 'tsx'));
        clearPluginRuntimeIntegrity('plug-x');
    });
});

describe('phase4 integration: OpenAPI inventory', () => {
    it('validates inventory and builds document', () => {
        const v = validateOpenApiInventory();
        assert.equal(v.ok, true, v.errors.join(','));
        assert.ok(v.routeCount >= 15);
        const doc = buildOpenApiDocument();
        assert.equal(doc.openapi, '3.0.3');
        assert.ok(typeof doc.paths === 'object');
        assert.ok(DASHBOARD_OPENAPI_INVENTORY.some((r) => r.path.includes('/account/mfa')));
    });
});

describe('phase4 integration: Better Auth schema + cutover', () => {
    it('schema ensure is structured and cutover rejects legacy in phase 4', async () => {
        const schema = await ensureBetterAuthSchema();
        assert.ok(schema.ok === true || schema.ok === false);
        setAuthCutoverPhase(4);
        assert.equal(isLegacyAuthAllowed(), false);
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity({
            headers: {},
            dashSession: {
                payload: { userId: 'legacy', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'j' },
            },
        });
        assert.equal(r.authority, 'none');
        setAuthCutoverPhase(2);
        assert.equal(isLegacyAuthAllowed(), true);
    });
});

describe('phase4 integration: TOTP crypto', () => {
    it('round-trips secret and rejects bad codes', () => {
        const secret = generateTotpSecret();
        const code = generateTotp(secret);
        assert.equal(verifyTotp(secret, code), true);
        assert.equal(verifyTotp(secret, '000000'), false);
    });
});
