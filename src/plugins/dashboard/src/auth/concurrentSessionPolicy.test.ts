import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CONCURRENT_SESSION_POLICY,
    sessionsToRevokeForCap,
    shouldRevokeOthersOnSecurityEvent,
} from './concurrentSessionPolicy.js';

describe('concurrent session policy', () => {
    it('documents multi-device allowed with soft cap', () => {
        assert.equal(CONCURRENT_SESSION_POLICY.maxActiveSessionsPerUser, 10);
        assert.equal(CONCURRENT_SESSION_POLICY.betterAuthOwnsTtl, true);
        assert.equal(CONCURRENT_SESSION_POLICY.zeneDoesNotOwnUserSessionStore, true);
    });

    it('revokes oldest when over cap, keeps current', () => {
        const sessions = [
            { sessionId: 's1', createdAt: 1 },
            { sessionId: 's2', createdAt: 2 },
            { sessionId: 's3', createdAt: 3 },
            { sessionId: 's4', createdAt: 4 },
        ];
        const revoke = sessionsToRevokeForCap(sessions, 2, 's4');
        assert.ok(revoke.includes('s1'));
        assert.ok(revoke.includes('s2'));
        assert.ok(!revoke.includes('s4'));
        assert.ok(!revoke.includes('s3'));
    });

    it('unlimited when maxActive is 0', () => {
        assert.deepEqual(
            sessionsToRevokeForCap([{ sessionId: 'a', createdAt: 1 }], 0),
            [],
        );
    });

    it('security events revoke others per policy', () => {
        assert.equal(shouldRevokeOthersOnSecurityEvent('password_change'), true);
        assert.equal(shouldRevokeOthersOnSecurityEvent('mfa_change'), true);
        assert.equal(shouldRevokeOthersOnSecurityEvent('compromise'), true);
    });
});
