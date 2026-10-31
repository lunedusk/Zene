import {
  BREAKPOINTS,
  DEFAULT_SLOT,
  type BreakpointId,
  type CompositionNode,
  type JsonValue,
  type LayoutConfig,
  type ResponsiveOverride,
  type StyleConfig,
} from './types.js';
import { deepMerge, isPlainObject } from './schema.js';

export interface ResolvedNode {
  props: CompositionNode['props'];
  layout: LayoutConfig;
  style: StyleConfig;
  hidden: boolean;
  order?: number;
  slotOrder: Record<string, string[]>;
  /** Keys explicitly overridden at this breakpoint (for inspector badges). */
  overridden: {
    props: ReadonlySet<string>;
    layout: ReadonlySet<string>;
    style: ReadonlySet<string>;
    hidden: boolean;
    order: boolean;
  };
}

function overrideFor(node: CompositionNode, bp: BreakpointId): ResponsiveOverride | undefined {
  return node.responsive?.[bp];
}

export function resolveNode(node: CompositionNode, bp: BreakpointId): ResolvedNode {
  const override = overrideFor(node, bp);
  const props = override?.props ? deepMerge(node.props, override.props) : node.props;
  const layout = override?.layout ? deepMerge(node.layout ?? {}, override.layout) : (node.layout ?? {});
  const style = override?.style ? deepMerge(node.style ?? {}, override.style) : (node.style ?? {});
  return {
    props,
    layout,
    style,
    hidden: override?.hidden ?? node.hidden ?? false,
    order: override?.order ?? layout.order,
    slotOrder: override?.slotOrder ?? {},
    overridden: {
      props: new Set(Object.keys(override?.props ?? {})),
      layout: new Set(Object.keys(override?.layout ?? {})),
      style: new Set(Object.keys(override?.style ?? {})),
      hidden: override?.hidden !== undefined,
      order: override?.order !== undefined,
    },
  };
}

export type OverrideSection = 'props' | 'layout' | 'style' | 'hidden' | 'order';

export function isOverridden(
  node: CompositionNode,
  bp: BreakpointId,
  section: OverrideSection,
  key?: string,
): boolean {
  const override = overrideFor(node, bp);
  if (!override) return false;
  if (section === 'hidden') return override.hidden !== undefined;
  if (section === 'order') return override.order !== undefined;
  if (!key) return Object.keys(override[section] ?? {}).length > 0;
  const sectionValue = override[section];
  return isPlainObject(sectionValue) && key in sectionValue;
}

export function setResponsiveOverride(
  node: CompositionNode,
  bp: BreakpointId,
  section: Exclude<OverrideSection, 'hidden' | 'order'>,
  key: string,
  value: JsonValue | undefined,
): CompositionNode {
  const current = node.responsive?.[bp] ?? {};
  const sectionValue: Record<string, JsonValue> = {
    ...((current[section] as Record<string, JsonValue> | undefined) ?? {}),
  };
  if (value === undefined) delete sectionValue[key];
  else sectionValue[key] = value;
  const nextSection = Object.keys(sectionValue).length > 0 ? sectionValue : undefined;
  const nextOverride: ResponsiveOverride = { ...current };
  if (nextSection) {
    (nextOverride as Record<string, unknown>)[section] = nextSection;
  } else {
    delete (nextOverride as Record<string, unknown>)[section];
  }
  return withOverride(node, bp, nextOverride);
}

export function setResponsiveFlag(
  node: CompositionNode,
  bp: BreakpointId,
  key: 'hidden' | 'order',
  value: boolean | number | undefined,
): CompositionNode {
  const current = node.responsive?.[bp] ?? {};
  const next: ResponsiveOverride = { ...current };
  if (value === undefined) delete next[key];
  else if (key === 'hidden' && typeof value === 'boolean') next.hidden = value;
  else if (key === 'order' && typeof value === 'number') next.order = value;
  return withOverride(node, bp, next);
}

export function resetResponsiveOverride(
  node: CompositionNode,
  bp: BreakpointId,
  section?: OverrideSection,
  key?: string,
): CompositionNode {
  const current = node.responsive?.[bp];
  if (!current) return node;
  if (!section) {
    const responsive = { ...(node.responsive ?? {}) };
    delete responsive[bp];
    return { ...node, responsive };
  }
  if (section === 'hidden' || section === 'order') {
    const next = { ...current };
    delete next[section];
    return withOverride(node, bp, next);
  }
  if (!key) {
    const next = { ...current };
    delete next[section];
    return withOverride(node, bp, next);
  }
  const sectionValue = { ...((current[section] as Record<string, unknown> | undefined) ?? {}) };
  delete sectionValue[key];
  const next = { ...current } as Record<string, unknown>;
  if (Object.keys(sectionValue).length > 0) next[section] = sectionValue;
  else delete next[section];
  return withOverride(node, bp, next as ResponsiveOverride);
}

function withOverride(
  node: CompositionNode,
  bp: BreakpointId,
  override: ResponsiveOverride,
): CompositionNode {
  const responsive = { ...(node.responsive ?? {}) };
  if (Object.keys(override).length === 0) delete responsive[bp];
  else responsive[bp] = override;
  return { ...node, responsive };
}

export function orderedChildren(
  node: CompositionNode,
  bp: BreakpointId,
  slot = DEFAULT_SLOT,
): CompositionNode[] {
  const children = node.slots[slot] ?? [];
  const order = overrideFor(node, bp)?.slotOrder?.[slot];
  if (!order || order.length === 0) return children;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...children].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra === rb ? children.indexOf(a) - children.indexOf(b) : ra - rb;
  });
}

export function setSlotOrder(
  node: CompositionNode,
  bp: BreakpointId,
  slot: string,
  order: readonly string[],
): CompositionNode {
  const current = node.responsive?.[bp] ?? {};
  const slotOrder = { ...(current.slotOrder ?? {}) };
  slotOrder[slot] = [...order];
  return withOverride(node, bp, { ...current, slotOrder });
}

export function clearSlotOrder(node: CompositionNode, bp: BreakpointId, slot: string): CompositionNode {
  const current = node.responsive?.[bp];
  if (!current?.slotOrder?.[slot]) return node;
  const slotOrder = { ...current.slotOrder };
  delete slotOrder[slot];
  const next: ResponsiveOverride = { ...current };
  if (Object.keys(slotOrder).length > 0) next.slotOrder = slotOrder;
  else delete next.slotOrder;
  return withOverride(node, bp, next);
}

/** True when any breakpoint contains an explicit override. */
export function hasResponsiveOverrides(node: CompositionNode): boolean {
  if (!node.responsive) return false;
  return BREAKPOINTS.some((bp) => {
    const o = node.responsive?.[bp];
    return !!o && Object.keys(o).length > 0;
  });
}
