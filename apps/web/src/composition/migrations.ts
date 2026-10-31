import {
  DEFAULT_SLOT,
  type CompositionDocument,
  type CompositionNode,
  type JsonObject,
  type SurfaceKind,
} from './types.js';
import {
  isCompositionDocument,
  isLegacyDashboardLayout,
  isLegacyPublicSite,
  cloneJson,
} from './schema.js';
import { compositionRegistry, createDefaultNode } from './registry.js';
import './builtins/index.js';

/** Minimal structural views of the Phase 1 payloads we import from. */
interface LegacyPublicSection {
  id: string;
  type: string;
  enabled?: boolean;
  order?: number;
  title?: string;
  description?: string;
  headline?: string;
  subhead?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  content?: string;
  label?: string;
  href?: string;
  items?: Array<Record<string, unknown>>;
}

interface LegacyPublicSite {
  sections: LegacyPublicSection[];
  navigation?: Array<{ id: string; label: string; href: string; external?: boolean }>;
  metadata?: { title?: string; description?: string };
}

interface LegacyWidget {
  instanceId?: string;
  widgetId?: string;
  col?: number;
  row?: number;
  colSpan?: number;
  rowSpan?: number;
  definition?: { title?: string; description?: string; type?: string; icon?: string; pluginId?: string };
  props?: Record<string, unknown>;
}

interface LegacyLayout {
  layoutId?: string;
  surfaceId: string;
  breakpoints?: Record<string, { columns?: number; widgets?: LegacyWidget[] }>;
}

export type MigrationSource = 'composition' | 'public_site' | 'dashboard_layout';

export interface CanonicalMigration {
  document: CompositionDocument;
  source: MigrationSource;
  migrated: boolean;
}

function makeNode(
  type: string,
  props: JsonObject,
  options: {
    id: string;
    label?: string;
    slots?: Record<string, CompositionNode[]>;
    legacy?: JsonObject;
  },
): CompositionNode | null {
  const def = compositionRegistry.get(type);
  if (!def) return null;
  const node = createDefaultNode(def, options.id);
  return {
    ...node,
    label: options.label ?? node.label,
    props: { ...node.props, ...cloneJson(props) },
    slots: options.slots ?? node.slots,
    legacy: options.legacy,
  };
}

function safeId(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || fallback;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function legacyJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function listFrom(items: Array<Record<string, unknown>> | undefined): JsonObject[] {
  return (items ?? []).map((item) => legacyJson(item));
}

function sectionChildren(section: LegacyPublicSection, prefix: string): CompositionNode[] {
  const type = section.type;
  const title = section.headline ?? section.title ?? '';
  const description = section.subhead ?? section.description ?? '';
  const items = listFrom(section.items);
  const nodes: CompositionNode[] = [];

  if (type === 'hero') {
    const heading = makeNode('content.heading', { text: title || section.id, level: '1' }, { id: `${prefix}-heading` });
    const text = description
      ? makeNode('content.text', { text: description }, { id: `${prefix}-text` })
      : null;
    if (heading) nodes.push(heading);
    if (text) nodes.push(text);
    if (section.primaryCtaLabel) {
      const cta = makeNode(
        'content.cta',
        {
          title: section.primaryCtaLabel,
          description: '',
          primaryLabel: section.primaryCtaLabel,
          primaryHref: section.primaryCtaHref ?? '/',
          secondaryLabel: section.secondaryCtaLabel ?? '',
          secondaryHref: section.secondaryCtaHref ?? '',
        },
        { id: `${prefix}-cta` },
      );
      if (cta) nodes.push(cta);
    }
    return nodes;
  }

  if (type === 'cta') {
    const cta = makeNode(
      'content.cta',
      {
        title: title || section.primaryCtaLabel || 'Get started',
        description,
        primaryLabel: section.primaryCtaLabel ?? section.label ?? 'Get started',
        primaryHref: section.primaryCtaHref ?? section.href ?? '/',
        secondaryLabel: section.secondaryCtaLabel ?? '',
        secondaryHref: section.secondaryCtaHref ?? '',
      },
      { id: `${prefix}-cta` },
    );
    return cta ? [cta] : [];
  }

  if (title) {
    const heading = makeNode('content.heading', { text: title, level: '2' }, { id: `${prefix}-heading` });
    if (heading) nodes.push(heading);
  }
  if (description) {
    const text = makeNode('content.text', { text: description }, { id: `${prefix}-text` });
    if (text) nodes.push(text);
  }

  switch (type) {
    case 'features':
    case 'security':
    case 'performance':
    case 'integrations':
    case 'plugins':
      {
        const featureList = makeNode(
          'content.featureList',
          {
            title: '',
            description: '',
            variant: 'grid',
            items: items.map((item) => ({
              title: stringOf(item.title) || 'Feature',
              description: stringOf(item.description),
              icon: stringOf(item.icon) || 'spark',
            })),
          },
          { id: `${prefix}-features` },
        );
        if (featureList) nodes.push(featureList);
      }
      break;
    case 'statistics':
      {
        const stats = makeNode(
          'content.statGroup',
          {
            title: '',
            description: '',
            items: items.map((item) => ({
              label: stringOf(item.title) || stringOf(item.label) || 'Metric',
              value: stringOf(item.value) || stringOf(item.description) || '—',
            })),
          },
          { id: `${prefix}-stats` },
        );
        if (stats) nodes.push(stats);
      }
      break;
    case 'faq':
      {
        const faq = makeNode(
          'content.faq',
          {
            title: '',
            items: items.map((item) => ({
              question: stringOf(item.question) || stringOf(item.title) || 'Question',
              answer: stringOf(item.answer) || stringOf(item.description) || 'Answer',
            })),
          },
          { id: `${prefix}-faq` },
        );
        if (faq) nodes.push(faq);
      }
      break;
    case 'screenshots':
      {
        const gallery = makeNode(
          'content.gallery',
          {
            columns: 2,
            items: items.map((item) => ({
              src: stringOf(item.imageUrl) || stringOf(item.src),
              alt: stringOf(item.title) || 'Screenshot',
              caption: stringOf(item.description),
            })),
          },
          { id: `${prefix}-gallery` },
        );
        if (gallery) nodes.push(gallery);
      }
      break;
    case 'commands':
    case 'servers':
      {
        const list = makeNode(
          'data.list',
          {
            title: '',
            provider: type === 'commands' ? 'public.commands' : 'account.servers',
            resource: type === 'commands' ? 'catalog' : 'servers',
            field: type === 'commands' ? 'commands' : 'servers',
            itemField: 'name',
            emptyText: 'Nothing to show yet.',
          },
          { id: `${prefix}-list` },
        );
        if (list) nodes.push(list);
      }
      break;
    case 'custom':
    default:
      if (section.content) {
        const text = makeNode('content.text', { text: section.content }, { id: `${prefix}-content` });
        if (text) nodes.push(text);
      }
      break;
  }
  return nodes;
}

/**
 * Convert a Phase 1 public-site configuration into a canonical composition.
 * The original section objects are preserved under `legacy` on each node and
 * the whole source payload under `document.legacy` so nothing is lost.
 */
export function migratePublicSite(
  config: LegacyPublicSite,
  key: string,
  route = `/p/${key}`,
): CompositionDocument {
  const now = Date.now();
  const docId = `doc_public_${safeId(key, 'page')}`;
  const sections = [...(config.sections ?? [])]
    .filter((section) => section.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const children: CompositionNode[] = [];
  sections.forEach((section, index) => {
    const prefix = `${safeId(section.id, `section-${index}`)}`;
    const inner = sectionChildren(section, prefix);
    const sectionNode = makeNode(
      'structure.section',
      { tone: index % 2 === 0 ? 'default' : 'muted', anchor: safeId(section.id, '') },
      {
        id: `sec_${prefix}`,
        label: section.title ?? section.headline ?? section.type,
        slots: { [DEFAULT_SLOT]: inner },
        legacy: legacyJson(section),
      },
    );
    if (sectionNode) children.push(sectionNode);
  });
  const root: CompositionNode = {
    id: `root_${safeId(key, 'page')}`,
    type: 'structure.page',
    version: 1,
    label: 'Page',
    props: {},
    slots: { [DEFAULT_SLOT]: children },
    layout: { mode: 'flow' },
    responsive: {},
  };
  return {
    kind: 'composition',
    schemaVersion: 1,
    id: docId,
    name: config.metadata?.title ?? key,
    surface: { kind: 'public_page', key, route },
    root,
    metadata: {
      title: config.metadata?.title ?? key,
      description: config.metadata?.description ?? '',
    },
    navigation: config.navigation?.map((item) => ({ ...item })),
    legacy: legacyJson(config),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Convert a Phase 1 dashboard layout into a canonical composition.
 * Widgets become bounded containers that retain their original instance data.
 */
export function migrateDashboardLayout(
  layout: LegacyLayout,
  key: string,
  route = layout.surfaceId,
): CompositionDocument {
  const now = Date.now();
  const breakpoints = layout.breakpoints ?? {};
  const desktop = breakpoints['desktop'];
  const columns = Math.max(1, Math.min(24, desktop?.columns ?? 12));
  const widgets = [...(desktop?.widgets ?? [])].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
  const children: CompositionNode[] = [];
  widgets.forEach((widget, index) => {
    const title = widget.definition?.title ?? widget.widgetId ?? `Widget ${index + 1}`;
    const inner: CompositionNode[] = [];
    const heading = makeNode('content.heading', { text: title, level: '3' }, { id: `w_${index}_heading` });
    if (heading) inner.push(heading);
    const description = widget.definition?.description;
    if (description) {
      const text = makeNode('content.text', { text: description, markdown: false }, { id: `w_${index}_text` });
      if (text) inner.push(text);
    }
    const container = makeNode(
      'structure.container',
      {},
      {
        id: `w_${index}`,
        label: title,
        slots: { [DEFAULT_SLOT]: inner },
        legacy: legacyJson(widget),
      },
    );
    if (!container) return;
    container.layout = {
      mode: 'flow',
      spans: {
        column: Math.max(1, Math.min(columns, widget.colSpan ?? 1)),
        row: Math.max(1, widget.rowSpan ?? 1),
      },
    };
    children.push(container);
  });
  const root: CompositionNode = {
    id: `root_${safeId(key, 'layout')}`,
    type: 'structure.page',
    version: 1,
    label: 'Page',
    props: {},
    slots: { [DEFAULT_SLOT]: children },
    layout: { mode: 'flow' },
    responsive: {},
  };
  return {
    kind: 'composition',
    schemaVersion: 1,
    id: `doc_layout_${safeId(key, 'layout')}`,
    name: key,
    surface: { kind: 'dashboard_page', key, route },
    root,
    metadata: { title: key },
    legacy: legacyJson(layout),
    createdAt: now,
    updatedAt: now,
  };
}

export interface CanonicalSurface {
  kind: SurfaceKind;
  key: string;
  route?: string;
}

/**
 * Detect any supported stored payload and normalize it to a canonical document.
 * Returns null when the payload is not a composition or a known legacy shape.
 */
export function toCanonicalDocument(payload: unknown, surface: CanonicalSurface): CanonicalMigration | null {
  if (isCompositionDocument(payload)) {
    return { document: payload, source: 'composition', migrated: false };
  }
  if (isLegacyPublicSite(payload)) {
    return {
      document: migratePublicSite(payload as LegacyPublicSite, surface.key, surface.route),
      source: 'public_site',
      migrated: true,
    };
  }
  if (isLegacyDashboardLayout(payload)) {
    return {
      document: migrateDashboardLayout(payload as LegacyLayout, surface.key, surface.route),
      source: 'dashboard_layout',
      migrated: true,
    };
  }
  return null;
}
