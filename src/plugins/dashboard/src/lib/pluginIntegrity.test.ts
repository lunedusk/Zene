import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePluginIntegrity } from './pluginIntegrity.js';

describe('pluginIntegrity', () => {
    it('accepts trusted plugin', () => {
        const r = evaluatePluginIntegrity({
            pluginId: 'moderation',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            requiredSdkRange: '2.0.0',
            signatureValid: true,
        });
        assert.equal(r.state, 'trusted');
        assert.equal(r.acceptContributions, true);
    });

    it('rejects hash mismatch', () => {
        const r = evaluatePluginIntegrity({
            pluginId: 'x',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            manifestHash: 'aaa',
            expectedManifestHash: 'bbb',
        });
        assert.equal(r.state, 'invalid');
        assert.equal(r.acceptContributions, false);
    });

    it('rejects quarantined', () => {
        const r = evaluatePluginIntegrity({
            pluginId: 'x',
            pluginVersion: '1.0.0',
            zeneVersion: '0.5.7',
            sdkVersion: '2.0.0',
            quarantined: true,
        });
        assert.equal(r.state, 'quarantined');
    });
});
