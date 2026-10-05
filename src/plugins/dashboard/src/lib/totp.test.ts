import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateTotp,
    generateTotpSecret,
    verifyTotp,
    clearTotpReplayStateForTests,
    verifyTotpWithReplayProtection,
} from './totp.js';

describe('totp rfc6238', () => {
    it('generates and verifies current code', () => {
        const secret = generateTotpSecret();
        const code = generateTotp(secret);
        assert.equal(/^\d{6}$/.test(code), true);
        assert.equal(verifyTotp(secret, code), true);
    });

    it('rejects wrong code', () => {
        const secret = generateTotpSecret();
        assert.equal(verifyTotp(secret, '000000'), false);
    });

    it('rejects malformed code', () => {
        const secret = generateTotpSecret();
        assert.equal(verifyTotp(secret, 'abc'), false);
        assert.equal(verifyTotp(secret, ''), false);
    });

    it('rejects far out-of-window code', () => {
        const secret = generateTotpSecret();
        const past = generateTotp(secret, { nowMs: Date.now() - 10 * 60 * 1000 });
        assert.equal(verifyTotp(secret, past, { window: 1 }), false);
    });

    it('replay protection marks exact step', () => {
        clearTotpReplayStateForTests();
        const secret = generateTotpSecret();
        const code = generateTotp(secret);
        assert.equal(verifyTotpWithReplayProtection('u1', secret, code), true);


        assert.equal(verifyTotpWithReplayProtection('u1', secret, '111111'), false);
    });
});
