import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    identityFromBetterAuthUser,
    registerBetterAuthSessionResolver,
    resolveSessionIdentity,
    type SessionIdentityRequest,
} from './sessionResolver.js';
import { bridgeAuthToZeneAuthorization, bridgedIdentityFromLegacyDashSession } from './authorizationBridge.js';

function fakeReq(partial: SessionIdentityRequest): SessionIdentityRequest {
    return {
        headers: partial.headers ?? {},
        dashSession: partial.dashSession,
    };
}

describe('sessionResolver', () => {
    it('returns none without credentials', async () => {
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity(fakeReq({ headers: {} }));
        assert.equal(r.authority, 'none');
        assert.equal(r.identity, null);
    });

    it('maps legacy dashSession payload', async () => {
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity(
            fakeReq({
                headers: {},
                dashSession: {
                    payload: {
                        userId: 'discord_1',
                        exp: Math.floor(Date.now() / 1000) + 3600,
                        jti: 'j1',
                    },
                },
            }),
        );
        assert.equal(r.authority, 'legacy_dash');
        assert.ok(r.identity);
        assert.equal(r.identity?.authorizationSubject, 'discord_1');
    });

    it('maps legacy dashSession even when Bearer is also present', async () => {
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity(
            fakeReq({
                headers: { authorization: 'Bearer legacy-token-value' },
                dashSession: {
                    payload: { userId: 'discord_2', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'j2' },
                },
            }),
        );
        assert.equal(r.authority, 'legacy_dash');
        assert.equal(r.identity?.authorizationSubject, 'discord_2');
    });

    it('returns none for Bearer without verified dashSession', async () => {
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity(
            fakeReq({ headers: { authorization: 'Bearer only-token' } }),
        );
        assert.equal(r.authority, 'none');
        assert.equal(r.identity, null);
    });

    it('prefers Better Auth resolver when registered', async () => {
        registerBetterAuthSessionResolver(async () =>
            identityFromBetterAuthUser({
                authUserId: 'ba_user',
                sessionId: 's1',
                expiresAt: Date.now() + 60_000,
                discordUserId: 'discord_9',
            }),
        );
        const r = await resolveSessionIdentity(fakeReq({ headers: {} }));
        assert.equal(r.authority, 'better_auth');
        assert.equal(r.identity?.authorizationSubject, 'discord_9');
        registerBetterAuthSessionResolver(null);
    });

    it('falls back to legacy when Better Auth resolver returns null', async () => {
        registerBetterAuthSessionResolver(async () => null);
        const r = await resolveSessionIdentity(
            fakeReq({
                headers: {},
                dashSession: {
                    payload: { userId: 'discord_3', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'j3' },
                },
            }),
        );
        assert.equal(r.authority, 'legacy_dash');
        assert.equal(r.identity?.authorizationSubject, 'discord_3');
        registerBetterAuthSessionResolver(null);
    });
});

describe('authorizationBridge integration', () => {
    it('rejects expired session', async () => {
        const identity = bridgedIdentityFromLegacyDashSession({
            userId: 'u1',
            sessionId: 's',
            expiresAt: Date.now() - 1000,
        });
        const r = await bridgeAuthToZeneAuthorization(identity);
        assert.equal('kind' in r && r.kind === 'expired', true);
    });
});
