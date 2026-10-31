import {
  BREAKPOINTS,
  DEFAULT_SLOT,
  MAX_DEPTH,
  MAX_DOCUMENT_BYTES,
  MAX_NODES,
  MAX_SLOT_CHILDREN,
  type ComponentDefinition,
  type CompositionDiagnostic,
  type CompositionDocument,
  type CompositionNode,
  type CompositionValidationResult,
  type JsonObject,
  type JsonValue,
  type PropertySchema,
  type RegistryLike,
} from './types.js';
import { isPlainObject, isSafeUrl } from './schema.js';
import { isApprovedBinding } from './bindings.js';

interface WalkContext {
  diagnostics: CompositionDiagnostic[];
  registry: RegistryLike;
  ids: Map<string, string>;
  nodeCount: number;
  seen: WeakSet<object>;
  nodeIds: Set<string>;
}

function push(
  ctx: WalkContext,
  severity: CompositionDiagnostic['severity'],
  code: string,
  message: string,
  nodeId?: string,
  path?: string,
  property?: string,
): void {
  ctx.diagnostics.push({ severity, code, message, nodeId, path, property });
}

function validateUrlProperty(
  ctx: WalkContext,
  schema: PropertySchema,
  value: string,
  node: CompositionNode,
  path: string,
): void {
  if (schema.control === 'url' || schema.control === 'image-url') {
    const kind = schema.control === 'image-url' ? 'media' : 'link';
    if (!isSafeUrl(value, kind)) {
      push(ctx, 'error', 'unsafe_url', `${schema.label} must be an http(s), site-relative, or mailto link`, node.id, path, schema.key);
    }
  }
}

function validatePropValue(
  ctx: WalkContext,
  schema: PropertySchema,
  value: unknown,
  node: CompositionNode,
  path: string,
): void {
  const propPath = `${path}.props.${schema.key}`;
  if (value === undefined || value === null) {
    if (schema.required) {
      push(ctx, 'error', 'missing_property', `${schema.label} is required`, node.id, propPath, schema.key);
    }
    return;
  }
  switch (schema.control) {
    case 'text':
    case 'textarea':
    case 'markdown':
    case 'color':
    case 'url':
    case 'image-url': {
      if (typeof value !== 'string') {
        push(ctx, 'error', 'invalid_property', `${schema.label} must be text`, node.id, propPath, schema.key);
        return;
      }
      if (schema.required && value.trim().length === 0) {
        push(ctx, 'error', 'missing_property', `${schema.label} is required`, node.id, propPath, schema.key);
      }
      if (value.length > 200_000) {
        push(ctx, 'error', 'property_too_large', `${schema.label} is too large`, node.id, propPath, schema.key);
      }
      validateUrlProperty(ctx, schema, value, node, propPath);
      return;
    }
    case 'number':
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        push(ctx, 'error', 'invalid_property', `${schema.label} must be a number`, node.id, propPath, schema.key);
        return;
      }
      if (schema.min !== undefined && value < schema.min) {
        push(ctx, 'error', 'property_out_of_range', `${schema.label} must be at least ${schema.min}`, node.id, propPath, schema.key);
      }
      if (schema.max !== undefined && value > schema.max) {
        push(ctx, 'error', 'property_out_of_range', `${schema.label} must be at most ${schema.max}`, node.id, propPath, schema.key);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        push(ctx, 'error', 'invalid_property', `${schema.label} must be true or false`, node.id, propPath, schema.key);
      }
      return;
    }
    case 'select': {
      if (typeof value !== 'string') {
        push(ctx, 'error', 'invalid_property', `${schema.label} must be one of the allowed values`, node.id, propPath, schema.key);
        return;
      }
      const allowed = schema.options?.map((o) => o.value) ?? [];
      if (allowed.length > 0 && !allowed.includes(value)) {
        push(ctx, 'error', 'invalid_property', `${schema.label} has an unsupported value`, node.id, propPath, schema.key);
      }
      return;
    }
    case 'binding': {
      if (typeof value !== 'string') {
        push(ctx, 'error', 'invalid_property', `${schema.label} must be a binding reference`, node.id, propPath, schema.key);
      }
      return;
    }
    case 'list': {
      if (!Array.isArray(value)) {
        push(ctx, 'error', 'invalid_property', `${schema.label} must be a list`, node.id, propPath, schema.key);
        return;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        push(ctx, 'error', 'property_out_of_range', `${schema.label} supports at most ${schema.maxItems} items`, node.id, propPath, schema.key);
      }
      value.forEach((item, index) => {
        if (!isPlainObject(item)) {
          push(ctx, 'error', 'invalid_property', `${schema.label} item ${index + 1} must be an object`, node.id, `${propPath}[${index}]`, schema.key);
          return;
        }
        for (const field of schema.itemFields ?? []) {
          const fieldValue = item[field.key];
          const fieldPath = `${propPath}[${index}].${field.key}`;
          if (field.required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
            push(ctx, 'error', 'missing_property', `${field.label} is required`, node.id, fieldPath, field.key);
            continue;
          }
          if (fieldValue === undefined || fieldValue === null) continue;
          if (field.control === 'number') {
            if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
              push(ctx, 'error', 'invalid_property', `${field.label} must be a number`, node.id, fieldPath, field.key);
            }
          } else if (typeof fieldValue !== 'string') {
            push(ctx, 'error', 'invalid_property', `${field.label} must be text`, node.id, fieldPath, field.key);
          } else if (field.control === 'url' && !isSafeUrl(fieldValue)) {
            push(ctx, 'error', 'unsafe_url', `${field.label} must be a safe link`, node.id, fieldPath, field.key);
          } else if (field.control === 'image-url' && !isSafeUrl(fieldValue, 'media')) {
            push(ctx, 'error', 'unsafe_url', `${field.label} must be a safe media URL`, node.id, fieldPath, field.key);
          }
        }
      });
      return;
    }
    default: {
      push(ctx, 'error', 'unsupported_control', `Unknown property control for ${schema.key}`, node.id, propPath, schema.key);
    }
  }
}

function validateDefinitionProps(
  ctx: WalkContext,
  def: ComponentDefinition,
  node: CompositionNode,
  path: string,
): void {
  const schemaKeys = new Set(def.schema.map((s) => s.key));
  for (const key of Object.keys(node.props)) {
    if (!schemaKeys.has(key)) {
      // Preserve, but surface as a warning so unknown user data is never silently dropped.
      push(ctx, 'warning', 'unknown_property', `Property "${key}" is not declared by ${def.type}`, node.id, `${path}.props.${key}`, key);
    }
  }
  for (const schema of def.schema) {
    validatePropValue(ctx, schema, node.props[schema.key], node, path);
  }
}

function validateBindings(ctx: WalkContext, node: CompositionNode, path: string): void {
  if (!node.bindings) return;
  for (const [key, binding] of Object.entries(node.bindings)) {
    if (!isPlainObject(binding) || typeof binding.provider !== 'string') {
      push(ctx, 'error', 'invalid_binding', 'Binding must declare an approved provider', node.id, `${path}.bindings.${key}`, key);
      continue;
    }
    if (!isApprovedBinding(binding)) {
      push(ctx, 'error', 'unknown_binding', `Binding provider/resource "${binding.provider}${binding.resource ? `.${binding.resource}` : ''}" is not approved`, node.id, `${path}.bindings.${key}`, key);
    }
  }
}

function validateConditions(ctx: WalkContext, node: CompositionNode, path: string): void {
  const allowedSources = new Set(['session', 'data', 'state', 'document']);
  const allowedOperators = new Set(['equals', 'not_equals', 'truthy', 'falsy', 'exists', 'in']);
  (node.conditions ?? []).forEach((c, index) => {
    const p = `${path}.conditions[${index}]`;
    if (!isPlainObject(c) || !allowedSources.has(String(c.source))) {
      push(ctx, 'error', 'invalid_condition', 'Condition source is not supported', node.id, p);
      return;
    }
    if (!allowedOperators.has(String(c.operator))) {
      push(ctx, 'error', 'invalid_condition', 'Condition operator is not supported', node.id, p);
    }
    if (c.provider !== undefined && !isApprovedBinding({ provider: String(c.provider), resource: c.resource as string | undefined, field: c.field as string | undefined })) {
      push(ctx, 'error', 'unknown_binding', 'Condition references an unapproved data provider', node.id, p);
    }
  });
}

function validateInteractions(ctx: WalkContext, node: CompositionNode, path: string): void {
  const allowedKinds = new Set(['navigate', 'external', 'scroll-to', 'set-state', 'submit-action']);
  (node.interactions ?? []).forEach((i, index) => {
    const p = `${path}.interactions[${index}]`;
    if (!isPlainObject(i) || (i.trigger !== 'click' && i.trigger !== 'submit')) {
      push(ctx, 'error', 'invalid_interaction', 'Interaction trigger must be click or submit', node.id, p);
      return;
    }
    const action = i.action;
    if (!isPlainObject(action) || !allowedKinds.has(String(action.kind))) {
      push(ctx, 'error', 'invalid_interaction', 'Interaction action is not supported', node.id, p);
      return;
    }
    if (action.kind === 'navigate' && (typeof action.to !== 'string' || !isSafeUrl(action.to))) {
      push(ctx, 'error', 'unsafe_url', 'Navigation target is not safe', node.id, `${p}.action.to`);
    }
    if (action.kind === 'external') {
      if (typeof action.href !== 'string' || !/^https?:\/\//i.test(action.href) || !isSafeUrl(action.href)) {
        push(ctx, 'error', 'unsafe_url', 'External link must be an http(s) URL', node.id, `${p}.action.href`);
      }
    }
    if (action.kind === 'scroll-to' && typeof action.nodeId !== 'string') {
      push(ctx, 'error', 'invalid_interaction', 'Scroll target must be a node id', node.id, p);
    }
    if (action.kind === 'submit-action' && (typeof action.actionId !== 'string' || !action.actionId)) {
      push(ctx, 'error', 'invalid_interaction', 'Approved action id is required', node.id, p);
    }
  });
}

function validateNode(
  ctx: WalkContext,
  node: unknown,
  path: string,
  depth: number,
  parentType: string | undefined,
  root: boolean,
): void {
  if (depth > MAX_DEPTH) {
    push(ctx, 'error', 'max_depth', `Composition nesting exceeds ${MAX_DEPTH} levels`, isPlainObject(node) && typeof node.id === 'string' ? node.id : undefined, path);
    return;
  }
  if (!isPlainObject(node)) {
    push(ctx, 'error', 'invalid_node', 'Node must be an object', undefined, path);
    return;
  }
  if (ctx.seen.has(node)) {
    push(ctx, 'error', 'cyclic_node', 'Node reuses an object reference (cycle or duplicate subtree reference)', typeof node.id === 'string' ? node.id : undefined, path);
    return;
  }
  ctx.seen.add(node);
  ctx.nodeCount += 1;
  if (ctx.nodeCount > MAX_NODES) {
    if (ctx.nodeCount === MAX_NODES + 1) {
      push(ctx, 'error', 'too_many_nodes', `Composition exceeds ${MAX_NODES} nodes`);
    }
    return;
  }
  if (typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(node.id)) {
    push(ctx, 'error', 'invalid_node_id', 'Node id must be 1-80 characters of letters, digits, _ or -', undefined, path);
    return;
  }
  const nodeId = node.id;
  if (ctx.ids.has(nodeId)) {
    push(ctx, 'error', 'duplicate_node_id', `Duplicate node id "${nodeId}"`, nodeId, path);
  } else {
    ctx.ids.set(nodeId, path);
    ctx.nodeIds.add(nodeId);
  }
  if (typeof node.type !== 'string') {
    push(ctx, 'error', 'missing_component_type', 'Node type is required', nodeId, path);
    return;
  }
  const def = ctx.registry.get(node.type);
  if (!def) {
    push(ctx, 'error', 'unknown_component', `Unknown component type "${node.type}"`, nodeId, path, 'type');
    return;
  }
  if (root && !def.rootOnly) {
    push(ctx, 'error', 'invalid_root', `Root must be a page component, got "${node.type}"`, nodeId, path, 'type');
  }
  if (!root && def.rootOnly) {
    push(ctx, 'error', 'invalid_component_placement', `${def.name} can only be the page root`, nodeId, path, 'type');
  }
  if (def.allowedParents && parentType && !def.allowedParents.includes(parentType)) {
    push(ctx, 'error', 'invalid_parent', `${def.name} cannot be placed inside ${parentType}`, nodeId, path, 'type');
  }
  if (!isPlainObject(node.props)) {
    push(ctx, 'error', 'invalid_props', 'Node props must be an object', nodeId, `${path}.props`);
  } else {
    validateDefinitionProps(ctx, def, node as unknown as CompositionNode, path);
  }

  const slots = isPlainObject(node.slots) ? node.slots : {};
  const declared = new Map((def.slots ?? []).map((s) => [s.name, s]));
  for (const [slotName, children] of Object.entries(slots)) {
    const slotPath = `${path}.slots.${slotName}`;
    if (!Array.isArray(children)) {
      push(ctx, 'error', 'invalid_slot', `Slot "${slotName}" must be an array`, nodeId, slotPath);
      continue;
    }
    if (children.length > MAX_SLOT_CHILDREN) {
      push(ctx, 'error', 'slot_too_large', `Slot "${slotName}" exceeds ${MAX_SLOT_CHILDREN} children`, nodeId, slotPath);
    }
    const slotDef = declared.get(slotName);
    if (!slotDef) {
      push(ctx, 'warning', 'unknown_slot', `Slot "${slotName}" is not declared by ${def.type}`, nodeId, slotPath);
    } else {
      if (slotDef.max !== undefined && children.length > slotDef.max) {
        push(ctx, 'error', 'slot_limit', `${def.name} accepts at most ${slotDef.max} items in ${slotDef.label}`, nodeId, slotPath);
      }
      if (slotDef.min !== undefined && children.length < slotDef.min) {
        push(ctx, 'error', 'slot_minimum', `${def.name} requires at least ${slotDef.min} item(s) in ${slotDef.label}`, nodeId, slotPath);
      }
    }
    children.forEach((child, index) => {
      const childType = isPlainObject(child) && typeof child.type === 'string' ? child.type : undefined;
      if (slotDef && slotDef.accepts && slotDef.accepts !== '*') {
        if (!childType || !slotDef.accepts.includes(childType)) {
          push(ctx, 'error', 'invalid_slot_child', `${def.name} does not accept ${childType ?? 'this component'} in ${slotDef.label}`, childType ? (child as { id?: string }).id : undefined, `${slotPath}[${index}]`);
        }
      }
      validateNode(ctx, child, `${slotPath}[${index}]`, depth + 1, def.type, false);
    });
  }

  if (node.hidden !== undefined && typeof node.hidden !== 'boolean') {
    push(ctx, 'error', 'invalid_property', 'hidden must be a boolean', nodeId, `${path}.hidden`);
  }
  if (node.locked !== undefined && typeof node.locked !== 'boolean') {
    push(ctx, 'error', 'invalid_property', 'locked must be a boolean', nodeId, `${path}.locked`);
  }
  if (node.label !== undefined && typeof node.label !== 'string') {
    push(ctx, 'error', 'invalid_property', 'label must be text', nodeId, `${path}.label`);
  }
  if (node.layout !== undefined && !isPlainObject(node.layout)) {
    push(ctx, 'error', 'invalid_layout', 'layout must be an object', nodeId, `${path}.layout`);
  }
  if (node.style !== undefined && !isPlainObject(node.style)) {
    push(ctx, 'error', 'invalid_style', 'style must be an object', nodeId, `${path}.style`);
  }
  if (node.responsive !== undefined) {
    if (!isPlainObject(node.responsive)) {
      push(ctx, 'error', 'invalid_responsive', 'responsive must be an object', nodeId, `${path}.responsive`);
    } else {
      for (const bp of Object.keys(node.responsive)) {
        if (!(BREAKPOINTS as readonly string[]).includes(bp)) {
          push(ctx, 'error', 'invalid_breakpoint', `Unsupported breakpoint "${bp}"`, nodeId, `${path}.responsive.${bp}`);
        }
      }
    }
  }
  validateBindings(ctx, node as unknown as CompositionNode, path);
  validateConditions(ctx, node as unknown as CompositionNode, path);
  validateInteractions(ctx, node as unknown as CompositionNode, path);
}

export function validateDocument(
  doc: unknown,
  registry: RegistryLike,
  options: { maxBytes?: number } = {},
): CompositionValidationResult {
  const diagnostics: CompositionDiagnostic[] = [];
  const ctx: WalkContext = {
    diagnostics,
    registry,
    ids: new Map(),
    nodeCount: 0,
    seen: new WeakSet(),
    nodeIds: new Set(),
  };

  if (!isPlainObject(doc)) {
    return { ok: false, diagnostics: [{ severity: 'error', code: 'invalid_document', message: 'Document must be an object' }] };
  }
  if (doc.kind !== 'composition') {
    diagnostics.push({ severity: 'error', code: 'invalid_kind', message: 'Document kind must be "composition"' });
  }
  if (doc.schemaVersion !== 1) {
    diagnostics.push({
      severity: 'error',
      code: 'unsupported_schema_version',
      message: `Unsupported schema version ${String(doc.schemaVersion)} (expected 1)`,
    });
  }
  if (typeof doc.id !== 'string' || !doc.id) {
    diagnostics.push({ severity: 'error', code: 'missing_document_id', message: 'Document id is required' });
  }
  if (typeof doc.name !== 'string' || !doc.name.trim()) {
    diagnostics.push({ severity: 'error', code: 'missing_document_name', message: 'Document name is required' });
  }
  if (!isPlainObject(doc.surface) || typeof doc.surface.kind !== 'string' || typeof doc.surface.key !== 'string') {
    diagnostics.push({ severity: 'error', code: 'invalid_surface', message: 'Document surface {kind,key} is required' });
  }
  const merged = diagnostics.length > 0 ? diagnostics : ctx.diagnostics;
  if (!isPlainObject(doc.root)) {
    merged.push({ severity: 'error', code: 'missing_root', message: 'Document root node is required' });
    return { ok: false, diagnostics: merged };
  }
  validateNode(ctx, doc.root, 'root', 0, undefined, true);

  const docObj = doc as unknown as CompositionDocument;

  // Scroll targets must resolve to real nodes.
  const interactionSeen = new WeakSet<object>();
  const visitForInteractions = (node: CompositionNode): void => {
    if (interactionSeen.has(node)) return;
    interactionSeen.add(node);
    for (const interaction of node.interactions ?? []) {
      if (interaction.action.kind === 'scroll-to' && !ctx.nodeIds.has(interaction.action.nodeId)) {
        diagnostics.push({
          severity: 'error',
          code: 'missing_scroll_target',
          message: `Scroll target "${interaction.action.nodeId}" does not exist`,
          nodeId: node.id,
        });
      }
    }
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) visitForInteractions(child);
    }
  };
  visitForInteractions(docObj.root);

  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  try {
    const size = JSON.stringify(doc).length;
    if (size > maxBytes) {
      diagnostics.push({
        severity: 'error',
        code: 'document_too_large',
        message: `Document is ${size} bytes; maximum is ${maxBytes}`,
      });
    }
  } catch {
    diagnostics.push({ severity: 'error', code: 'unserializable_document', message: 'Document contains unserializable values' });
  }

  // Duplicate warnings kept separate from structural errors.
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return { ok: errors.length === 0, diagnostics };
}

export function validateProps(
  def: ComponentDefinition,
  props: JsonObject,
): { ok: boolean; diagnostics: CompositionDiagnostic[] } {
  const ctx: WalkContext = {
    diagnostics: [],
    registry: { get: () => def, list: () => [def], has: () => true },
    ids: new Map(),
    nodeCount: 1,
    seen: new WeakSet(),
    nodeIds: new Set(),
  };
  const node: CompositionNode = { id: 'n0', type: def.type, props, slots: { [DEFAULT_SLOT]: [] } };
  validateDefinitionProps(ctx, def, node, 'node');
  return { ok: !ctx.diagnostics.some((d) => d.severity === 'error'), diagnostics: ctx.diagnostics };
}

export function firstError(
  result: CompositionValidationResult,
): CompositionDiagnostic | undefined {
  return result.diagnostics.find((d) => d.severity === 'error');
}

export function describeDiagnostics(diagnostics: readonly CompositionDiagnostic[]): string {
  return diagnostics
    .map((d) => `${d.code}${d.nodeId ? ` [${d.nodeId}]` : ''}: ${d.message}`)
    .join('\n');
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return isPlainObject(value);
}
