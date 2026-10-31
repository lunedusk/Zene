import type { ComponentDefinition, JsonObject } from '../types.js';
import { NodeFrame } from '../NodeFrame.js';
import type { BindingResult, NodeRenderProps } from '../runtime.js';
import { asString, listItems, safeString } from './define.js';
import { BINDING_PROVIDERS, coerceBindingValue } from '../bindings.js';

const providerOptions = BINDING_PROVIDERS.map((provider) => ({
  value: provider.id,
  label: provider.label,
}));

function bindingProps(props: JsonObject): { provider: string; resource?: string; field?: string } {
  const provider = asString(props.provider, 'public.stats');
  const resource = asString(props.resource);
  const field = asString(props.field);
  return {
    provider,
    resource: resource || undefined,
    field: field || undefined,
  };
}

function useDisplay(runtime: NodeRenderProps['runtime'], props: JsonObject): {
  result: BindingResult;
  text: string;
} {
  const binding = bindingProps(props);
  const result = runtime.binding(binding);
  const text = coerceBindingValue(binding.provider, result.value, binding.field);
  return { result, text };
}

function DataPlaceholder({ nodeId, message }: { nodeId: string; message: string }) {
  return (
    <div data-node-id={nodeId} className="zc-data-placeholder" role="status">
      {message}
    </div>
  );
}

const stat: ComponentDefinition = {
  type: 'data.stat',
  version: 1,
  name: 'Live statistic',
  description: 'Server-resolved metric sourced from an approved dashboard provider.',
  category: 'data',
  keywords: ['stat', 'metric', 'binding', 'live', 'count'],
  defaults: {
    label: 'Servers',
    provider: 'public.stats',
    resource: 'stats',
    field: 'servers',
    prefix: '',
    suffix: '',
    hint: '',
  },
  schema: [
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    { key: 'provider', label: 'Data provider', group: 'data', control: 'select', options: providerOptions },
    { key: 'resource', label: 'Resource', group: 'data', control: 'text' },
    { key: 'field', label: 'Field', group: 'data', control: 'text', required: true },
    { key: 'prefix', label: 'Prefix', group: 'content', control: 'text' },
    { key: 'suffix', label: 'Suffix', group: 'content', control: 'text' },
    { key: 'hint', label: 'Hint', group: 'content', control: 'text' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const { result, text } = useDisplay(runtime, props);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-stat">
        <span className="zc-stat-label">{asString(props.label)}</span>
        {result.status === 'ready' ? (
          <span className="zc-stat-value">
            {asString(props.prefix)}
            {text || '—'}
            {asString(props.suffix)}
          </span>
        ) : (
          <span className={`zc-stat-value zc-stat-${result.status}`}>
            {result.status === 'loading' || result.status === 'idle' ? '…' : '—'}
          </span>
        )}
        {asString(props.hint) ? <span className="zc-stat-hint">{asString(props.hint)}</span> : null}
        {result.status === 'error' ? <span className="zc-stat-hint">Live value unavailable</span> : null}
      </NodeFrame>
    );
  },
};

const boundText: ComponentDefinition = {
  type: 'data.boundText',
  version: 1,
  name: 'Bound text',
  description: 'Inline text resolved from an approved provider with fallback copy.',
  category: 'data',
  keywords: ['binding', 'text', 'live', 'dynamic'],
  defaults: {
    provider: 'public.site',
    resource: 'site',
    field: 'title',
    template: '{value}',
    fallback: 'Zene',
  },
  schema: [
    { key: 'provider', label: 'Data provider', group: 'data', control: 'select', options: providerOptions },
    { key: 'resource', label: 'Resource', group: 'data', control: 'text' },
    { key: 'field', label: 'Field', group: 'data', control: 'text', required: true },
    { key: 'template', label: 'Template', group: 'content', control: 'text', description: 'Use {value} where the resolved value belongs.' },
    { key: 'fallback', label: 'Fallback', group: 'content', control: 'text' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const { result, text } = useDisplay(runtime, props);
    const template = asString(props.template, '{value}');
    const value = result.status === 'ready' && text ? text : asString(props.fallback);
    return (
      <NodeFrame as="p" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-bound-text">
        {template.includes('{value}') ? template.split('{value}').join(value) : `${template}${value}`}
      </NodeFrame>
    );
  },
};

const table: ComponentDefinition = {
  type: 'data.table',
  version: 1,
  name: 'Data table',
  description: 'Read-only table rendered from a list-valued provider field.',
  category: 'data',
  keywords: ['table', 'rows', 'data', 'binding', 'list'],
  defaults: {
    title: '',
    provider: 'public.commands',
    resource: 'catalog',
    field: 'commands',
    emptyText: 'No rows available.',
    columns: [{ key: 'name', label: 'Name' }],
  },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    { key: 'provider', label: 'Data provider', group: 'data', control: 'select', options: providerOptions },
    { key: 'resource', label: 'Resource', group: 'data', control: 'text' },
    { key: 'field', label: 'List field', group: 'data', control: 'text', required: true },
    { key: 'emptyText', label: 'Empty message', group: 'content', control: 'text' },
    {
      key: 'columns',
      label: 'Columns',
      group: 'content',
      control: 'list',
      maxItems: 8,
      itemDefault: { key: 'name', label: 'Name' },
      itemFields: [
        { key: 'key', label: 'Item key', control: 'text', required: true },
        { key: 'label', label: 'Heading', control: 'text', required: true },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const binding = bindingProps(props);
    const result = runtime.binding(binding);
    const rows = Array.isArray(result.value) ? listItems(result.value) : [];
    const columns = listItems(props.columns);
    if (result.status === 'loading' || result.status === 'idle') {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-data-table zc-state-loading">
          <DataPlaceholder nodeId={node.id} message="Loading table…" />
        </NodeFrame>
      );
    }
    if (result.status !== 'ready') {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-data-table zc-state-unavailable">
          <DataPlaceholder nodeId={node.id} message="Table data is unavailable." />
        </NodeFrame>
      );
    }
    return (
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-data-table">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {rows.length === 0 ? (
          <p className="zc-muted">{asString(props.emptyText, 'No rows available.')}</p>
        ) : (
          <div className="zc-table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((column, index) => (
                    <th key={`${node.id}-th-${index}`} scope="col">{safeString(column.label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${node.id}-tr-${rowIndex}`}>
                    {columns.map((column, colIndex) => (
                      <td key={`${node.id}-td-${rowIndex}-${colIndex}`}>{safeString(row[safeString(column.key)])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </NodeFrame>
    );
  },
};

const list: ComponentDefinition = {
  type: 'data.list',
  version: 1,
  name: 'Data list',
  description: 'Bulleted list from a list-valued provider field.',
  category: 'data',
  keywords: ['list', 'data', 'binding', 'items'],
  defaults: {
    title: '',
    provider: 'public.commands',
    resource: 'catalog',
    field: 'commands',
    itemField: 'name',
    emptyText: 'Nothing to show yet.',
  },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    { key: 'provider', label: 'Data provider', group: 'data', control: 'select', options: providerOptions },
    { key: 'resource', label: 'Resource', group: 'data', control: 'text' },
    { key: 'field', label: 'List field', group: 'data', control: 'text', required: true },
    { key: 'itemField', label: 'Item field', group: 'data', control: 'text' },
    { key: 'emptyText', label: 'Empty message', group: 'content', control: 'text' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const binding = bindingProps(props);
    const result = runtime.binding(binding);
    const items = Array.isArray(result.value) ? listItems(result.value) : [];
    return (
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-data-list">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {result.status === 'loading' || result.status === 'idle' ? (
          <p className="zc-muted">Loading…</p>
        ) : result.status !== 'ready' ? (
          <p className="zc-muted">List data is unavailable.</p>
        ) : items.length === 0 ? (
          <p className="zc-muted">{asString(props.emptyText, 'Nothing to show yet.')}</p>
        ) : (
          <ul className="zc-data-items">
            {items.map((item, index) => (
              <li key={`${node.id}-item-${index}`}>{safeString(item[asString(props.itemField, 'name')])}</li>
            ))}
          </ul>
        )}
      </NodeFrame>
    );
  },
};

const session: ComponentDefinition = {
  type: 'data.session',
  version: 1,
  name: 'Session panel',
  description: 'Shows whether the visitor is signed in. Presentation only, never authorization.',
  category: 'data',
  keywords: ['session', 'user', 'profile', 'auth', 'identity'],
  defaults: { signedInText: 'Signed in as {username}', signedOutText: 'Not signed in', ownerBadge: 'Owner' },
  schema: [
    { key: 'signedInText', label: 'Signed-in text', group: 'content', control: 'text' },
    { key: 'signedOutText', label: 'Signed-out text', group: 'content', control: 'text' },
    { key: 'ownerBadge', label: 'Owner badge', group: 'content', control: 'text' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const user = runtime.session;
    const text = user.authenticated
      ? asString(props.signedInText, 'Signed in as {username}').replace('{username}', user.username ?? 'member')
      : asString(props.signedOutText, 'Not signed in');
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-session-panel">
        <span className={`zc-session-dot ${user.authenticated ? 'zc-session-on' : ''}`} aria-hidden />
        <span>{text}</span>
        {user.isOwner ? <span className="zc-badge">{asString(props.ownerBadge, 'Owner')}</span> : null}
      </NodeFrame>
    );
  },
};

const serverList: ComponentDefinition = {
  type: 'data.serverList',
  version: 1,
  name: 'Server list',
  description: 'Servers the signed-in user can access, resolved server-side.',
  category: 'data',
  keywords: ['servers', 'guilds', 'account', 'binding'],
  defaults: { title: 'Your servers', emptyText: 'No servers available.', itemField: 'name' },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    { key: 'itemField', label: 'Item field', group: 'data', control: 'text' },
    { key: 'emptyText', label: 'Empty message', group: 'content', control: 'text' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    if (!runtime.session.authenticated) {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-data-list zc-state-denied">
          <p className="zc-muted">Sign in to see your servers.</p>
        </NodeFrame>
      );
    }
    const result = runtime.binding({ provider: 'account.servers', resource: 'servers', field: 'servers' });
    const servers = Array.isArray(result.value) ? listItems(result.value) : [];
    return (
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-data-list">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {result.status === 'loading' || result.status === 'idle' ? (
          <p className="zc-muted">Loading servers…</p>
        ) : result.status !== 'ready' ? (
          <p className="zc-muted">Servers are unavailable right now.</p>
        ) : servers.length === 0 ? (
          <p className="zc-muted">{asString(props.emptyText, 'No servers available.')}</p>
        ) : (
          <ul className="zc-data-items">
            {servers.map((server, index) => (
              <li key={`${node.id}-server-${index}`}>{safeString(server[asString(props.itemField, 'name')])}</li>
            ))}
          </ul>
        )}
      </NodeFrame>
    );
  },
};

export const dataComponents: ComponentDefinition[] = [stat, boundText, table, list, session, serverList];
