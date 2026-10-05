import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addWidget,
  createEmptyBreakpoint,
  moveWidget,
  overlaps,
  removeWidget,
  resizeWidget,
  validatePlacement,
} from './engine.js';
import type { WidgetInstance } from '../widgets/types.js';

function w(partial: Partial<WidgetInstance> & Pick<WidgetInstance, 'instanceId'>): WidgetInstance {
  return {
    instanceId: partial.instanceId,
    widgetId: partial.widgetId ?? 'x',
    definition: partial.definition ?? { id: 'x', type: 'status', title: 'X' },
    col: partial.col ?? 0,
    row: partial.row ?? 0,
    colSpan: partial.colSpan ?? 2,
    rowSpan: partial.rowSpan ?? 1,
  };
}

describe('layout engine', () => {
  it('detects overlap and rejects invalid placement', () => {
    const a = w({ instanceId: 'a', col: 0, row: 0, colSpan: 4 });
    const b = w({ instanceId: 'b', col: 2, row: 0, colSpan: 4 });
    assert.equal(overlaps(a, b), true);
    const state = createEmptyBreakpoint('desktop');
    state.widgets = [a];
    const v = validatePlacement(state, b);
    assert.equal(v.ok, false);
  });

  it('adds, moves, resizes, removes', () => {
    let state = createEmptyBreakpoint('desktop');
    const a = w({ instanceId: 'a', col: 0, row: 0, colSpan: 2 });
    const added = addWidget(state, a);
    assert.ok(added);
    state = added!;
    const moved = moveWidget(state, 'a', 2, 0);
    assert.ok(moved);
    assert.equal(moved!.widgets[0]?.col, 2);
    const resized = resizeWidget(moved!, 'a', 3, 2);
    assert.ok(resized);
    assert.equal(resized!.widgets[0]?.colSpan, 3);
    const removed = removeWidget(resized!, 'a');
    assert.equal(removed.widgets.length, 0);
  });

  it('rejects span beyond columns', () => {
    const state = createEmptyBreakpoint('mobile');
    const big = w({ instanceId: 'big', col: 0, colSpan: 8 });
    assert.equal(validatePlacement(state, big).ok, false);
  });
});
