import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mintPreviewToken, validatePreviewToken, hashPreviewToken } from './previewToken.js';

describe('previewToken', () => {
    const secret = 'test-preview-secret-32chars-min!!';

    it('mints and validates', () => {
        const { token, claims, tokenHash } = mintPreviewToken(secret, {
            overrideId: 'ovr_1',
            targetKind: 'layout',
            targetKey: 'global',
            authorUserId: 'u1',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        assert.equal(typeof token, 'string');
        assert.equal(tokenHash, hashPreviewToken(token));
        const v = validatePreviewToken(secret, token);
        assert.equal(v.ok, true);
        if (v.ok) {
            assert.equal(v.claims.overrideId, 'ovr_1');
            assert.equal(v.claims.nonce, claims.nonce);
        }
    });

    it('rejects bad signature', () => {
        const { token } = mintPreviewToken(secret, {
            overrideId: 'ovr_1',
            targetKind: 'layout',
            targetKey: 'global',
            authorUserId: 'u1',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        const v = validatePreviewToken(secret, token + 'x');
        assert.equal(v.ok, false);
        if (!v.ok) assert.equal(v.reason, 'bad_signature');
    });

    it('rejects expired', () => {
        const { token } = mintPreviewToken(secret, {
            overrideId: 'ovr_1',
            targetKind: 'layout',
            targetKey: 'global',
            authorUserId: 'u1',
            exp: Math.floor(Date.now() / 1000) - 10,
        });
        const v = validatePreviewToken(secret, token);
        assert.equal(v.ok, false);
        if (!v.ok) assert.equal(v.reason, 'expired');
    });
});
