import type { CompositionEditorSession, EditorSessionSnapshot } from '../editorSession.js';
import { groupNodes, ungroupNode, duplicateNode } from '../operations.js';
import { removeNodesAtomic } from './workbenchHelpers.js';
import type { BreakpointId } from '../types.js';

export interface ToolbarProps {
  session: CompositionEditorSession;
  snapshot: EditorSessionSnapshot;
}

export function CompositionToolbar({ session, snapshot }: ToolbarProps) {
  const { document, selection, canUndo, canRedo, dirty, mode, breakpoint, primarySelection } =
    snapshot;
  const rootId = document.root.id;
  const removable = selection.filter((id) => id !== rootId);
  const canDelete = mode === 'edit' && removable.length > 0;
  const canDuplicate =
    mode === 'edit' && primarySelection !== null && primarySelection !== rootId;
  const canGroup = mode === 'edit' && removable.length >= 2;
  const canUngroup =
    mode === 'edit' &&
    primarySelection !== null &&
    document.root.id !== primarySelection &&
    (document.root.type === 'structure.container' || true); // validated by ungroupNode

  return (
    <div className="zc-editor-toolbar" role="toolbar" aria-label="Composition editor">
      <div className="zc-editor-toolbar-group">
        <span className="zc-editor-doc-name" title={document.name}>
          {document.name}
        </span>
        <span
          className={`zc-editor-dirty ${dirty ? 'is-dirty' : 'is-clean'}`}
          aria-label={dirty ? 'Unsaved changes' : 'Saved'}
        >
          {dirty ? '•' : '✓'}
        </span>
      </div>

      <div className="zc-editor-toolbar-group">
        <button type="button" disabled={!canUndo} onClick={() => session.undo()} title="Undo">
          Undo
        </button>
        <button type="button" disabled={!canRedo} onClick={() => session.redo()} title="Redo">
          Redo
        </button>
      </div>

      <div className="zc-editor-toolbar-group" role="group" aria-label="Mode">
        <button
          type="button"
          aria-pressed={mode === 'edit'}
          onClick={() => session.setMode('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          aria-pressed={mode === 'preview'}
          onClick={() => session.setMode('preview')}
        >
          Preview
        </button>
      </div>

      <div className="zc-editor-toolbar-group" role="group" aria-label="Breakpoint">
        {(['desktop', 'tablet', 'mobile'] as BreakpointId[]).map((bp) => (
          <button
            key={bp}
            type="button"
            aria-pressed={breakpoint === bp}
            onClick={() => session.setBreakpoint(bp)}
          >
            {bp}
          </button>
        ))}
      </div>

      <div className="zc-editor-toolbar-group">
        <button
          type="button"
          disabled={!canDelete}
          onClick={() => {
            session.dispatch((doc) => removeNodesAtomic(doc, selection));
          }}
          title="Delete selection"
        >
          Delete
        </button>
        <button
          type="button"
          disabled={!canDuplicate}
          onClick={() => {
            if (!primarySelection) return;
            session.dispatch((doc) => duplicateNode(doc, primarySelection));
          }}
          title="Duplicate"
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={!canGroup}
          onClick={() => {
            session.dispatch((doc) => groupNodes(doc, [...removable]));
          }}
          title="Group"
        >
          Group
        </button>
        <button
          type="button"
          disabled={!canUngroup || !primarySelection}
          onClick={() => {
            if (!primarySelection) return;
            session.dispatch((doc) => ungroupNode(doc, primarySelection));
          }}
          title="Ungroup"
        >
          Ungroup
        </button>
      </div>

      {selection.length > 0 && (
        <div className="zc-editor-toolbar-meta" aria-live="polite">
          {selection.length} selected
        </div>
      )}
    </div>
  );
}
