import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DashApiError } from './types.js';

describe('DashApiError', () => {
  it('classifies status helpers', () => {
    assert.equal(new DashApiError(401, 'AUTH_REQUIRED', 'x').isUnauthenticated, true);
    assert.equal(new DashApiError(403, 'FORBIDDEN', 'x').isForbidden, true);
    assert.equal(new DashApiError(404, 'NOT_FOUND', 'x').isNotFound, true);
    assert.equal(new DashApiError(409, 'CONFLICT', 'x').isConflict, true);
    assert.equal(new DashApiError(429, 'rate_limited', 'x').isRateLimited, true);
  });
});
