import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentTitle,
  getIdentity,
  identityFromApiPayload,
  setIdentity,
} from './store.js';
import { genericIdentityFallback } from './types.js';

describe('dynamic identity', () => {
  it('generic fallback does not use a fixed product brand', () => {
    const f = genericIdentityFallback();
    assert.equal(f.botName, 'Dashboard');
    assert.equal(f.botName.includes('Zene'), false);
  });

  it('document title uses runtime bot name', () => {
    setIdentity({ botName: 'ExampleBot' });
    assert.equal(getIdentity().botName, 'ExampleBot');
    assert.equal(documentTitle('Servers'), 'ExampleBot — Servers');
    assert.equal(documentTitle(), 'ExampleBot');
    assert.equal(documentTitle('Servers').includes('Zene'), false);
  });

  it('parses API payload without inventing Zene', () => {
    const id = identityFromApiPayload({
      botName: 'Acme Moderation',
      inviteUrl: 'https://example.com/invite',
    });
    assert.equal(id.botName, 'Acme Moderation');
    assert.equal(id.inviteUrl, 'https://example.com/invite');
  });
});
