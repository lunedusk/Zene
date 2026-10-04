/**
 * Editor-local undo/redo — distinct from server immutable versions.
 */

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(state: HistoryState<T>, next: T, limit = 100): HistoryState<T> {
  if (Object.is(state.present, next)) return state;
  const past = [...state.past, state.present];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) return state;
  const past = [...state.past];
  const present = past.pop() as T;
  return { past, present, future: [state.present, ...state.future] };
}

export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) return state;
  const [present, ...future] = state.future;
  return { past: [...state.past, state.present], present: present as T, future };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
