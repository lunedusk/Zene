import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eventInvalidationKeys, type DashboardEvent } from './sseClient.js';

describe('realtime invalidation', () => {
  it('maps registry and resource keys', () => {
    const event: DashboardEvent = {
      eventId: 'e1',
      type: 'registry.updated',
      resource: { type: 'surface', id: 's1', guildId: 'g1' },
    };
    const keys = eventInvalidationKeys(event);
    assert.ok(keys.includes('registry'));
    assert.ok(keys.includes('guild:g1'));
    assert.ok(keys.includes('resource:surface:s1'));
  });
});
