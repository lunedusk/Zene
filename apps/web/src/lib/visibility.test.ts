import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evalVisibility, filterNavigation, type NavigationItem, type VisibilityContext } from '../nav/types.js';

describe('visibility expressions', () => {
  const base: VisibilityContext = {
    authenticated: true,
    isOwner: false,
    bits: new Set(['bot.plugins.view']),
  };

  it('evaluates AND/OR/NOT and bit/owner', () => {
    assert.equal(evalVisibility({ type: 'bit', bit: 'bot.plugins.view' }, base), true);
    assert.equal(evalVisibility({ type: 'owner' }, base), false);
    assert.equal(
      evalVisibility(
        { type: 'and', of: [{ type: 'authenticated' }, { type: 'not', of: { type: 'owner' } }] },
        base,
      ),
      true,
    );
    assert.equal(
      evalVisibility({ type: 'or', of: [{ type: 'owner' }, { type: 'bit', bit: 'nope' }] }, base),
      false,
    );
  });

  it('filters navigation without leaving unauthorized entries', () => {
    const items: NavigationItem[] = [
      { id: 'a', label: 'A', href: '/a', visibility: { type: 'authenticated' } },
      { id: 'b', label: 'B', href: '/b', requiredBit: 'bot.servers.view' },
      { id: 'c', label: 'C', href: '/c', visibility: { type: 'owner' } },
    ];
    const filtered = filterNavigation(items, base);
    assert.deepEqual(
      filtered.map((i) => i.id),
      ['a'],
    );
  });
});
