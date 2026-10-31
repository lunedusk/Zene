/**
 * Canonical composition contracts.
 *
 * This module is React-free. It is the single source of truth for document
 * shape, responsive overrides, layout semantics, property schemas, and the
 * component-definition contract used by the renderer, inspector, insert
 * library, and runtime validation.
 */

export const COMPOSITION_SCHEMA_VERSION = 1 as const;
export const COMPOSITION_KIND = 'composition' as const;

export type BreakpointId = 'desktop' | 'tablet' | 'mobile';
export const BREAKPOINTS: readonly BreakpointId[] = ['desktop', 'tablet', 'mobile'] as const;

export const BREAKPOINT_VIEWPORTS: Record<BreakpointId, { width: number; label: string }> = {
  desktop: { width: 1280, label: 'Desktop' },
  tablet: { width: 834, label: 'Tablet' },
  mobile: { width: 390, label: 'Mobile' },
};

export type SurfaceKind = 'public_page' | 'dashboard_page' | 'owner_page' | 'custom';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const DEFAULT_SLOT = 'default';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export type LayoutMode =
  | 'flow'
  | 'stack'
  | 'row'
  | 'grid'
  | 'split'
  | 'overlay';

export type Alignment = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

export interface Dimension {
  mode: 'auto' | 'content' | 'fill' | 'fixed';
  value?: number;
  unit?: 'px' | '%' | 'rem';
}

export interface Spacing {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface LayoutConfig {
  mode?: LayoutMode;
  gap?: number;
  wrap?: boolean;
  alignItems?: Alignment;
  justify?: Alignment;
  width?: Dimension;
  height?: Dimension;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;
  grow?: number;
  shrink?: number;
  basis?: Dimension;
  columns?: number;
  rows?: number;
  columnGap?: number;
  rowGap?: number;
  spans?: { column?: number; row?: number };
  place?: { column?: number; row?: number };
  ratio?: number;
  minStart?: Dimension;
  minEnd?: Dimension;
  overflow?: 'visible' | 'hidden' | 'auto' | 'scroll';
  position?: 'relative' | 'absolute' | 'sticky' | 'fixed';
  offsets?: { top?: number; right?: number; bottom?: number; left?: number };
  zIndex?: number;
  aspectRatio?: string;
  padding?: Spacing;
  margin?: Spacing;
  order?: number;
  fullBleed?: boolean;
}

export type BackgroundKind = 'none' | 'color' | 'gradient' | 'image';

export interface BackgroundConfig {
  kind: BackgroundKind;
  color?: string;
  gradient?: string;
  imageUrl?: string;
  position?: string;
  size?: 'cover' | 'contain' | 'auto';
  overlay?: string;
}

export interface BorderConfig {
  width?: number;
  color?: string;
  style?: 'none' | 'solid' | 'dashed';
}

export interface StyleConfig {
  background?: BackgroundConfig;
  color?: string;
  fontFamily?: 'sans' | 'serif' | 'mono' | string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  border?: BorderConfig;
  radius?: number;
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  opacity?: number;
  blur?: number;
  stickyTop?: number;
}

/* ------------------------------------------------------------------ */
/* Data / conditions / interactions                                    */
/* ------------------------------------------------------------------ */

export interface DataBinding {
  provider: string;
  resource?: string;
  field?: string;
  fallback?: JsonValue;
}

export type ConditionOperator = 'equals' | 'not_equals' | 'truthy' | 'falsy' | 'exists' | 'in';

export interface Condition {
  source: 'session' | 'data' | 'state' | 'document';
  key?: string;
  provider?: string;
  resource?: string;
  field?: string;
  operator: ConditionOperator;
  value?: JsonValue;
}

export type InteractionAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'scroll-to'; nodeId: string }
  | { kind: 'set-state'; key: string; value: JsonValue }
  | { kind: 'submit-action'; actionId: string };

export interface Interaction {
  trigger: 'click' | 'submit';
  action: InteractionAction;
}

export interface AccessibilityConfig {
  label?: string;
  description?: string;
  role?: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export interface ResponsiveOverride {
  props?: JsonObject;
  layout?: LayoutConfig;
  style?: StyleConfig;
  hidden?: boolean;
  order?: number;
  slotOrder?: Record<string, string[]>;
}

export interface CompositionNode {
  id: string;
  type: string;
  /** Component definition version this node was authored against. */
  version?: number;
  label?: string;
  props: JsonObject;
  /** Ordered, named child slots. `default` is the common child list. */
  slots: Record<string, CompositionNode[]>;
  layout?: LayoutConfig;
  style?: StyleConfig;
  responsive?: Partial<Record<BreakpointId, ResponsiveOverride>>;
  hidden?: boolean;
  locked?: boolean;
  bindings?: Record<string, DataBinding>;
  conditions?: Condition[];
  interactions?: Interaction[];
  a11y?: AccessibilityConfig;
  /** Preserved source data for lossless legacy imports. */
  legacy?: JsonObject;
}

export interface CompositionTheme {
  colorMode?: 'light' | 'dark' | 'system';
  tokens?: Record<string, string>;
}

export interface CompositionSurface {
  kind: SurfaceKind;
  key: string;
  route?: string;
}

export interface CompositionDocument {
  kind: typeof COMPOSITION_KIND;
  schemaVersion: typeof COMPOSITION_SCHEMA_VERSION;
  id: string;
  name: string;
  surface: CompositionSurface;
  root: CompositionNode;
  theme?: CompositionTheme;
  metadata?: {
    title?: string;
    description?: string;
    noIndex?: boolean;
  };
  navigation?: Array<{ id: string; label: string; href: string; external?: boolean }>;
  legacy?: JsonObject;
  createdAt?: number;
  updatedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Property schema / component definitions                             */
/* ------------------------------------------------------------------ */

export type PropertyGroup =
  | 'content'
  | 'layout'
  | 'style'
  | 'media'
  | 'data'
  | 'visibility'
  | 'interactions'
  | 'a11y'
  | 'advanced';

export type PropertyControl =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'number'
  | 'range'
  | 'boolean'
  | 'select'
  | 'color'
  | 'url'
  | 'image-url'
  | 'list'
  | 'binding';

export interface ListFieldSchema {
  key: string;
  label: string;
  control: 'text' | 'textarea' | 'url' | 'image-url' | 'number';
  required?: boolean;
}

export interface PropertySchema {
  key: string;
  label: string;
  group: PropertyGroup;
  control: PropertyControl;
  required?: boolean;
  description?: string;
  placeholder?: string;
  defaultValue?: JsonValue;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  itemFields?: ListFieldSchema[];
  maxItems?: number;
  itemDefault?: JsonObject;
}

export type ComponentCategory =
  | 'structure'
  | 'content'
  | 'presentation'
  | 'navigation'
  | 'forms'
  | 'data'
  | 'states'
  | 'discord';

export interface SlotDefinition {
  name: string;
  label: string;
  /** Allowed child component type IDs; `'*'` allows any non-root component. */
  accepts?: readonly string[] | '*';
  min?: number;
  max?: number;
  /** Human explanation used by the insert library when insertion is invalid. */
  description?: string;
}

export type RuntimeState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'unavailable'
  | 'reconnecting'
  | 'denied'
  | 'disabled'
  | 'success';

export interface ComponentA11yContract {
  role?: string;
  requiresLabel?: boolean;
  headingLevels?: boolean;
}

/**
 * React-independent registry metadata plus a render component.
 * `render` is typed loosely here so this module stays React-free; the
 * renderer/registry supply the precise React type.
 */
export interface ComponentDefinition {
  type: string;
  version: number;
  name: string;
  description: string;
  category: ComponentCategory;
  keywords: readonly string[];
  defaults: JsonObject;
  schema: readonly PropertySchema[];
  slots?: readonly SlotDefinition[];
  layoutModes?: readonly LayoutMode[];
  responsive?: boolean;
  resizable?: boolean;
  interactive?: boolean;
  rootOnly?: boolean;
  allowedParents?: readonly string[];
  requiresBits?: readonly string[];
  states?: readonly RuntimeState[];
  a11y?: ComponentA11yContract;
  source: 'builtin' | 'plugin';
  pluginId?: string;
  /** Bound at runtime by the React registry. */
  render?: unknown;
  /** Optional custom inspector panel id. */
  inspectorPanel?: string;
}

export interface CompositionDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
  property?: string;
}

export interface CompositionValidationResult {
  ok: boolean;
  diagnostics: CompositionDiagnostic[];
}

export interface ComponentValidationResult {
  valid: boolean;
  errors: string[];
}

/** Minimal registry surface required by document validation/operations. */
export interface RegistryLike {
  get(type: string): ComponentDefinition | undefined;
  list(): readonly ComponentDefinition[];
  has(type: string): boolean;
}

export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_NODES = 1200;
export const MAX_DEPTH = 24;
export const MAX_SLOT_CHILDREN = 200;
