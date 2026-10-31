import type { ComponentDefinition } from '../types.js';
import { NodeFrame } from '../NodeFrame.js';
import type { NodeRenderProps } from '../runtime.js';
import { asBoolean, asString, listItems, safeString } from './define.js';

const menu: ComponentDefinition = {
  type: 'navigation.menu',
  version: 1,
  name: 'Navigation menu',
  description: 'Brand and link bar for page navigation.',
  category: 'navigation',
  keywords: ['nav', 'navbar', 'menu', 'header', 'links', 'navigation'],
  defaults: { brand: 'Zene', sticky: false, links: [] },
  schema: [
    { key: 'brand', label: 'Brand label', group: 'content', control: 'text', required: true },
    { key: 'sticky', label: 'Sticky header', group: 'layout', control: 'boolean' },
    {
      key: 'links',
      label: 'Links',
      group: 'content',
      control: 'list',
      maxItems: 10,
      itemDefault: { label: 'Link', href: '/' },
      itemFields: [
        { key: 'label', label: 'Label', control: 'text', required: true },
        { key: 'href', label: 'Destination', control: 'url', required: true },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const links = listItems(props.links);
    return (
      <NodeFrame
        as="nav"
        nodeId={node.id}
        layout={resolved.layout}
        style={resolved.style}
        className={`zc-menu ${asBoolean(props.sticky) ? 'zc-menu-sticky' : ''}`}
        ariaLabel={node.a11y?.label ?? 'Primary'}
      >
        <span className="zc-menu-brand">{asString(props.brand)}</span>
        {links.length > 0 ? (
          <ul className="zc-menu-links">
            {links.map((link, index) => {
              const href = safeString(link.href);
              const external = /^https?:\/\//i.test(href);
              return (
                <li key={`${node.id}-link-${index}`}>
                  <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer noopener' : undefined}>
                    {safeString(link.label)}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </NodeFrame>
    );
  },
};

const tabs: ComponentDefinition = {
  type: 'navigation.tabs',
  version: 1,
  name: 'Tabs',
  description: 'Local-state tabs with accessible tab semantics.',
  category: 'navigation',
  keywords: ['tabs', 'switcher', 'segments', 'panels'],
  defaults: { items: [] },
  schema: [
    {
      key: 'items',
      label: 'Tabs',
      group: 'content',
      control: 'list',
      maxItems: 8,
      itemDefault: { label: 'New tab', content: '' },
      itemFields: [
        { key: 'label', label: 'Label', control: 'text', required: true },
        { key: 'content', label: 'Content', control: 'textarea' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  interactive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const items = listItems(props.items);
    if (items.length === 0) {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-tabs zc-state-empty">
          <p>No tabs yet.</p>
        </NodeFrame>
      );
    }
    const stateKey = `tabs:${node.id}`;
    const raw = runtime.localState[stateKey];
    const activeIndex = Math.max(0, Math.min(items.length - 1, typeof raw === 'number' ? raw : 0));
    const active = items[activeIndex];
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-tabs">
        <div role="tablist" aria-label={node.a11y?.label ?? 'Tabs'} className="zc-tablist">
          {items.map((item, index) => (
            <button
              key={`${node.id}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-controls={`${node.id}-panel-${index}`}
              id={`${node.id}-tab-${index}`}
              tabIndex={index === activeIndex ? 0 : -1}
              className="zc-tab"
              onClick={() => {
                if (!runtime.interactive) return;
                runtime.setLocalState(stateKey, index);
              }}
            >
              {safeString(item.label)}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${node.id}-panel-${activeIndex}`}
          aria-labelledby={`${node.id}-tab-${activeIndex}`}
          className="zc-tab-panel"
          tabIndex={0}
        >
          {safeString(active?.content)}
        </div>
      </NodeFrame>
    );
  },
};

const breadcrumbs: ComponentDefinition = {
  type: 'navigation.breadcrumbs',
  version: 1,
  name: 'Breadcrumbs',
  description: 'Compact path navigation ending in the current page.',
  category: 'navigation',
  keywords: ['breadcrumbs', 'path', 'trail', 'navigation'],
  defaults: { items: [] },
  schema: [
    {
      key: 'items',
      label: 'Crumbs',
      group: 'content',
      control: 'list',
      maxItems: 8,
      itemDefault: { label: 'Page', href: '/' },
      itemFields: [
        { key: 'label', label: 'Label', control: 'text', required: true },
        { key: 'href', label: 'Destination', control: 'url' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const items = listItems(props.items);
    return (
      <NodeFrame as="nav" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-breadcrumbs" ariaLabel="Breadcrumb">
        <ol>
          {items.map((item, index) => {
            const last = index === items.length - 1;
            return (
              <li key={`${node.id}-crumb-${index}`}>
                {last || !safeString(item.href) ? (
                  <span aria-current={last ? 'page' : undefined}>{safeString(item.label)}</span>
                ) : (
                  <a href={safeString(item.href)}>{safeString(item.label)}</a>
                )}
                {!last ? <span className="zc-crumb-separator" aria-hidden>/</span> : null}
              </li>
            );
          })}
        </ol>
      </NodeFrame>
    );
  },
};

export const navigationComponents: ComponentDefinition[] = [menu, tabs, breadcrumbs];
