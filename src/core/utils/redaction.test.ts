



import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveData } from './redaction.js';

describe('redactSensitiveData', () => {
    it('redacts nested sensitive keys', () => {
        const out = redactSensitiveData({
            user: 'alice',
            password: 'super-secret',
            nested: { access_token: 'tok_abc', ok: true },
            list: [{ refresh_token: 'r1' }, { id: 1 }],
        }) as {
            user: string;
            password: unknown;
            nested: { access_token: unknown; ok: boolean };
            list: Array<{ refresh_token?: unknown; id?: number }>;
        };
        assert.equal(out.user, 'alice');
        assert.equal(out.nested.ok, true);
        assert.equal(out.list[1]?.id, 1);
        assert.notEqual(out.password, 'super-secret');
        assert.notEqual(out.nested.access_token, 'tok_abc');
        assert.notEqual(out.list[0]?.refresh_token, 'r1');
    });

    it('redacts Bearer and JWT-shaped strings', () => {
        const out = redactSensitiveData({
            msg: 'Authorization: Bearer abc.def.ghi.jkl',
            jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart',
        }) as { msg: string; jwt: string };
        assert.match(out.msg, /REDACTED/);
        assert.doesNotMatch(out.msg, /abc\.def/);
        assert.match(out.jwt, /REDACTED/);
    });

    it('does not log plaintext session tokens under safe keys', () => {
        const out = redactSensitiveData({
            detail: 'session_token=deadbeefcafebabe',
        }) as { detail: string };
        assert.match(out.detail, /REDACTED/);
        assert.doesNotMatch(out.detail, /deadbeef/);
    });
});
