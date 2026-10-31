import type { ComponentDefinition } from '../types.js';
import { NodeFrame } from '../NodeFrame.js';
import type { NodeRenderProps } from '../runtime.js';
import { asString, asBoolean, listItems, safeString } from './define.js';
import { BuiltinIcon, ICON_NAMES } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { interactionClickHandler } from '../actionHelpers.js';

function headingTag(level: number): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const n = Math.max(1, Math.min(6, Math.round(level)));
  return `h${n}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

function cnLinkClasses(variant: string): string {
  return `zc-link zc-link-${variant}`;
}

const heading: ComponentDefinition = {
  type: 'content.heading',
  version: 1,
  name: 'Heading',
  description: 'Semantic heading with controllable level, scale, and tone.',
  category: 'content',
  keywords: ['heading', 'title', 'h1', 'h2', 'headline', 'typography'],
  defaults: { text: 'A clear, confident heading', level: '2', tone: 'default', eyebrow: '' },
  schema: [
    { key: 'text', label: 'Heading text', group: 'content', control: 'text', required: true, defaultValue: 'A clear, confident heading' },
    {
      key: 'level',
      label: 'Heading level',
      group: 'content',
      control: 'select',
      options: [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `H${n}` })),
    },
    { key: 'eyebrow', label: 'Eyebrow', group: 'content', control: 'text', placeholder: 'Optional overline' },
    {
      key: 'tone',
      label: 'Tone',
      group: 'style',
      control: 'select',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'muted', label: 'Muted' },
        { value: 'accent', label: 'Accent' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const level = Number.parseInt(asString(props.level, '2'), 10) || 2;
    const tag = headingTag(level);
    return (
      <NodeFrame
        as={tag}
        nodeId={node.id}
        layout={resolved.layout}
        style={resolved.style}
        className={`zc-heading zc-heading-${level} zc-text-${asString(props.tone, 'default')}`}
        ariaLabel={node.a11y?.label}
      >
        {asString(props.eyebrow) ? <span className="zc-eyebrow">{asString(props.eyebrow)}</span> : null}
        {asString(props.text)}
      </NodeFrame>
    );
  },
};

const text: ComponentDefinition = {
  type: 'content.text',
  version: 1,
  name: 'Text',
  description: 'Body copy or a safe Markdown subset with controlled typography.',
  category: 'content',
  keywords: ['text', 'paragraph', 'copy', 'markdown', 'body'],
  defaults: { text: 'Explain the idea clearly. Keep it specific and useful.', markdown: false, tone: 'default', measure: 'normal' },
  schema: [
    { key: 'text', label: 'Text', group: 'content', control: 'textarea', required: true },
    { key: 'markdown', label: 'Render Markdown subset', group: 'content', control: 'boolean' },
    {
      key: 'tone',
      label: 'Tone',
      group: 'style',
      control: 'select',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'muted', label: 'Muted' },
      ],
    },
    {
      key: 'measure',
      label: 'Line length',
      group: 'style',
      control: 'select',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'narrow', label: 'Narrow' },
        { value: 'wide', label: 'Wide' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => (
    <NodeFrame
      as="div"
      nodeId={node.id}
      layout={resolved.layout}
      style={resolved.style}
      className={`zc-text zc-text-${asString(props.tone, 'default')} zc-measure-${asString(props.measure, 'normal')}`}
    >
      {asBoolean(props.markdown) ? renderMarkdown(asString(props.text), node.id) : <p>{asString(props.text)}</p>}
    </NodeFrame>
  ),
};

const link: ComponentDefinition = {
  type: 'content.link',
  version: 1,
  name: 'Link',
  description: 'Primary, secondary, or inline link with an optional arrow.',
  category: 'content',
  keywords: ['link', 'button', 'cta', 'anchor', 'action'],
  defaults: { label: 'Continue', href: '/', variant: 'primary', external: false, arrow: false },
  schema: [
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    { key: 'href', label: 'Destination', group: 'content', control: 'url', required: true, placeholder: '/docs or https://…' },
    {
      key: 'variant',
      label: 'Style',
      group: 'style',
      control: 'select',
      options: [
        { value: 'primary', label: 'Primary' },
        { value: 'secondary', label: 'Secondary' },
        { value: 'ghost', label: 'Ghost' },
        { value: 'inline', label: 'Inline' },
      ],
    },
    { key: 'external', label: 'Open in a new tab', group: 'interactions', control: 'boolean' },
    { key: 'arrow', label: 'Show arrow', group: 'style', control: 'boolean' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  interactive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const href = asString(props.href);
    const external = asBoolean(props.external) || /^https?:\/\//i.test(href);
    const onClick = interactionClickHandler(runtime, node);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-link-wrap">
        <a
          className={cnLinkClasses(asString(props.variant, 'primary'))}
          href={runtime.interactive ? href : undefined}
          target={external && runtime.interactive ? '_blank' : undefined}
          rel={external ? 'noreferrer noopener' : undefined}
          onClick={onClick}
          tabIndex={runtime.mode === 'editor' ? -1 : undefined}
        >
          {asString(props.label)}
          {asBoolean(props.arrow) ? <BuiltinIcon name="arrow-right" size={16} /> : null}
        </a>
      </NodeFrame>
    );
  },
};

const icon: ComponentDefinition = {
  type: 'content.icon',
  version: 1,
  name: 'Icon',
  description: 'Built-in icon with accessible label support.',
  category: 'content',
  keywords: ['icon', 'glyph', 'symbol'],
  defaults: { name: 'spark', size: 24, label: '' },
  schema: [
    {
      key: 'name',
      label: 'Icon',
      group: 'content',
      control: 'select',
      options: ICON_NAMES.map((n) => ({ value: n, label: n })),
    },
    { key: 'size', label: 'Size', group: 'style', control: 'range', min: 12, max: 96, step: 2, defaultValue: 24 },
    { key: 'label', label: 'Accessible label', group: 'a11y', control: 'text', placeholder: 'Decorative if empty' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => (
    <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-icon">
      <BuiltinIcon name={asString(props.name, 'spark')} size={typeof props.size === 'number' ? props.size : 24} label={asString(props.label) || undefined} />
    </NodeFrame>
  ),
};

const image: ComponentDefinition = {
  type: 'content.image',
  version: 1,
  name: 'Image',
  description: 'Responsive image with fit, position, aspect ratio, and required alt text.',
  category: 'content',
  keywords: ['image', 'picture', 'media', 'photo', 'figure'],
  defaults: { src: '', alt: 'Image description', caption: '', fit: 'cover', position: 'center', aspect: 'auto', loading: 'lazy' },
  schema: [
    { key: 'src', label: 'Image URL', group: 'media', control: 'image-url' },
    { key: 'alt', label: 'Alt text', group: 'media', control: 'text', required: true, description: 'Describe the image for screen readers.' },
    { key: 'caption', label: 'Caption', group: 'media', control: 'text' },
    {
      key: 'fit',
      label: 'Fit',
      group: 'media',
      control: 'select',
      options: [
        { value: 'cover', label: 'Cover' },
        { value: 'contain', label: 'Contain' },
      ],
    },
    {
      key: 'position',
      label: 'Focal position',
      group: 'media',
      control: 'select',
      options: [
        { value: 'center', label: 'Center' },
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
    },
    {
      key: 'aspect',
      label: 'Aspect ratio',
      group: 'media',
      control: 'select',
      options: [
        { value: 'auto', label: 'Natural' },
        { value: '16 / 9', label: '16:9' },
        { value: '4 / 3', label: '4:3' },
        { value: '1 / 1', label: 'Square' },
        { value: '3 / 2', label: '3:2' },
      ],
    },
    {
      key: 'loading',
      label: 'Loading',
      group: 'advanced',
      control: 'select',
      options: [
        { value: 'lazy', label: 'Lazy' },
        { value: 'eager', label: 'Eager' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const src = asString(props.src);
    if (!src) {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-image zc-media-placeholder">
          <span>Image not set</span>
        </NodeFrame>
      );
    }
    return (
      <NodeFrame as="figure" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-image">
        <img
          src={src}
          alt={asString(props.alt)}
          loading={asString(props.loading, 'lazy') === 'eager' ? 'eager' : 'lazy'}
          style={{
            objectFit: asString(props.fit, 'cover') === 'contain' ? 'contain' : 'cover',
            objectPosition: asString(props.position, 'center'),
            aspectRatio: asString(props.aspect, 'auto') === 'auto' ? undefined : asString(props.aspect),
          }}
        />
        {asString(props.caption) ? <figcaption>{asString(props.caption)}</figcaption> : null}
      </NodeFrame>
    );
  },
};

const video: ComponentDefinition = {
  type: 'content.video',
  version: 1,
  name: 'Video',
  description: 'Accessible video embed with poster and playback controls.',
  category: 'content',
  keywords: ['video', 'media', 'movie', 'clip'],
  defaults: { src: '', poster: '', caption: '', autoplay: false, loop: false, muted: true, controls: true },
  schema: [
    { key: 'src', label: 'Video URL', group: 'media', control: 'url' },
    { key: 'poster', label: 'Poster image', group: 'media', control: 'image-url' },
    { key: 'caption', label: 'Caption', group: 'media', control: 'text' },
    { key: 'controls', label: 'Show controls', group: 'media', control: 'boolean' },
    { key: 'autoplay', label: 'Autoplay (muted)', group: 'advanced', control: 'boolean' },
    { key: 'loop', label: 'Loop', group: 'advanced', control: 'boolean' },
    { key: 'muted', label: 'Muted', group: 'advanced', control: 'boolean' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const src = asString(props.src);
    if (!src) {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-video zc-media-placeholder">
          <span>Video not set</span>
        </NodeFrame>
      );
    }
    return (
      <NodeFrame as="figure" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-video">
        <video
          src={src}
          poster={asString(props.poster) || undefined}
          controls={asBoolean(props.controls, true)}
          autoPlay={asBoolean(props.autoplay)}
          muted={asBoolean(props.muted, true)}
          loop={asBoolean(props.loop)}
          playsInline
          preload="metadata"
        />
        {asString(props.caption) ? <figcaption>{asString(props.caption)}</figcaption> : null}
      </NodeFrame>
    );
  },
};

const gallery: ComponentDefinition = {
  type: 'content.gallery',
  version: 1,
  name: 'Gallery',
  description: 'Responsive image grid with captions and required alt text.',
  category: 'content',
  keywords: ['gallery', 'images', 'grid', 'screenshots', 'media'],
  defaults: { columns: 2, items: [] },
  schema: [
    { key: 'columns', label: 'Columns', group: 'layout', control: 'range', min: 1, max: 4, step: 1 },
    {
      key: 'items',
      label: 'Images',
      group: 'media',
      control: 'list',
      maxItems: 24,
      itemDefault: { src: '', alt: 'Image description', caption: '' },
      itemFields: [
        { key: 'src', label: 'Image URL', control: 'image-url' },
        { key: 'alt', label: 'Alt text', control: 'text', required: true },
        { key: 'caption', label: 'Caption', control: 'text' },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const items = listItems(props.items);
    if (items.length === 0) {
      return (
        <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-gallery zc-state-empty">
          <p>No images yet. Add images in the inspector.</p>
        </NodeFrame>
      );
    }
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-gallery">
        <div className="zc-gallery-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, Number(props.columns) || 2)}, minmax(0, 1fr))` }}>
          {items.map((item, index) => (
            <figure key={`${node.id}-img-${index}`} className="zc-gallery-item">
              <img src={safeString(item.src)} alt={safeString(item.alt)} loading="lazy" />
              {safeString(item.caption) ? <figcaption>{safeString(item.caption)}</figcaption> : null}
            </figure>
          ))}
        </div>
      </NodeFrame>
    );
  },
};

const featureList: ComponentDefinition = {
  type: 'content.featureList',
  version: 1,
  name: 'Feature list',
  description: 'Explains capabilities with titles, descriptions, and icons.',
  category: 'presentation',
  keywords: ['features', 'capabilities', 'benefits', 'list', 'grid'],
  defaults: { title: 'Why it works', description: '', variant: 'grid', items: [] },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    { key: 'description', label: 'Description', group: 'content', control: 'textarea' },
    {
      key: 'variant',
      label: 'Layout',
      group: 'layout',
      control: 'select',
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'list', label: 'List' },
      ],
    },
    {
      key: 'items',
      label: 'Features',
      group: 'content',
      control: 'list',
      maxItems: 12,
      itemDefault: { title: 'New feature', description: '', icon: 'spark' },
      itemFields: [
        { key: 'title', label: 'Title', control: 'text', required: true },
        { key: 'description', label: 'Description', control: 'textarea' },
        { key: 'icon', label: 'Icon name', control: 'text' },
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
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-feature-list">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {asString(props.description) ? <p className="zc-section-description">{asString(props.description)}</p> : null}
        {items.length === 0 ? (
          <div className="zc-state-empty"><p>No features yet.</p></div>
        ) : (
          <div className={`zc-feature-items zc-feature-${asString(props.variant, 'grid')}`}>
            {items.map((item, index) => (
              <article key={`${node.id}-feature-${index}`} className="zc-feature">
                <span className="zc-feature-icon"><BuiltinIcon name={safeString(item.icon) || 'spark'} size={20} /></span>
                <h3>{safeString(item.title)}</h3>
                {safeString(item.description) ? <p>{safeString(item.description)}</p> : null}
              </article>
            ))}
          </div>
        )}
      </NodeFrame>
    );
  },
};

const statGroup: ComponentDefinition = {
  type: 'content.statGroup',
  version: 1,
  name: 'Statistics',
  description: 'Concise metric row for static values.',
  category: 'presentation',
  keywords: ['stats', 'metrics', 'numbers', 'kpi', 'counts'],
  defaults: { title: '', description: '', items: [] },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    { key: 'description', label: 'Description', group: 'content', control: 'textarea' },
    {
      key: 'items',
      label: 'Metrics',
      group: 'content',
      control: 'list',
      maxItems: 8,
      itemDefault: { label: 'Metric', value: '0', suffix: '' },
      itemFields: [
        { key: 'label', label: 'Label', control: 'text', required: true },
        { key: 'value', label: 'Value', control: 'text', required: true },
        { key: 'suffix', label: 'Suffix', control: 'text' },
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
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-stat-group">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {asString(props.description) ? <p className="zc-section-description">{asString(props.description)}</p> : null}
        {items.length === 0 ? (
          <div className="zc-state-empty"><p>No metrics yet.</p></div>
        ) : (
          <dl className="zc-stat-items">
            {items.map((item, index) => (
              <div key={`${node.id}-stat-${index}`} className="zc-stat">
                <dt>{safeString(item.label)}</dt>
                <dd>{safeString(item.value)}{safeString(item.suffix) ? <span>{safeString(item.suffix)}</span> : null}</dd>
              </div>
            ))}
          </dl>
        )}
      </NodeFrame>
    );
  },
};

const testimonial: ComponentDefinition = {
  type: 'content.testimonial',
  version: 1,
  name: 'Testimonial',
  description: 'Quote with attribution and optional avatar.',
  category: 'presentation',
  keywords: ['testimonial', 'quote', 'review', 'social proof'],
  defaults: { quote: 'A specific, credible quote.', author: 'Name', role: '', avatar: '' },
  schema: [
    { key: 'quote', label: 'Quote', group: 'content', control: 'textarea', required: true },
    { key: 'author', label: 'Author', group: 'content', control: 'text', required: true },
    { key: 'role', label: 'Role', group: 'content', control: 'text' },
    { key: 'avatar', label: 'Avatar URL', group: 'media', control: 'image-url' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => (
    <NodeFrame as="figure" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-testimonial">
      <blockquote>{asString(props.quote)}</blockquote>
      <figcaption>
        {asString(props.avatar) ? <img src={asString(props.avatar)} alt="" width={40} height={40} loading="lazy" /> : null}
        <span>
          <strong>{asString(props.author)}</strong>
          {asString(props.role) ? <em>{asString(props.role)}</em> : null}
        </span>
      </figcaption>
    </NodeFrame>
  ),
};

const steps: ComponentDefinition = {
  type: 'content.steps',
  version: 1,
  name: 'Steps',
  description: 'Ordered sequence that explains a workflow.',
  category: 'presentation',
  keywords: ['steps', 'timeline', 'process', 'workflow', 'sequence'],
  defaults: { title: 'How it works', variant: 'vertical', items: [] },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    {
      key: 'variant',
      label: 'Orientation',
      group: 'layout',
      control: 'select',
      options: [
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
      ],
    },
    {
      key: 'items',
      label: 'Steps',
      group: 'content',
      control: 'list',
      maxItems: 10,
      itemDefault: { title: 'New step', description: '' },
      itemFields: [
        { key: 'title', label: 'Title', control: 'text', required: true },
        { key: 'description', label: 'Description', control: 'textarea' },
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
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-steps">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {items.length === 0 ? (
          <div className="zc-state-empty"><p>No steps yet.</p></div>
        ) : (
          <ol className={`zc-step-items zc-steps-${asString(props.variant, 'vertical')}`}>
            {items.map((item, index) => (
              <li key={`${node.id}-step-${index}`}>
                <span className="zc-step-index" aria-hidden>{index + 1}</span>
                <div>
                  <h3>{safeString(item.title)}</h3>
                  {safeString(item.description) ? <p>{safeString(item.description)}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </NodeFrame>
    );
  },
};

const faq: ComponentDefinition = {
  type: 'content.faq',
  version: 1,
  name: 'FAQ',
  description: 'Accessible disclosure list for common questions.',
  category: 'presentation',
  keywords: ['faq', 'questions', 'answers', 'accordion', 'disclosure'],
  defaults: { title: 'Frequently asked questions', items: [] },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    {
      key: 'items',
      label: 'Questions',
      group: 'content',
      control: 'list',
      maxItems: 20,
      itemDefault: { question: 'New question', answer: '' },
      itemFields: [
        { key: 'question', label: 'Question', control: 'text', required: true },
        { key: 'answer', label: 'Answer', control: 'textarea', required: true },
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
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-faq">
        {asString(props.title) ? <h2 className="zc-section-heading">{asString(props.title)}</h2> : null}
        {items.length === 0 ? (
          <div className="zc-state-empty"><p>No questions yet.</p></div>
        ) : (
          items.map((item, index) => (
            <details key={`${node.id}-faq-${index}`} className="zc-faq-item">
              <summary>{safeString(item.question)}</summary>
              <p>{safeString(item.answer)}</p>
            </details>
          ))
        )}
      </NodeFrame>
    );
  },
};

const cta: ComponentDefinition = {
  type: 'content.cta',
  version: 1,
  name: 'Call to action',
  description: 'Purposeful primary and secondary action block.',
  category: 'presentation',
  keywords: ['cta', 'call to action', 'invite', 'conversion', 'button'],
  defaults: {
    title: 'Ready to start?',
    description: '',
    primaryLabel: 'Get started',
    primaryHref: '/login',
    secondaryLabel: '',
    secondaryHref: '',
  },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text', required: true },
    { key: 'description', label: 'Description', group: 'content', control: 'textarea' },
    { key: 'primaryLabel', label: 'Primary label', group: 'content', control: 'text', required: true },
    { key: 'primaryHref', label: 'Primary destination', group: 'content', control: 'url', required: true },
    { key: 'secondaryLabel', label: 'Secondary label', group: 'content', control: 'text' },
    { key: 'secondaryHref', label: 'Secondary destination', group: 'content', control: 'url' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  interactive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const onClick = interactionClickHandler(runtime, node);
    return (
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-cta">
        <div className="zc-cta-copy">
          <h2>{asString(props.title)}</h2>
          {asString(props.description) ? <p>{asString(props.description)}</p> : null}
        </div>
        <div className="zc-cta-actions">
          <a
            className="zc-link zc-link-primary"
            href={runtime.interactive ? asString(props.primaryHref) : undefined}
            onClick={onClick}
          >
            {asString(props.primaryLabel)}
          </a>
          {asString(props.secondaryLabel) ? (
            <a
              className="zc-link zc-link-secondary"
              href={runtime.interactive ? asString(props.secondaryHref) || undefined : undefined}
            >
              {asString(props.secondaryLabel)}
            </a>
          ) : null}
        </div>
      </NodeFrame>
    );
  },
};

const logoRow: ComponentDefinition = {
  type: 'content.logoRow',
  version: 1,
  name: 'Logo row',
  description: 'Integrations or partners displayed as a restrained row.',
  category: 'presentation',
  keywords: ['logos', 'integrations', 'partners', 'brands'],
  defaults: { title: '', items: [] },
  schema: [
    { key: 'title', label: 'Title', group: 'content', control: 'text' },
    {
      key: 'items',
      label: 'Logos',
      group: 'content',
      control: 'list',
      maxItems: 12,
      itemDefault: { name: 'Integration', src: '', href: '' },
      itemFields: [
        { key: 'name', label: 'Name', control: 'text', required: true },
        { key: 'src', label: 'Logo URL', control: 'image-url' },
        { key: 'href', label: 'Link', control: 'url' },
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
      <NodeFrame as="section" nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-logo-row">
        {asString(props.title) ? <p className="zc-logo-title">{asString(props.title)}</p> : null}
        <ul>
          {items.map((item, index) => (
            <li key={`${node.id}-logo-${index}`}>
              {safeString(item.src) ? (
                <img src={safeString(item.src)} alt={safeString(item.name)} loading="lazy" />
              ) : (
                <span>{safeString(item.name)}</span>
              )}
            </li>
          ))}
        </ul>
        {items.length === 0 ? <p className="zc-muted">No logos yet.</p> : null}
      </NodeFrame>
    );
  },
};

export const contentComponents: ComponentDefinition[] = [
  heading,
  text,
  link,
  icon,
  image,
  video,
  gallery,
  featureList,
  statGroup,
  testimonial,
  steps,
  faq,
  cta,
  logoRow,
];
