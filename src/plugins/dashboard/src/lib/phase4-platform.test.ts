import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureBetterAuthSchema,
    getAuthCutoverPhase,
    setAuthCutoverPhase,
    isLegacyAuthAllowed,
    BETTER_AUTH_SCHEMA_VERSION,
} from '../auth/betterAuthSchema.js';
import { distributedAllow, setDistributedRateLimitRedis, FAIL_CLOSED_RISKS } from './rateLimit/distributedStore.js';
import { ruleForRisk } from './rateLimit/rateLimitPolicy.js';
import {
    registerWorker,
    heartbeatWorker,
    resolveWorkerEndpoint,
    disableWorker,
} from './crossHost/workerRegistry.js';
import { claimJob, heartbeatLease, releaseLease } from './jobs/distributedClaim.js';
import { gateTsxPublish, loadTsxArtifact, runTsxIsolated, disableTsxArtifact } from './tsx/tsxPipeline.js';
import {
    setPluginRuntimeIntegrity,
    assertPluginMayExecute,
    clearPluginRuntimeIntegrity,
} from './pluginRuntimeGate.js';
import { isLegacyAuthAllowed as leg } from '../auth/betterAuthSchema.js';
import { accountSecurityService } from '../services/accountSecurityService.js';
import {
    issueWorkerRegistrationChallenge,
    secureRegisterWorker,
} from './crossHost/secureWorkerRegistration.js';
import { computeRegisterHmac } from '#core/crosshost/auth/hmac.js';
import { createJob } from '../../../dash-data/src/repositories/jobRepository.js';
import { resolveSessionIdentity, registerBetterAuthSessionResolver } from '../auth/sessionResolver.js';
import { before } from 'node:test';
import { ensurePhase4TestBackend } from './phase4TestBackend.js';
import { generateTotp } from './totp.js';
import { kvGet } from '../../../dash-data/src/lib/store.js';
import type { RequestContext } from './requestContext.js';
import type { VerifiedToken } from '#core/manager/token.js';
import { makeResolvedPermissions } from './realtime/resolvedPermissionsFactory.js';

before(async () => {
  await ensurePhase4TestBackend();
});

describe('phase4 better auth schema', () => {
    it('cutover phases control legacy', () => {
        setAuthCutoverPhase(2);
        assert.equal(isLegacyAuthAllowed(), true);
        setAuthCutoverPhase(4);
        assert.equal(isLegacyAuthAllowed(), false);
        setAuthCutoverPhase(2);
        assert.equal(getAuthCutoverPhase(), 2);
        assert.equal(BETTER_AUTH_SCHEMA_VERSION, 2); // v2: canonical better-auth table names
    });

    it('schema ensure returns structured result without throwing', async () => {
        // May fail adapter in test env — must not throw
        const r = await ensureBetterAuthSchema();
        assert.ok(r.ok === true || r.ok === false);
        if (!r.ok) {
            assert.ok(
                r.reason === 'ADAPTER_UNAVAILABLE' ||
                    r.reason === 'MONGO_UNSUPPORTED' ||
                    r.reason === 'MIGRATION_FAILED',
            );
        }
    });
});

describe('phase4 distributed rate limit', () => {
    it('fail-closed for authentication when redis missing', async () => {
        setDistributedRateLimitRedis(null);
        const rule = ruleForRisk('authentication');
        assert.equal(FAIL_CLOSED_RISKS.has('authentication'), true);
        const d = await distributedAllow('authentication|ip:1.1.1.1|route:/login', rule);
        assert.equal(d.backend, 'fail_closed');
        assert.equal(d.allowed, false);
    });

    it('local fallback for non-security distributed false rule', async () => {
        setDistributedRateLimitRedis(null);
        const rule = ruleForRisk('authenticated_read');
        const d = await distributedAllow('authenticated_read|user:u1|route:/x', rule);
        assert.equal(d.backend, 'local');
        assert.equal(d.allowed, true);
    });
});

describe('phase4 worker registry', () => {
    it('register heartbeat resolve disable', async () => {
        const rec = await registerWorker({
            machineId: 'm-test-1',
            endpoint: 'https://worker-1.internal:8443',
            generation: 1,
            zeneVersion: '0.5.7',
        });
        assert.equal(rec.state, 'active');
        const hb = await heartbeatWorker('m-test-1', 1);
        assert.ok(hb);
        assert.equal(hb?.state, 'active');
        const resolved = await resolveWorkerEndpoint('m-test-1', 1);
        assert.equal(resolved.ok, true);
        if (resolved.ok) assert.equal(resolved.endpoint.includes('worker-1'), true);
        await disableWorker('m-test-1');
        const after = await resolveWorkerEndpoint('m-test-1');
        assert.equal(after.ok, false);
    });

    it('rejects stale generation heartbeat', async () => {
        await registerWorker({
            machineId: 'm-test-2',
            endpoint: 'https://worker-2.internal:8443',
            generation: 5,
        });
        const hb = await heartbeatWorker('m-test-2', 3);
        assert.equal(hb?.state, 'stale');
    });
});

describe('phase4 job claim', () => {
    it('claim unknown job fails', async () => {
        const r = await claimJob('job_does_not_exist', 'worker-a');
        assert.equal(r.ok, false);
    });
});

describe('phase4 trusted tsx pipeline', () => {
    it('publishes valid source and isolates failures', () => {
        const pub = gateTsxPublish({
            source: 'export default function(){ return 1 }',
            authorUserId: 'owner1',
            version: 1,
            zeneVersion: '0.5.7',
            dashSdkCompat: '2.0.0',
            requiredSdk: '2.0.0',
            runtimeCompat: '1',
            requiredRuntime: '1',
        });
        assert.equal(pub.ok, true);
        assert.ok(pub.artifactId);
        const load = loadTsxArtifact(pub.artifactId!);
        assert.equal(load.ok, true);
        const isolated = runTsxIsolated(() => {
            throw new Error('boom');
        });
        assert.equal(isolated.ok, false);
        disableTsxArtifact(pub.artifactId!);
        assert.equal(loadTsxArtifact(pub.artifactId!).ok, false);
    });

    it('rejects empty source', () => {
        const pub = gateTsxPublish({
            source: '  ',
            authorUserId: 'o',
            version: 1,
            zeneVersion: '0.5.7',
            dashSdkCompat: '2.0.0',
            requiredSdk: '2.0.0',
            runtimeCompat: '1',
            requiredRuntime: '1',
        });
        assert.equal(pub.ok, false);
    });
});

describe('phase4 plugin runtime integrity', () => {
    it('denies execution until evaluated and when quarantined', () => {
        clearPluginRuntimeIntegrity('p1');
        assert.equal(assertPluginMayExecute('p1').ok, false);
        setPluginRuntimeIntegrity('p1', {
            pluginId: 'p1',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            signatureValid: true,
        });
        assert.equal(assertPluginMayExecute('p1').ok, true);
        setPluginRuntimeIntegrity('p1', {
            pluginId: 'p1',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            quarantined: true,
        });
        assert.equal(assertPluginMayExecute('p1').ok, false);
        clearPluginRuntimeIntegrity('p1');
    });
});

void leg;

describe('phase4 account security', () => {
    it('session revoke and mfa enroll flow', async () => {
        const userId = 'user_acct_1';
        await accountSecurityService.seedSession(userId, {
            sessionId: 's1',
            userId,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
        });
        await accountSecurityService.seedSession(userId, {
            sessionId: 's2',
            userId,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
        });
        const now = Math.floor(Date.now() / 1000);
        const session: VerifiedToken = {
            raw: 'test-raw-token',
            payload: {
                userId,
                iat: now,
                exp: now + 3600,
                jti: 'jti-test-1',
                deviceId: 'dev-1',
                bits: [],
                tokenVersion: '1',
                iss: 'zene-test',
                aud: 'dashboard',
            },
        };
        const ctx: RequestContext = {
            requestId: 'r1',
            startedAt: Date.now(),
            session,
            actor: {
                userId,
                isEnvOwner: false,
                resolved: makeResolvedPermissions({ bits: [], botOwner: false }),
            },
        };
        const listed = await accountSecurityService.listSessions(ctx);
        assert.equal(listed.ok, true);
        if (listed.ok) assert.ok(listed.data.sessions.length >= 2);
        const revoked = await accountSecurityService.revokeSession(ctx, 's2');
        assert.equal(revoked.ok, true);
        const begin = await accountSecurityService.beginTotpEnrollment(ctx);
        assert.equal(begin.ok, true);
        if (begin.ok) {
            const enrollKey = `enroll:${userId}:${begin.data.enrollmentId}`;
            const enroll = await kvGet('ba_account_mfa', enrollKey);
            assert.ok(enroll && typeof enroll === 'object' && enroll !== null);
            assert.ok('secret' in enroll);
            const secretRaw = Reflect.get(enroll, 'secret');
            assert.equal(typeof secretRaw, 'string');
            if (typeof secretRaw !== 'string') throw new Error('secret missing');
            const secret = secretRaw;
            const code = generateTotp(secret);
            const conf = await accountSecurityService.confirmTotpEnrollment(
                ctx,
                begin.data.enrollmentId,
                code,
            );
            assert.equal(conf.ok, true);
            // wrong code rejected after enroll complete
            await assert.rejects(
                async () => accountSecurityService.verifyMfaCode(ctx, '000000'),
            );
        }
    });
});

describe('phase4 secure worker registration', () => {
    it('accepts valid HMAC and rejects invalid', async () => {
        const machineId = 'm-sec-1';
        const challenge = issueWorkerRegistrationChallenge(machineId);
        const secret = 'test-crosshost-secret-32chars!!';
        const manifestHash = 'abc';
        const zeneVersion = '0.5.7';
        const bootGeneration = '1';
        const hmac = computeRegisterHmac(secret, {
            nonce: challenge.nonce,
            machineId,
            manifestHash,
            zeneVersion,
            bootGeneration,
        });
        const okReg = await secureRegisterWorker({
            challengeId: challenge.challengeId,
            machineId,
            endpoint: 'https://w.internal:8443',
            hmac,
            secret,
            manifestHash,
            zeneVersion,
            bootGeneration,
            generation: 1,
        });
        assert.equal(okReg.ok, true);

        const challenge2 = issueWorkerRegistrationChallenge('m-sec-2');
        const bad = await secureRegisterWorker({
            challengeId: challenge2.challengeId,
            machineId: 'm-sec-2',
            endpoint: 'https://evil:1',
            hmac: '00'.repeat(32),
            secret,
            manifestHash,
            zeneVersion,
            bootGeneration,
            generation: 1,
        });
        assert.equal(bad.ok, false);
    });
});

describe('phase4 job contention', () => {
    it('only one worker claims exclusive lease', async () => {
        const job = await createJob({
            type: 'test.contention',
            actorUserId: 'system',
            payload: {},
            maxAttempts: 3,
        });
        const a = await claimJob(job.jobId, 'worker-A');
        const b = await claimJob(job.jobId, 'worker-B');
        const winners = [a, b].filter((x) => x.ok);
        assert.equal(winners.length, 1);
        assert.equal(a.ok !== b.ok, true);
    });
});

describe('phase4 cutover BA-only', () => {
    it('rejects legacy dashSession when phase 4', async () => {
        setAuthCutoverPhase(4);
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity({
            headers: {},
            dashSession: {
                payload: { userId: 'legacy_user', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'j' },
            },
        });
        assert.equal(r.authority, 'none');
        setAuthCutoverPhase(2);
    });
});
