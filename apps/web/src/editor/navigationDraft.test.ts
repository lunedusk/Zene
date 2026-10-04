import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addNavItem,
  draftFromItems,
  removeNavItem,
  renameNavItem,
  reorderNavItem,
  toNavOrder,
} from './navigationDraft.js';
import type { NavigationItem } from '../nav/types.js';

describe('navigation draft', () => {
  const base: NavigationItem[] = [
    { id: 'a', label: 'A', href: '/a', order: 10 },
    { id: 'b', label: 'B', href: '/b', order: 20 },
  ];

  it('add rename remove reorder', () => {
    let d = draftFromItems(base);
    d = addNavItem(d, { id: 'c', label: 'C', href: '/c', groupId: 'global' });
    assert.equal(d.items.length, 3);
    d = renameNavItem(d, 'c', 'Charlie');
    assert.equal(d.items.find((i) => i.id === 'c')?.label, 'Charlie');
    d = reorderNavItem(d, 'c', 0);
    assert.equal(toNavOrder(d)[0], 'c');
    d = removeNavItem(d, 'b');
    assert.equal(d.items.some((i) => i.id === 'b'), false);
    assert.equal(d.dirty, true);
  });
});
