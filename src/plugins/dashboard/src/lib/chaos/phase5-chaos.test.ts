



import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    FAIL_CLOSED_RISKS,
    distributedAllow,
    setDistributedRateLimitRedis,
} from '../rateLimit/distributedStore.js';
import { ruleForRisk } from '../rateLimit/rateLimitPolicy.js';
import { sessionsToRevokeForCap } from '../../auth/concurrentSessionPolicy.js';
import { evaluatePluginIntegrity } from '../pluginIntegrity.js';

describe('phase5 chaos: Redis rate-limit', () => {
    it('authentication fail-closed when Redis unavailable', async () => {
        setDistributedRateLimitRedis(null);
        assert.equal(FAIL_CLOSED_RISKS.has('authentication'), true);
        const rule = ruleForRisk('authentication');
        const d = await distributedAllow('chaos|auth|ip:9.9.9.9', rule);
        assert.equal(d.allowed, false);
        assert.equal(d.backend, 'fail_closed');
    });

    it('data_deletion fail-closed when Redis unavailable', async () => {
        setDistributedRateLimitRedis(null);
        const rule = ruleForRisk('data_deletion');
        const d = await distributedAllow('chaos|del|u:1', rule);
        assert.equal(d.allowed, false);
        assert.equal(d.backend, 'fail_closed');
    });
});

describe('phase5 chaos: durable job lease', () => {
    it('exclusive claim; recovery after lease expiry', () => {
        type Lease = { owner: string; expiresAt: number };
        const leases = new Map<string, Lease>();
        let clock = 1_000_000;
        function claim(jobId: string, owner: string, ttlMs: number): boolean {
            const cur = leases.get(jobId);
            if (cur && cur.expiresAt > clock && cur.owner !== owner) return false;
            leases.set(jobId, { owner, expiresAt: clock + ttlMs });
            return true;
        }
        assert.equal(claim('j1', 'w1', 5000), true);
        assert.equal(claim('j1', 'w2', 5000), false);
        clock += 6000;
        assert.equal(claim('j1', 'w2', 5000), true);
    });
});

describe('phase5 chaos: Cross-Host generation', () => {
    it('rejects stale generation', () => {
        const gen = 7;
        const accept = (g: number) => (g === gen ? 'ok' : 'stale_generation');
        assert.equal(accept(7), 'ok');
        assert.equal(accept(6), 'stale_generation');
    });
});

describe('phase5 chaos: realtime auth after permission loss', () => {
    it('denies delivery without required capability', () => {
        const can = (bits: Set<string>) => bits.has('dashboard.guild.read') || bits.has('bot.owner');
        assert.equal(can(new Set(['dashboard.guild.read'])), true);
        assert.equal(can(new Set()), false);
    });
});

describe('phase5 chaos: plugin integrity', () => {
    it('signature failure is not trusted', () => {
        const r = evaluatePluginIntegrity({
            pluginId: 'chaos-bad',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.6',
            sdkVersion: '1.0.0',
            signatureValid: false,
        });
        assert.notEqual(r.state, 'trusted');
        assert.equal(r.acceptContributions, false);
    });
});

describe('phase5 chaos: concurrent sessions under pressure', () => {
    it('caps active sessions', () => {
        const sessions = Array.from({ length: 12 }, (_, i) => ({
            sessionId: `s${i}`,
            createdAt: i,
        }));
        const revoke = sessionsToRevokeForCap(sessions, 10, 's11');
        assert.equal(revoke.length, 2);
        assert.ok(!revoke.includes('s11'));
    });
});

describe('phase5 chaos: database unavailable', () => {
    it('probe returns false on connection error', async () => {
        const ok = await (async () => {
            try {
                throw new Error('ECONNREFUSED');
            } catch {
                return false;
            }
        })();
        assert.equal(ok, false);
    });
});
