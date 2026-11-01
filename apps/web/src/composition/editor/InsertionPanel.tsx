import { useMemo, useState } from 'react';
import type { CompositionEditorSession, EditorSessionSnapshot } from '../editorSession.js';
import { compositionRegistry, createDefaultNode } from '../registry.js';
import { insertNode } from '../operations.js';
import { resolveInsertionTarget, nodeLabel } from './workbenchHelpers.js';
import type { ComponentCategory, ComponentDefinition } from '../types.js';

export interface InsertionPanelProps {
  session: CompositionEditorSession;
  snapshot: EditorSessionSnapshot;
}

function matchesQuery(def: ComponentDefinition, q: string): boolean {
  if (!q) return true;
  const hay = [def.type, def.name, def.description ?? '', ...(def.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function InsertionPanel({ session, snapshot }: InsertionPanelProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory | 'all'>('all');
  const defs = useMemo(() => compositionRegistry.list(), []);
  const categories = useMemo(() => {
    const set = new Set<ComponentCategory>();
    for (const d of defs) set.add(d.category);
    return [...set].sort();
  }, [defs]);

  const filtered = defs.filter((d) => {
    if (d.rootOnly && snapshot.document.root.type !== d.type) {
      /* still show root-only for awareness but insert will fail if not appropriate */
    }
    if (category !== 'all' && d.category !== category) return false;
    return matchesQuery(d, query.trim().toLowerCase());
  });

  const insert = (type: string) => {
    const target = resolveInsertionTarget(
      snapshot.document,
      type,
      snapshot.selection,
    );
    if ('error' in target) {
      session.dispatch(() => ({
        ok: false,
        diagnostics: [{ severity: 'error', code: 'cannot_insert', message: target.error }],
      }));
      return;
    }
    const def = compositionRegistry.get(type);
    if (!def) return;
    const node = createDefaultNode(def);
    const result = session.dispatch((doc) =>
      insertNode(doc, target.parentId, target.slot, target.index, node),
    );
    if (result.ok) {
      session.select([node.id]);
    }
  };

  return (
    <div className="zc-editor-insert" aria-label="Insert components">
      <h3 className="zc-editor-panel-title">Components</h3>
      <input
        type="search"
        placeholder="Search components…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search components"
      />
      <div className="zc-editor-insert-filters" role="tablist">
        <button
          type="button"
          aria-selected={category === 'all'}
          onClick={() => setCategory('all')}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <ul className="zc-editor-insert-list">
        {filtered.map((def) => (
          <li key={def.type}>
            <button
              type="button"
              className="zc-editor-insert-item"
              onClick={() => insert(def.type)}
              disabled={snapshot.mode !== 'edit'}
              title={def.description ?? def.type}
            >
              <span className="zc-editor-insert-name">{def.name}</span>
              <span className="zc-editor-insert-type">{def.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
