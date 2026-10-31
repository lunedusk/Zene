import type { ComponentDefinition } from '../types.js';
import { NodeFrame } from '../NodeFrame.js';
import type { NodeRenderProps } from '../runtime.js';
import { asString } from './define.js';

const page: ComponentDefinition = {
  type: 'structure.page',
  version: 1,
  name: 'Page',
  description: 'Document root. Holds the page composition.',
  category: 'structure',
  keywords: ['page', 'root', 'document'],
  defaults: {},
  schema: [],
  slots: [{ name: 'default', label: 'Page content', accepts: '*', max: 200 }],
  layoutModes: ['flow'],
  responsive: false,
  rootOnly: true,
  source: 'builtin',
  render: ({ node, children, resolved }: NodeRenderProps) => (
    <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-page">
      {children()}
    </NodeFrame>
  ),
};

const section: ComponentDefinition = {
  type: 'structure.section',
  version: 1,
  name: 'Section',
  description: 'Semantic page section with a tonal surface and vertical rhythm.',
  category: 'structure',
  keywords: ['section', 'band', 'area', 'surface'],
  defaults: { tone: 'default', anchor: '' },
  schema: [
    {
      key: 'tone',
      label: 'Tone',
      group: 'style',
      control: 'select',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'muted', label: 'Muted' },
        { value: 'inverted', label: 'Inverted' },
        { value: 'accent', label: 'Accent wash' },
      ],
    },
    { key: 'anchor', label: 'Anchor id', group: 'advanced', control: 'text', placeholder: 'pricing' },
  ],
  slots: [{ name: 'default', label: 'Section content', accepts: '*', max: 200 }],
  layoutModes: ['flow', 'stack', 'row', 'grid', 'split', 'overlay'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, children }: NodeRenderProps) => (
    <NodeFrame
      as="section"
      nodeId={node.id}
      layout={resolved.layout}
      style={resolved.style}
      className={`zc-section zc-tone-${asString(props.tone, 'default')}`}
      role="region"
      ariaLabel={node.a11y?.label}
    >
      {asString(props.anchor) ? <span id={asString(props.anchor)} className="zc-anchor" aria-hidden /> : null}
      {children()}
    </NodeFrame>
  ),
};

const container: ComponentDefinition = {
  type: 'structure.container',
  version: 1,
  name: 'Container',
  description: 'Generic layout box for grouping and nesting components.',
  category: 'structure',
  keywords: ['container', 'box', 'group', 'div'],
  defaults: { semantic: 'div' },
  schema: [
    {
      key: 'semantic',
      label: 'Element',
      group: 'advanced',
      control: 'select',
      options: [
        { value: 'div', label: 'div' },
        { value: 'section', label: 'section' },
        { value: 'article', label: 'article' },
        { value: 'aside', label: 'aside' },
      ],
    },
  ],
  slots: [{ name: 'default', label: 'Content', accepts: '*', max: 200 }],
  layoutModes: ['flow', 'stack', 'row', 'grid', 'split', 'overlay'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved, children }: NodeRenderProps) => {
    const semantic = asString(props.semantic, 'div');
    const tag = semantic === 'section' ? 'section' : semantic === 'article' ? 'article' : semantic === 'aside' ? 'aside' : 'div';
    return (
      <NodeFrame
        as={tag}
        nodeId={node.id}
        layout={resolved.layout}
        style={resolved.style}
        className="zc-container"
        ariaLabel={node.a11y?.label}
      >
        {children()}
      </NodeFrame>
    );
  },
};

const stack: ComponentDefinition = {
  type: 'structure.stack',
  version: 1,
  name: 'Stack',
  description: 'Vertical stack with consistent spacing between children.',
  category: 'structure',
  keywords: ['stack', 'vertical', 'column', 'flow'],
  defaults: {},
  schema: [],
  slots: [{ name: 'default', label: 'Stack items', accepts: '*', max: 200 }],
  layoutModes: ['stack'],
  responsive: true,
  source: 'builtin',
  render: ({ node, resolved, children }: NodeRenderProps) => (
    <NodeFrame as="div" nodeId={node.id} layout={{ mode: 'stack', gap: 16, ...resolved.layout }} style={resolved.style} className="zc-stack">
      {children()}
    </NodeFrame>
  ),
};

const row: ComponentDefinition = {
  type: 'structure.row',
  version: 1,
  name: 'Row',
  description: 'Horizontal layout that wraps when space runs out.',
  category: 'structure',
  keywords: ['row', 'horizontal', 'flex', 'inline'],
  defaults: {},
  schema: [],
  slots: [{ name: 'default', label: 'Row items', accepts: '*', max: 200 }],
  layoutModes: ['row'],
  responsive: true,
  source: 'builtin',
  render: ({ node, resolved, children }: NodeRenderProps) => (
    <NodeFrame as="div" nodeId={node.id} layout={{ mode: 'row', gap: 12, wrap: true, ...resolved.layout }} style={resolved.style} className="zc-row">
      {children()}
    </NodeFrame>
  ),
};

const grid: ComponentDefinition = {
  type: 'structure.grid',
  version: 1,
  name: 'Grid',
  description: 'CSS grid with configurable columns, gaps, and child spans.',
  category: 'structure',
  keywords: ['grid', 'columns', 'layout', 'masonry', 'cards'],
  defaults: {},
  schema: [],
  slots: [{ name: 'default', label: 'Grid items', accepts: '*', max: 200 }],
  layoutModes: ['grid'],
  responsive: true,
  source: 'builtin',
  render: ({ node, resolved, children }: NodeRenderProps) => (
    <NodeFrame as="div" nodeId={node.id} layout={{ mode: 'grid', columns: 3, gap: 20, ...resolved.layout }} style={resolved.style} className="zc-grid">
      {children()}
    </NodeFrame>
  ),
};

const split: ComponentDefinition = {
  type: 'structure.split',
  version: 1,
  name: 'Split pane',
  description: 'Two-slot split with adjustable ratio and minimum sizing.',
  category: 'structure',
  keywords: ['split', 'pane', 'two column', 'sidebar'],
  defaults: { collapse: true },
  schema: [
    { key: 'collapse', label: 'Stack on mobile', group: 'layout', control: 'boolean', description: 'Collapse to a single column on narrow screens.' },
  ],
  slots: [
    { name: 'start', label: 'Start pane', accepts: '*', max: 40 },
    { name: 'end', label: 'End pane', accepts: '*', max: 40 },
  ],
  layoutModes: ['split'],
  responsive: true,
  resizable: true,
  source: 'builtin',
  render: ({ node, resolved, children }: NodeRenderProps) => (
    <NodeFrame
      nodeId={node.id}
      layout={{ mode: 'split', ratio: 0.5, gap: 16, ...resolved.layout }}
      style={resolved.style}
      className="zc-split"
      ariaLabel={node.a11y?.label}
    >
      <div className="zc-split-pane">{children('start')}</div>
      <div className="zc-split-pane">{children('end')}</div>
    </NodeFrame>
  ),
};

const overlay: ComponentDefinition = {
  type: 'structure.overlay',
  version: 1,
  name: 'Overlay',
  description: 'Stacks children in the same grid cell for controlled layering.',
  category: 'structure',
  keywords: ['overlay', 'stack', 'layer', 'absolute', 'cover'],
  defaults: {},
  schema: [],
  slots: [{ name: 'default', label: 'Layered content', accepts: '*', max: 40 }],
  layoutModes: ['overlay'],
  responsive: true,
  source: 'builtin',
  render: ({ node, resolved, children }: NodeRenderProps) => (
    <NodeFrame nodeId={node.id} layout={{ mode: 'overlay', ...resolved.layout }} style={resolved.style} className="zc-overlay">
      {children()}
    </NodeFrame>
  ),
};

const spacer: ComponentDefinition = {
  type: 'structure.spacer',
  version: 1,
  name: 'Spacer',
  description: 'Intentional vertical space between sections.',
  category: 'structure',
  keywords: ['spacer', 'space', 'gap', 'rhythm'],
  defaults: { size: 32 },
  schema: [{ key: 'size', label: 'Height', group: 'layout', control: 'range', min: 4, max: 240, step: 4, defaultValue: 32 }],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => (
    <NodeFrame
      nodeId={node.id}
      layout={resolved.layout}
      style={resolved.style}
      styleOverride={{ height: typeof props.size === 'number' ? props.size : 32 }}
      className="zc-spacer"
      ariaLabel={`Spacer ${String(props.size ?? 32)} pixels`}
      role="separator"
    />
  ),
};

const divider: ComponentDefinition = {
  type: 'structure.divider',
  version: 1,
  name: 'Divider',
  description: 'Horizontal rule with an optional inline label.',
  category: 'structure',
  keywords: ['divider', 'rule', 'separator', 'hr'],
  defaults: { label: '', variant: 'solid' },
  schema: [
    { key: 'label', label: 'Label', group: 'content', control: 'text', placeholder: 'Optional label' },
    {
      key: 'variant',
      label: 'Line style',
      group: 'style',
      control: 'select',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'dashed', label: 'Dashed' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => (
    <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-divider">
      {asString(props.label) ? (
        <div className={`zc-divider-label zc-divider-${asString(props.variant, 'solid')}`} role="separator">
          <span>{asString(props.label)}</span>
        </div>
      ) : (
        <hr className={`zc-divider-line zc-divider-${asString(props.variant, 'solid')}`} />
      )}
    </NodeFrame>
  ),
};

export const structureComponents: ComponentDefinition[] = [
  page,
  section,
  container,
  stack,
  row,
  grid,
  split,
  overlay,
  spacer,
  divider,
];
