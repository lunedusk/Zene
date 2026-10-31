import {
  DEFAULT_SLOT,
  type ComponentDefinition,
  type ComponentCategory,
  type CompositionNode,
  type JsonObject,
  type PropertySchema,
  type RegistryLike,
} from './types.js';
import { createNodeId, cloneJson } from './schema.js';
import { validateProps } from './validate.js';

export class ComponentRegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'duplicate'
      | 'invalid_type'
      | 'invalid_definition'
      | 'invalid_version'
      | 'incompatible'
      | 'plugin_required',
  ) {
    super(message);
    this.name = 'ComponentRegistryError';
  }
}

const TYPE_PATTERN = /^(?!plugin\.)[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9-]*$|^plugin\.[a-z0-9-]+\.[a-z][a-zA-Z0-9-]*$/;
const CATEGORIES: readonly ComponentCategory[] = [
  'structure',
  'content',
  'presentation',
  'navigation',
  'forms',
  'data',
  'states',
  'discord',
];

function validateDefinition(def: ComponentDefinition): void {
  if (!TYPE_PATTERN.test(def.type)) {
    throw new ComponentRegistryError(
      `Component type "${def.type}" must look like "category.name" or "plugin.<pluginId>.<name>"`,
      'invalid_type',
    );
  }
  if (!Number.isInteger(def.version) || def.version < 1) {
    throw new ComponentRegistryError(`Component ${def.type} version must be a positive integer`, 'invalid_version');
  }
  if (!def.name.trim() || !def.description.trim()) {
    throw new ComponentRegistryError(`Component ${def.type} requires a name and description`, 'invalid_definition');
  }
  if (!CATEGORIES.includes(def.category)) {
    throw new ComponentRegistryError(`Component ${def.type} has an unsupported category`, 'invalid_definition');
  }
  if (def.source === 'plugin' && !def.pluginId) {
    throw new ComponentRegistryError(`Plugin component ${def.type} must declare pluginId`, 'plugin_required');
  }
  const keys = new Set<string>();
  for (const schema of def.schema) validateSchema(def.type, schema, keys);
  for (const [key, value] of Object.entries(def.defaults)) {
    if (!keys.has(key)) {
      throw new ComponentRegistryError(`Default "${key}" has no property schema on ${def.type}`, 'invalid_definition');
    }
    if (value === undefined) {
      throw new ComponentRegistryError(`Default "${key}" is undefined on ${def.type}`, 'invalid_definition');
    }
  }
  for (const slot of def.slots ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(slot.name)) {
      throw new ComponentRegistryError(`Slot "${slot.name}" on ${def.type} has an invalid name`, 'invalid_definition');
    }
    if (slot.min !== undefined && slot.max !== undefined && slot.min > slot.max) {
      throw new ComponentRegistryError(`Slot "${slot.name}" on ${def.type} has min > max`, 'invalid_definition');
    }
  }
  const slotNames = new Set<string>();
  for (const slot of def.slots ?? []) {
    if (slotNames.has(slot.name)) {
      throw new ComponentRegistryError(`Duplicate slot "${slot.name}" on ${def.type}`, 'invalid_definition');
    }
    slotNames.add(slot.name);
  }
  const defaultsResult = validateProps(def, def.defaults);
  if (!defaultsResult.ok) {
    throw new ComponentRegistryError(
      `Defaults for ${def.type} fail schema validation: ${defaultsResult.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.message)
        .join('; ')}`,
      'invalid_definition',
    );
  }
}

function validateSchema(type: string, schema: PropertySchema, seen: Set<string>): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(schema.key)) {
    throw new ComponentRegistryError(`Property "${schema.key}" on ${type} has an invalid key`, 'invalid_definition');
  }
  if (seen.has(schema.key)) {
    throw new ComponentRegistryError(`Duplicate property "${schema.key}" on ${type}`, 'invalid_definition');
  }
  seen.add(schema.key);
  if (!schema.label.trim()) {
    throw new ComponentRegistryError(`Property "${schema.key}" on ${type} needs a label`, 'invalid_definition');
  }
  if (schema.control === 'select') {
    if (!schema.options?.length) {
      throw new ComponentRegistryError(`Select property "${schema.key}" on ${type} needs options`, 'invalid_definition');
    }
    const values = new Set<string>();
    for (const option of schema.options) {
      if (values.has(option.value)) {
        throw new ComponentRegistryError(`Select property "${schema.key}" on ${type} has duplicate options`, 'invalid_definition');
      }
      values.add(option.value);
    }
  }
  if (schema.control === 'list' && !schema.itemFields?.length) {
    throw new ComponentRegistryError(`List property "${schema.key}" on ${type} needs itemFields`, 'invalid_definition');
  }
}

export class ComponentRegistry implements RegistryLike {
  private readonly definitions = new Map<string, ComponentDefinition>();

  register(def: ComponentDefinition): void {
    validateDefinition(def);
    if (this.definitions.has(def.type)) {
      throw new ComponentRegistryError(`Component "${def.type}" is already registered`, 'duplicate');
    }
    this.definitions.set(def.type, Object.freeze({ ...def }));
  }

  registerMany(defs: readonly ComponentDefinition[]): void {
    const staged: ComponentDefinition[] = [];
    const seen = new Set<string>();
    for (const def of defs) {
      if (seen.has(def.type) || this.definitions.has(def.type)) {
        throw new ComponentRegistryError(`Component "${def.type}" is already registered`, 'duplicate');
      }
      seen.add(def.type);
      validateDefinition(def);
      staged.push(def);
    }
    for (const def of staged) this.definitions.set(def.type, Object.freeze({ ...def }));
  }

  unregister(type: string): boolean {
    return this.definitions.delete(type);
  }

  unregisterPlugin(pluginId: string): number {
    let removed = 0;
    for (const [type, def] of this.definitions) {
      if (def.pluginId === pluginId) {
        this.definitions.delete(type);
        removed += 1;
      }
    }
    return removed;
  }

  get(type: string): ComponentDefinition | undefined {
    return this.definitions.get(type);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  list(): readonly ComponentDefinition[] {
    return [...this.definitions.values()].sort((a, b) => {
      const cat = CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
      return cat !== 0 ? cat : a.name.localeCompare(b.name);
    });
  }

  byCategory(): Map<ComponentCategory, ComponentDefinition[]> {
    const out = new Map<ComponentCategory, ComponentDefinition[]>();
    for (const def of this.list()) {
      const list = out.get(def.category) ?? [];
      list.push(def);
      out.set(def.category, list);
    }
    return out;
  }

  clear(): void {
    this.definitions.clear();
  }
}

export function defaultProps(def: ComponentDefinition): JsonObject {
  return cloneJson({ ...def.defaults });
}

export function createDefaultNode(def: ComponentDefinition, id?: string): CompositionNode {
  const slots: Record<string, CompositionNode[]> = {};
  for (const slot of def.slots ?? [{ name: DEFAULT_SLOT, label: 'Children' }]) {
    slots[slot.name] = [];
  }
  if (Object.keys(slots).length === 0) slots[DEFAULT_SLOT] = [];
  return {
    id: id ?? createNodeId(),
    type: def.type,
    version: def.version,
    label: def.name,
    props: defaultProps(def),
    slots,
    layout: defaultLayoutFor(def),
    responsive: {},
  };
}

export function defaultLayoutFor(def: ComponentDefinition): CompositionNode['layout'] {
  const primary = def.layoutModes?.[0];
  switch (primary) {
    case 'stack':
      return { mode: 'stack', gap: 12 };
    case 'row':
      return { mode: 'row', gap: 12, wrap: true };
    case 'grid':
      return { mode: 'grid', columns: 3, gap: 16 };
    case 'split':
      return { mode: 'split', ratio: 0.5, gap: 16 };
    case 'overlay':
      return { mode: 'overlay' };
    case 'flow':
    default:
      return { mode: 'flow' };
  }
}

export function isCategory(value: string): value is ComponentCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** The application-wide built-in registry (populated by builtins/index). */
export const builtinRegistry = new ComponentRegistry();

/** Registry used by runtime components and editors. */
export const compositionRegistry = builtinRegistry;
