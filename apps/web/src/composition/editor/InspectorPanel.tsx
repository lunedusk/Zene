import type { CompositionEditorSession, EditorSessionSnapshot } from '../editorSession.js';
import { compositionRegistry } from '../registry.js';
import { findNode, setNodeProp, setNodeFlag, renameNode, setNodeA11y } from '../operations.js';
import type {
  CompositionNode,
  JsonValue,
  PropertyControl,
  PropertySchema,
} from '../types.js';
import { nodeLabel } from './workbenchHelpers.js';

export interface InspectorPanelProps {
  session: CompositionEditorSession;
  snapshot: EditorSessionSnapshot;
}

function readProp(node: CompositionNode, key: string): JsonValue | undefined {
  return node.props[key] as JsonValue | undefined;
}

function PropertyField({
  nodeId,
  def,
  value,
  session,
}: {
  nodeId: string;
  def: PropertySchema;
  value: JsonValue | undefined;
  session: CompositionEditorSession;
}) {
  const control: PropertyControl = def.control;
  const coalesceKey = `prop:${nodeId}:${def.key}`;

  const commit = (next: JsonValue | undefined) => {
    session.dispatch((doc) => setNodeProp(doc, nodeId, def.key, next as never), {
      coalesceKey: control === 'text' || control === 'textarea' || control === 'markdown' ? coalesceKey : undefined,
    });
  };

  const commonLabel = (
    <span className="zc-inspector-label" title={def.description}>
      {def.label ?? def.key}
      {def.required ? ' *' : ''}
    </span>
  );

  switch (control) {
    case 'text':
    case 'url':
    case 'image-url':
      return (
        <label className="zc-inspector-field">
          {commonLabel}
          <input
            type={control === 'url' || control === 'image' ? 'url' : 'text'}
            value={typeof value === 'string' ? value : ''}
            placeholder={def.placeholder}
            onChange={(e) => commit(e.target.value)}
          />
        </label>
      );
    case 'textarea':
    case 'markdown':
      return (
        <label className="zc-inspector-field">
          {commonLabel}
          <textarea
            value={typeof value === 'string' ? value : ''}
            placeholder={def.placeholder}
            rows={4}
            onChange={(e) => commit(e.target.value)}
          />
        </label>
      );
    case 'number':
    case 'range':
      return (
        <label className="zc-inspector-field">
          {commonLabel}
          <input
            type={control === 'range' ? 'range' : 'number'}
            value={typeof value === 'number' ? value : Number(def.defaultValue ?? 0)}
            min={def.min}
            max={def.max}
            step={def.step}
            onChange={(e) => commit(Number(e.target.value))}
          />
        </label>
      );
    case 'boolean':
      return (
        <label className="zc-inspector-field zc-inspector-boolean">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => commit(e.target.checked)}
          />
          {commonLabel}
        </label>
      );
    case 'select':
      return (
        <label className="zc-inspector-field">
          {commonLabel}
          <select
            value={typeof value === 'string' ? value : String(def.defaultValue ?? '')}
            onChange={(e) => commit(e.target.value)}
          >
            {(def.options ?? []).map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'color':
      return (
        <label className="zc-inspector-field">
          {commonLabel}
          <input
            type="color"
            value={typeof value === 'string' && value ? value : '#000000'}
            onChange={(e) => commit(e.target.value)}
          />
        </label>
      );
    case 'list':
      return (
        <div className="zc-inspector-field">
          {commonLabel}
          <p className="zc-inspector-unsupported">
            List editing for “{def.key}” is available via structured updates; use a dedicated list
            editor in a later increment if needed.
          </p>
        </div>
      );
    default:
      return (
        <div className="zc-inspector-field">
          {commonLabel}
          <p className="zc-inspector-unsupported">Unsupported control: {String(control)}</p>
        </div>
      );
  }
}

export function InspectorPanel({ session, snapshot }: InspectorPanelProps) {
  const id = snapshot.primarySelection;
  if (!id) {
    return (
      <div className="zc-editor-inspector">
        <h3 className="zc-editor-panel-title">Inspector</h3>
        <p className="zc-editor-empty">Select a node to inspect.</p>
      </div>
    );
  }
  const node = findNode(snapshot.document, id);
  if (!node) {
    return (
      <div className="zc-editor-inspector">
        <h3 className="zc-editor-panel-title">Inspector</h3>
        <p className="zc-editor-empty">Selected node is no longer in the document.</p>
      </div>
    );
  }
  const def = compositionRegistry.get(node.type);
  const schema = def?.schema ?? [];
  const groups = new Map<string, PropertySchema[]>();
  for (const prop of schema) {
    const g = prop.group ?? 'content';
    const list = groups.get(g) ?? [];
    list.push(prop);
    groups.set(g, list);
  }

  return (
    <div className="zc-editor-inspector" aria-label="Inspector">
      <h3 className="zc-editor-panel-title">Inspector</h3>
      <div className="zc-inspector-header">
        <strong>{nodeLabel(node, def)}</strong>
        <code>{node.type}</code>
      </div>
      <label className="zc-inspector-field">
        <span className="zc-inspector-label">Label</span>
        <input
          type="text"
          value={node.label ?? ''}
          onChange={(e) =>
            session.dispatch((doc) => renameNode(doc, id, e.target.value), {
              coalesceKey: `rename:${id}`,
            })
          }
        />
      </label>
      <div className="zc-inspector-flags">
        <label>
          <input
            type="checkbox"
            checked={!!node.hidden}
            onChange={(e) =>
              session.dispatch((doc) => setNodeFlag(doc, id, 'hidden', e.target.checked))
            }
          />
          Hidden
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!node.locked}
            onChange={(e) =>
              session.dispatch((doc) => setNodeFlag(doc, id, 'locked', e.target.checked))
            }
          />
          Locked
        </label>
      </div>
      {[...groups.entries()].map(([group, props]) => (
        <fieldset key={group} className="zc-inspector-group">
          <legend>{group}</legend>
          {props.map((prop) => (
            <PropertyField
              key={prop.key}
              nodeId={id}
              def={prop}
              value={readProp(node, prop.key)}
              session={session}
            />
          ))}
        </fieldset>
      ))}
      <fieldset className="zc-inspector-group">
        <legend>Accessibility</legend>
        <label className="zc-inspector-field">
          <span className="zc-inspector-label">ARIA label</span>
          <input
            type="text"
            value={node.a11y?.label ?? ''}
            onChange={(e) =>
              session.dispatch(
                (doc) => setNodeA11y(doc, id, { ...node.a11y, label: e.target.value }),
                { coalesceKey: `a11y:${id}:label` },
              )
            }
          />
        </label>
      </fieldset>
      {snapshot.diagnostics.length > 0 && (
        <div className="zc-inspector-diagnostics" role="status">
          {snapshot.diagnostics.map((d, i) => (
            <p key={`${d.code}-${i}`}>
              <strong>{d.code}</strong>: {d.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
