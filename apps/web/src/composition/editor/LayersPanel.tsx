import { useState } from 'react';
import type { CompositionNode } from '../types.js';
import type { CompositionEditorSession, EditorSessionSnapshot } from '../editorSession.js';
import { compositionRegistry } from '../registry.js';
import { renameNode, setNodeFlag } from '../operations.js';
import { nodeLabel } from './workbenchHelpers.js';

export interface LayersPanelProps {
  session: CompositionEditorSession;
  snapshot: EditorSessionSnapshot;
}

function LayerRow({
  node,
  depth,
  session,
  snapshot,
  expanded,
  toggle,
}: {
  node: CompositionNode;
  depth: number;
  session: CompositionEditorSession;
  snapshot: EditorSessionSnapshot;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const def = compositionRegistry.get(node.type);
  const selected = snapshot.selection.includes(node.id);
  const hovered = snapshot.hoveredNodeId === node.id;
  const hasChildren = Object.values(node.slots ?? {}).some((c) => c.length > 0);
  const isOpen = expanded.has(node.id);

  return (
    <li>
      <div
        className={`zc-layer-row${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={(e) => {
          session.select(
            e.shiftKey
              ? selected
                ? snapshot.selection.filter((id) => id !== node.id)
                : [...snapshot.selection, node.id]
              : [node.id],
          );
        }}
        onMouseEnter={() => session.hover(node.id)}
        onMouseLeave={() => session.clearHover()}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            className="zc-layer-toggle"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="zc-layer-toggle-spacer" />
        )}
        <span className="zc-layer-label">{nodeLabel(node, def)}</span>
        <span className="zc-layer-type">{node.type.split('.').pop()}</span>
        <button
          type="button"
          className="zc-layer-flag"
          title={node.hidden ? 'Show' : 'Hide'}
          onClick={(e) => {
            e.stopPropagation();
            session.dispatch((doc) => setNodeFlag(doc, node.id, 'hidden', !node.hidden));
          }}
        >
          {node.hidden ? '○' : '●'}
        </button>
        <button
          type="button"
          className="zc-layer-flag"
          title={node.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            session.dispatch((doc) => setNodeFlag(doc, node.id, 'locked', !node.locked));
          }}
        >
          {node.locked ? '🔒' : '🔓'}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul role="group">
          {Object.entries(node.slots ?? {}).flatMap(([slot, children]) =>
            children.map((child) => (
              <LayerRow
                key={child.id}
                node={child}
                depth={depth + 1}
                session={session}
                snapshot={snapshot}
                expanded={expanded}
                toggle={toggle}
              />
            )),
          )}
        </ul>
      )}
    </li>
  );
}

export function LayersPanel({ session, snapshot }: LayersPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([snapshot.document.root.id]));
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const primary = snapshot.primarySelection;
  const primaryNode = primary
    ? // walk
      (function find(n: CompositionNode): CompositionNode | null {
        if (n.id === primary) return n;
        for (const ch of Object.values(n.slots ?? {}).flat()) {
          const hit = find(ch);
          if (hit) return hit;
        }
        return null;
      })(snapshot.document.root)
    : null;

  return (
    <div className="zc-editor-layers" aria-label="Layers">
      <h3 className="zc-editor-panel-title">Layers</h3>
      {primaryNode && (
        <label className="zc-layer-rename">
          Rename
          <input
            type="text"
            value={primaryNode.label ?? ''}
            placeholder="Label"
            onChange={(e) => {
              const value = e.target.value;
              session.dispatch((doc) => renameNode(doc, primaryNode.id, value), {
                coalesceKey: `rename:${primaryNode.id}`,
              });
            }}
          />
        </label>
      )}
      <ul role="tree" className="zc-layer-tree">
        <LayerRow
          node={snapshot.document.root}
          depth={0}
          session={session}
          snapshot={snapshot}
          expanded={expanded}
          toggle={toggle}
        />
      </ul>
    </div>
  );
}
