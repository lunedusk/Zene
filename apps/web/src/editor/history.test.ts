import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from './history.js';

describe('editor history', () => {
  it('undo and redo', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    assert.equal(h.present, 3);
    assert.equal(canUndo(h), true);
    h = undo(h);
    assert.equal(h.present, 2);
    h = undo(h);
    assert.equal(h.present, 1);
    assert.equal(canUndo(h), false);
    h = redo(h);
    assert.equal(h.present, 2);
    assert.equal(canRedo(h), true);
  });
});
