/**
 * Layout engine — pure functions for grid placement validation.
 * No third-party DnD library; CSS grid + explicit move/resize APIs.
 */

import type { Breakpoint, LayoutBreakpointState, WidgetInstance } from '../widgets/types.js';

export const BREAKPOINT_COLUMNS: Record<Breakpoint, number> = {
  desktop: 12,
  tablet: 8,
  mobile: 4,
};

export function createEmptyBreakpoint(breakpoint: Breakpoint): LayoutBreakpointState {
  return {
    breakpoint,
    columns: BREAKPOINT_COLUMNS[breakpoint],
    widgets: [],
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Detect overlap between two axis-aligned grid rectangles. */
export function overlaps(a: WidgetInstance, b: WidgetInstance): boolean {
  if (a.instanceId === b.instanceId) return false;
  const aRight = a.col + a.colSpan;
  const aBottom = a.row + a.rowSpan;
  const bRight = b.col + b.colSpan;
  const bBottom = b.row + b.rowSpan;
  return a.col < bRight && aRight > b.col && a.row < bBottom && aBottom > b.row;
}

export function validatePlacement(
  state: LayoutBreakpointState,
  candidate: WidgetInstance,
): { ok: true } | { ok: false; reason: string } {
  if (candidate.col < 0 || candidate.row < 0) {
    return { ok: false, reason: 'negative_origin' };
  }
  if (candidate.colSpan < 1 || candidate.rowSpan < 1) {
    return { ok: false, reason: 'invalid_span' };
  }
  if (candidate.col + candidate.colSpan > state.columns) {
    return { ok: false, reason: 'exceeds_columns' };
  }
  for (const w of state.widgets) {
    if (overlaps(candidate, w)) {
      return { ok: false, reason: 'overlap' };
    }
  }
  return { ok: true };
}

export function moveWidget(
  state: LayoutBreakpointState,
  instanceId: string,
  col: number,
  row: number,
): LayoutBreakpointState | null {
  const widgets = state.widgets.map((w) =>
    w.instanceId === instanceId ? { ...w, col, row } : w,
  );
  const candidate = widgets.find((w) => w.instanceId === instanceId);
  if (!candidate) return null;
  const next = { ...state, widgets };
  const v = validatePlacement(
    { ...next, widgets: next.widgets.filter((w) => w.instanceId !== instanceId) },
    candidate,
  );
  return v.ok ? next : null;
}

export function resizeWidget(
  state: LayoutBreakpointState,
  instanceId: string,
  colSpan: number,
  rowSpan: number,
): LayoutBreakpointState | null {
  const widgets = state.widgets.map((w) =>
    w.instanceId === instanceId ? { ...w, colSpan, rowSpan } : w,
  );
  const candidate = widgets.find((w) => w.instanceId === instanceId);
  if (!candidate) return null;
  const next = { ...state, widgets };
  const v = validatePlacement(
    { ...next, widgets: next.widgets.filter((w) => w.instanceId !== instanceId) },
    candidate,
  );
  return v.ok ? next : null;
}

export function addWidget(
  state: LayoutBreakpointState,
  widget: WidgetInstance,
): LayoutBreakpointState | null {
  const v = validatePlacement(state, widget);
  if (!v.ok) return null;
  return { ...state, widgets: [...state.widgets, widget] };
}

export function removeWidget(state: LayoutBreakpointState, instanceId: string): LayoutBreakpointState {
  return { ...state, widgets: state.widgets.filter((w) => w.instanceId !== instanceId) };
}

export function reorderWidget(
  state: LayoutBreakpointState,
  instanceId: string,
  toIndex: number,
): LayoutBreakpointState {
  const idx = state.widgets.findIndex((w) => w.instanceId === instanceId);
  if (idx < 0) return state;
  const widgets = [...state.widgets];
  const [item] = widgets.splice(idx, 1);
  if (!item) return state;
  widgets.splice(clamp(toIndex, 0, widgets.length), 0, item);
  return { ...state, widgets };
}
