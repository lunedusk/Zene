import { useEffect, useRef } from 'react';
import type { CompositionDocument } from './types.js';
import type { CompositionEditorSession, EditorSessionSnapshot } from './editorSession.js';
import { useEditorSession } from './useEditorSession.js';
import { CompositionRenderer } from './renderer.js';
import { CompositionToolbar } from './editor/Toolbar.js';
import { InsertionPanel } from './editor/InsertionPanel.js';
import { LayersPanel } from './editor/LayersPanel.js';
import { InspectorPanel } from './editor/InspectorPanel.js';
import { removeNodesAtomic } from './editor/workbenchHelpers.js';
import { duplicateNode } from './operations.js';
import { registerBuiltinComponents } from './builtins/index.js';

registerBuiltinComponents();

export interface CompositionEditorProps {
  session: CompositionEditorSession;
  /** Integration hook only — not persistence. */
  onDocumentChange?: (document: CompositionDocument, snapshot: EditorSessionSnapshot) => void;
  className?: string;
}

const BREAKPOINT_WIDTH: Record<string, number> = {
  desktop: 1200,
  tablet: 768,
  mobile: 390,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Reusable canonical composition workbench.
 * Owns no session of its own — callers pass a CompositionEditorSession.
 */
export function CompositionEditor({
  session,
  onDocumentChange,
  className,
}: CompositionEditorProps) {
  const { snapshot } = useEditorSession(session);
  const lastDocRef = useRef(snapshot.document);

  useEffect(() => {
    if (Object.is(lastDocRef.current, snapshot.document)) return;
    lastDocRef.current = snapshot.document;
    onDocumentChange?.(snapshot.document, snapshot);
  }, [snapshot, onDocumentChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') {
        session.clearSelection();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && snapshot.mode === 'edit') {
        event.preventDefault();
        session.dispatch((doc) => removeNodesAtomic(doc, snapshot.selection));
        return;
      }
      if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        session.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        session.redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd' && snapshot.primarySelection) {
        if (snapshot.primarySelection === snapshot.document.root.id) return;
        event.preventDefault();
        session.dispatch((doc) => duplicateNode(doc, snapshot.primarySelection!));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, snapshot.mode, snapshot.selection, snapshot.primarySelection, snapshot.document.root.id]);

  const canvasWidth = BREAKPOINT_WIDTH[snapshot.breakpoint] ?? 1200;
  const renderMode = snapshot.mode === 'preview' ? 'preview' : 'editor';

  return (
    <div className={`zc-composition-editor ${className ?? ''}`.trim()}>
      <CompositionToolbar session={session} snapshot={snapshot} />
      <div className="zc-editor-body">
        <aside className="zc-editor-left" aria-label="Library and layers">
          <InsertionPanel session={session} snapshot={snapshot} />
          <LayersPanel session={session} snapshot={snapshot} />
        </aside>
        <main className="zc-editor-canvas-wrap">
          <div
            className="zc-editor-canvas"
            style={{ maxWidth: canvasWidth, margin: '0 auto' }}
            data-breakpoint={snapshot.breakpoint}
            data-mode={renderMode}
          >
            <CompositionRenderer
              document={snapshot.document}
              mode={renderMode}
              breakpoint={snapshot.breakpoint}
              selectedNodeIds={snapshot.selection}
              selectedNodeId={snapshot.primarySelection ?? undefined}
              onSelectNode={(nodeId, mode) => {
                if (mode === 'toggle') session.toggleSelection(nodeId);
                else session.select([nodeId]);
              }}
              onHoverNode={(id) => session.hover(id)}
            />
          </div>
          {snapshot.diagnostics.length > 0 && (
            <div className="zc-editor-diagnostics" role="status">
              {snapshot.diagnostics.map((d, i) => (
                <div key={`${d.code}-${i}`}>
                  {d.severity}: {d.message}
                </div>
              ))}
            </div>
          )}
        </main>
        <aside className="zc-editor-right" aria-label="Inspector">
          <InspectorPanel session={session} snapshot={snapshot} />
        </aside>
      </div>
    </div>
  );
}

export default CompositionEditor;
