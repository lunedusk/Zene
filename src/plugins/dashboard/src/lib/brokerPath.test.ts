import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    normalizeApiPath,
    pathMatchesAllowPattern,
    assertPathAllowed,
    PathAllowError,
} from './brokerPath.js';

const FOO_PATTERNS = ['/api/dash/plugins/foo', '/api/dash/plugins/foo/*'];

test('normalize rejects traversal', () => {
    assert.throws(() => normalizeApiPath('/api/dash/plugins/foo/../../etc/passwd'), PathAllowError);
    assert.throws(() => normalizeApiPath('/api/dash/plugins/foo/%2e%2e/%2e%2e/etc'), PathAllowError);
});

test('prefix trick foobar does not match foo/*', () => {
    const n = normalizeApiPath('/api/dash/plugins/foobar');
    assert.equal(pathMatchesAllowPattern(n, '/api/dash/plugins/foo/*'), false);
    assert.equal(pathMatchesAllowPattern(n, '/api/dash/plugins/foo'), false);
});

test('foo/config matches foo/*', () => {
    const n = normalizeApiPath('/api/dash/plugins/foo/config');
    assert.equal(pathMatchesAllowPattern(n, '/api/dash/plugins/foo/*'), true);
});

test('assertPathAllowed accepts nested under foo', () => {
    const n = assertPathAllowed('/api/dash/plugins/foo/x/y', FOO_PATTERNS);
    assert.equal(n, '/api/dash/plugins/foo/x/y');
});

test('assertPathAllowed rejects outside allowlist', () => {
    assert.throws(() => assertPathAllowed('/api/dash/plugins/other/x', FOO_PATTERNS), (e: unknown) => {
        return e instanceof PathAllowError && e.code === 'not_allowed';
    });
});

test('assertPathAllowed rejects encoded slash traversal style', () => {
    assert.throws(() => assertPathAllowed('/api/dash/plugins/foo/%2e%2e/bar', FOO_PATTERNS), PathAllowError);
});

test('grants capability check shape', async () => {
    const { hasCapability, computeSurfaceGrants } = await import('./brokerGrants.js');
    const grants = computeSurfaceGrants({
        bits: new Set(['bot.plugins.view']),
        userId: 'u1',
        isEnvOwner: false,
        pluginId: 'foo',
        surface: {
            id: 's1',
            kind: 'page',
            tier: 2,
            title: 't',
            visibility: { requiredBits: ['bot.plugins.view'], bitsMode: 'all' },
        },
    });
    assert.ok(hasCapability(grants.capabilities, 'api.read'));
    assert.equal(hasCapability(grants.capabilities, 'api.write'), true);
    assert.ok(!hasCapability(grants.capabilities, 'missing.cap'));
});

test('missing read bits yields empty grants', async () => {
    const { computeSurfaceGrants } = await import('./brokerGrants.js');
    const grants = computeSurfaceGrants({
        bits: new Set(['bot.logs.view']),
        userId: 'u1',
        isEnvOwner: false,
        pluginId: 'foo',
        surface: {
            id: 's1',
            kind: 'page',
            tier: 1,
            title: 't',
            visibility: { requiredBits: ['bot.plugins.manage'] },
        },
    });
    assert.equal(grants.capabilities.length, 0);
});
