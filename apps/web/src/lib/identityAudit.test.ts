import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findSuspiciousIdentityStrings, isAllowedTechnicalReference } from './identityAudit.js';

describe('identityAudit', () => {
  it('allows technical package identifiers', () => {
    assert.equal(isAllowedTechnicalReference('@lunedusk/zene-web'), true);
  });

  it('flags user-facing product name samples', () => {
    const hits = findSuspiciousIdentityStrings(['Welcome to Zene Dashboard', '@lunedusk/zene']);
    assert.equal(hits.some((h) => h.includes('Welcome')), true);
  });
});
