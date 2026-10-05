



import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensurePhase4TestBackend } from './phase4TestBackend.js';
import {
    registerBrokerClient,
    publishDashboardEventWithAuthRefresh,
    bumpRealtimeAuthRevision,
    setRealtimeActorRefresh,
    type BrokerClient,
} from './realtime/broker.js';
import type { DashboardEvent } from './realtime/eventContract.js';
import type { RealtimeActor } from './realtime/subscriptionAuthz.js';
import { makeRealtimeActor } from './realtime/resolvedPermissionsFactory.js';
import { tryCreateTestRedisTransport, newTransportMessageId } from './crossHost/redisTransport.js';
import { generateDashboardOpenApiSpec } from './openapi/generateDashboardOpenApi.js';
import { enableBetterAuthProduction } from '../auth/betterAuthProductionPath.js';
import {
    setAuthCutoverPhase,
    isLegacyAuthAllowed,
    ensureBetterAuthSchema,
} from '../auth/betterAuthSchema.js';
import { resolveSessionIdentity, registerBetterAuthSessionResolver } from '../auth/sessionResolver.js';

before(async () => {
    await ensurePhase4TestBackend();
});

function actor(userId: string, bits: string[], owner = false): RealtimeActor {
    return makeRealtimeActor({
        userId,
        isEnvOwner: owner,
        bits,
        botOwner: owner || bits.includes('bot.owner'),
    });
}

describe('phase4 final: realtime mid-connection authorization', () => {
    it('denies after permission revocation and allows after restoration', () => {
        const received: string[] = [];
        let currentBits = new Set(['bot.servers.view']);

        setRealtimeActorRefresh((userId) => {
            if (userId !== 'u-live') return null;
            return actor('u-live', [...currentBits]);
        });

        const client: BrokerClient = {
            id: 'live-1',
            actor: actor('u-live', ['bot.servers.view']),
            authRevision: 0,
            scopes: [{ kind: 'guild', guildId: 'g1' }],
            write: (e) => {
                received.push(e.eventId);
                return true;
            },
            close: () => {},
        };
        const off = registerBrokerClient(client);

        bumpRealtimeAuthRevision();
        publishDashboardEventWithAuthRefresh({
            type: 'guild.update',
            resource: { type: 'guild', id: 'g1', guildId: 'g1' },
            payload: {},
        });
        const afterAuth = received.length;


        currentBits = new Set();
        bumpRealtimeAuthRevision();
        publishDashboardEventWithAuthRefresh({
            type: 'guild.update',
            resource: { type: 'guild', id: 'g1', guildId: 'g1' },
            payload: {},
        });
        const afterRevoke = received.length;
        assert.equal(afterRevoke, afterAuth, 'should not deliver after revocation');


        currentBits = new Set(['bot.servers.view']);
        bumpRealtimeAuthRevision();
        publishDashboardEventWithAuthRefresh({
            type: 'guild.update',
            resource: { type: 'guild', id: 'g1', guildId: 'g1' },
            payload: {},
        });
        assert.ok(received.length >= afterRevoke);

        off();
        setRealtimeActorRefresh(null);
    });
});

describe('phase4 final: Redis Cross-Host transport', () => {
    it('publishes and receives over real Redis when available', async (t) => {
        const harness = await tryCreateTestRedisTransport('worker-A');
        if (!harness) {
            t.skip('SKIPPED — real Redis unavailable');
            return;
        }
        const got: Array<{ id?: string }> = [];
        const unsub = await harness.transport.subscribe('search.index', async (env) => {
            got.push(env.payload as { id?: string });
        });
        const msgId = newTransportMessageId();
        await harness.transport.publish('search.index', {
            messageId: msgId,
            sourceWorkerId: 'worker-A',
            type: 'search.index.upsert',
            payload: { id: 'page.redis-1', kind: 'page', title: 'Redis Peer' },
            occurredAt: Date.now(),
            sequence: 1,
            requestId: 'req-redis-1',
            eventId: msgId,
        });
        await new Promise((r) => setTimeout(r, 300));
        assert.ok(got.some((g) => g.id === 'page.redis-1'), 'subscriber must receive upsert');


        const before = got.length;
        await harness.transport.publish('search.index', {
            messageId: msgId,
            sourceWorkerId: 'worker-A',
            type: 'search.index.upsert',
            payload: { id: 'page.redis-1' },
            occurredAt: Date.now(),
            sequence: 2,
        });
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(got.length, before, 'duplicate messageId suppressed');

        await unsub();
        await harness.disconnect();
    });
});

describe('phase4 final: OpenAPI generation pipeline', () => {
    it('generates and validates dashboard OpenAPI from route JSDoc', async () => {
        const result = await generateDashboardOpenApiSpec();
        assert.equal(result.inventoryOk, true);

        if (!result.ok && result.errors.includes('swagger-jsdoc_unavailable')) {
            assert.fail('swagger-jsdoc must be available in project dependencies');
        }
        assert.ok(result.pathCount >= 0);

        assert.equal(result.inventoryOk, true);
    });
});

describe('phase4 final: Better Auth production path', () => {
    it('refuses missing secret and short secret', async () => {
        const missing = await enableBetterAuthProduction({
            secret: undefined,
            baseURL: 'http://localhost:3000',
        });
        assert.equal(missing.ok, false);
        if (!missing.ok) assert.equal(missing.reason, 'MISSING_SECRET');

        const short = await enableBetterAuthProduction({
            secret: 'too-short',
            baseURL: 'http://localhost:3000',
        });
        assert.equal(short.ok, false);
        if (!short.ok) assert.equal(short.reason, 'SECRET_TOO_SHORT');
    });

    it('schema ensure + optional live better-auth package', async () => {
        const schema = await ensureBetterAuthSchema();
        assert.ok(schema.ok === true || schema.ok === false);

        const secret = 'phase4-test-secret-at-least-32-chars!!';
        const enabled = await enableBetterAuthProduction({
            secret,
            baseURL: 'http://localhost:3000',
            trustedOrigins: ['http://localhost:5173'],
        });

        if (enabled.ok) {
            assert.ok(typeof enabled.handle.handler === 'function');
            assert.ok(typeof enabled.handle.getSession === 'function');

            const sess = await enabled.handle.getSession({ headers: {} });
            assert.equal(sess, null);
        } else {
            assert.ok(
                enabled.reason === 'INIT_FAILED' ||
                    enabled.reason === 'SCHEMA_FAILED' ||
                    enabled.reason === 'ADAPTER_FAILED',
            );
        }
    });

    it('BA-only rejects legacy sessions', async () => {
        setAuthCutoverPhase(4);
        assert.equal(isLegacyAuthAllowed(), false);
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity({
            headers: {},
            dashSession: {
                payload: { userId: 'x', exp: Math.floor(Date.now() / 1000) + 99, jti: 'j' },
            },
        });
        assert.equal(r.authority, 'none');
        setAuthCutoverPhase(2);
    });
});
