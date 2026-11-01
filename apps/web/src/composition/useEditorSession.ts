import { useMemo, useSyncExternalStore } from 'react';
import type { CompositionEditorSession, EditorSessionSnapshot } from './editorSession.js';

/**
 * React adapter for CompositionEditorSession via useSyncExternalStore.
 * Does not mirror document or selection into separate React state.
 */
export function useEditorSession(session: CompositionEditorSession): {
  session: CompositionEditorSession;
  snapshot: EditorSessionSnapshot;
} {
  const subscribe = useMemo(() => session.subscribe, [session]);
  const getSnapshot = useMemo(() => session.getSnapshot, [session]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { session, snapshot };
}
