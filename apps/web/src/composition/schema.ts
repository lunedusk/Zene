import {
  BREAKPOINTS,
  COMPOSITION_KIND,
  COMPOSITION_SCHEMA_VERSION,
  DEFAULT_SLOT,
  type BreakpointId,
  type CompositionDocument,
  type CompositionNode,
  type JsonObject,
  type JsonValue,
  type SurfaceKind,
} from './types.js';

export function createNodeId(prefix = 'n'): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${cryptoObj.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDocumentId(): string {
  return createNodeId('doc');
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every((v) => isJsonValue(v, depth + 1));
  if (isPlainObject(value)) {
    return Object.values(value).every((v) => v !== undefined && isJsonValue(v, depth + 1));
  }
  return false;
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneJson(v)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneJson(v as JsonValue);
    return out as T;
  }
  return value;
}

/** Deep clone a document without JSON serialization traps (undefined keys dropped). */
export function cloneDocument(doc: CompositionDocument): CompositionDocument {
  return cloneJson(doc as unknown as JsonValue) as unknown as CompositionDocument;
}

export function createNode(
  type: string,
  props: JsonObject = {},
  options: Partial<Omit<CompositionNode, 'id' | 'type' | 'props'>> & { id?: string } = {},
): CompositionNode {
  const { id, ...rest } = options;
  return {
    id: id ?? createNodeId(),
    type,
    props: cloneJson(props),
    slots: rest.slots ? (cloneJson(rest.slots as unknown as JsonValue) as unknown as Record<string, CompositionNode[]>) : {},
    ...rest,
  };
}

export function createDocument(input: {
  name: string;
  surface: { kind: SurfaceKind; key: string; route?: string };
  rootType?: string;
  rootProps?: JsonObject;
  id?: string;
  rootId?: string;
}): CompositionDocument {
  const rootId = input.rootId ?? createNodeId('root');
  const root: CompositionNode = {
    id: rootId,
    type: input.rootType ?? 'structure.page',
    props: cloneJson(input.rootProps ?? {}),
    slots: { [DEFAULT_SLOT]: [] },
    layout: { mode: 'flow' },
  };
  const now = Date.now();
  return {
    kind: COMPOSITION_KIND,
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: input.id ?? createDocumentId(),
    name: input.name,
    surface: input.surface,
    root,
    metadata: { title: input.name },
    createdAt: now,
    updatedAt: now,
  };
}

export function isCompositionDocument(value: unknown): value is CompositionDocument {
  if (!isPlainObject(value)) return false;
  return (
    value.kind === COMPOSITION_KIND &&
    value.schemaVersion === COMPOSITION_SCHEMA_VERSION &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isPlainObject(value.root) &&
    isPlainObject(value.surface)
  );
}

/** True when the payload is a legacy public-site config. */
export function isLegacyPublicSite(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.sections);
}

/** True when the payload is a legacy dashboard layout. */
export function isLegacyDashboardLayout(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isPlainObject(value.breakpoints) && typeof value.surfaceId === 'string';
}

export function emptySlots(): Record<string, CompositionNode[]> {
  return { [DEFAULT_SLOT]: [] };
}

export function breakpointFromWidth(width: number): BreakpointId {
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/**
 * Deep-merge plain JSON objects. Arrays and primitives replace.
 * Used for base + responsive override resolution and token composition.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

/** Remove a key path from an object immutably (used for reset-to-inherited). */
export function omitPath<T>(value: T, path: readonly string[]): T {
  if (path.length === 0 || !isPlainObject(value)) return value;
  const [head, ...rest] = path as [string, ...string[]];
  if (!(head in value)) return value;
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (rest.length === 0) {
    delete copy[head];
  } else if (isPlainObject(copy[head])) {
    copy[head] = omitPath(copy[head], rest);
  }
  return copy as T;
}

export function getPath(value: unknown, path: readonly string[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Validate a link/media URL: http(s), site-relative path, mailto, or empty. */
export function isSafeUrl(value: string, kind: 'link' | 'media' = 'link'): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith('//')) return false;
  if (v.startsWith('/')) return true;
  if (v.startsWith('#')) return kind === 'link';
  const lower = v.toLowerCase();
  if (kind === 'link' && (lower.startsWith('mailto:') || lower.startsWith('tel:'))) return true;
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
