import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildBridgedIdentity,
    bridgedIdentityFromLegacyDashSession,
    resolveAuthorizationSubject,
} from './authorizationBridge.js';
import { discordIdentity } from '#core/types/identity.js';

describe('authorizationBridge', () => {
    it('prefers discord subject for authorization', () => {
        const r = resolveAuthorizationSubject('auth_1', [discordIdentity('discord_99')]);
        assert.equal(r.subject, 'discord_99');
        assert.equal(r.via, 'discord');
    });

    it('falls back to auth user id without discord', () => {
        const r = resolveAuthorizationSubject('auth_1', []);
        assert.equal(r.subject, 'auth_1');
        assert.equal(r.via, 'auth_user');
    });

    it('builds bridged identity with discord link', () => {
        const id = buildBridgedIdentity({
            authUserId: 'auth_1',
            discordUserId: 'd1',
            session: {
                sessionId: 's1',
                userId: 'auth_1',
                expiresAt: Date.now() + 60_000,
            },
        });
        assert.equal(id.authorizationSubject, 'd1');
        assert.equal(id.identities.some((i) => i.provider === 'discord'), true);
    });

    it('maps legacy dash session to bridge identity', () => {
        const id = bridgedIdentityFromLegacyDashSession({
            userId: '123456',
            sessionId: 'jti-1',
            expiresAt: Date.now() + 1000,
        });
        assert.equal(id.authorizationSubject, '123456');
        assert.equal(id.session.provider, 'discord');
    });
});
