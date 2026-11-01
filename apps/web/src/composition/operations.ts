import {
  BREAKPOINTS,
  DEFAULT_SLOT,
  MAX_DEPTH,
  type ComponentDefinition,
  type CompositionDiagnostic,
  type CompositionDocument,
  type CompositionNode,
  type JsonObject,
  type JsonValue,
  type LayoutConfig,
  type StyleConfig,
} from './types.js';
import { cloneJson, createNodeId, deepMerge, isPlainObject } from './schema.js';
import { validateDocument } from './validate.js';
import { compositionRegistry, createDefaultNode } from './registry.js';

export type OperationResult =
  | { ok: true; document: CompositionDocument }
  | { ok: false; diagnostics: readonly CompositionDiagnostic[] };

function fail(code: string, message: string, nodeId?: string): OperationResult {
  return { ok: false, diagnostics: [{ severity: 'error', code, message, nodeId }] };
}

function finish(
  next: CompositionDocument,
  registry = compositionRegistry,
  validate = true,
): OperationResult {
  if (validate) {
    const result = validateDocument(next, registry);
    if (!result.ok) return { ok: false, diagnostics: result.diagnostics };
  }
  return { ok: true, document: next };
}

export function walkNodes(root: CompositionNode, visit: (node: CompositionNode, depth: number) => void, depth = 0): void {
  visit(root, depth);
  for (const children of Object.values(root.slots ?? {})) {
    for (const child of children) walkNodes(child, visit, depth + 1);
  }
}

export function findNode(doc: CompositionDocument, nodeId: string): CompositionNode | undefined {
  if (doc.root.id === nodeId) return doc.root;
  let found: CompositionNode | undefined;
  walkNodes(doc.root, (node) => {
    if (found) return;
    if (node.id === nodeId) found = node;
  });
  return found;
}

export function findParent(
  doc: CompositionDocument,
  nodeId: string,
): { parent: CompositionNode; slot: string; index: number } | undefined {
  let found: { parent: CompositionNode; slot: string; index: number } | undefined;
  walkNodes(doc.root, (node) => {
    if (found) return;
    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      const index = children.findIndex((c) => c.id === nodeId);
      if (index >= 0) found = { parent: node, slot, index };
    }
  });
  return found;
}

export function ancestorsOf(doc: CompositionDocument, nodeId: string): CompositionNode[] {
  const path: CompositionNode[] = [];
  const visit = (node: CompositionNode, trail: CompositionNode[]): boolean => {
    if (node.id === nodeId) {
      path.push(...trail);
      return true;
    }
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) {
        if (visit(child, [...trail, node])) return true;
      }
    }
    return false;
  };
  visit(doc.root, []);
  return path;
}

export function isDescendant(doc: CompositionDocument, ancestorId: string, candidateId: string): boolean {
  return ancestorsOf(doc, candidateId).some((a) => a.id === ancestorId);
}

export function collectSubtree(node: CompositionNode): CompositionNode[] {
  const out: CompositionNode[] = [];
  walkNodes(node, (n) => out.push(n));
  return out;
}

/** Replace a node in the tree, cloning only the path to the target. */
function mapNode(
  node: CompositionNode,
  nodeId: string,
  updater: (n: CompositionNode) => CompositionNode,
): CompositionNode {
  if (node.id === nodeId) return updater(node);
  let changed = false;
  const slots: Record<string, CompositionNode[]> = {};
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    let childChanged = false;
    const nextChildren = children.map((child) => {
      const next = mapNode(child, nodeId, updater);
      if (next !== child) childChanged = true;
      return next;
    });
    if (childChanged) changed = true;
    slots[slot] = childChanged ? nextChildren : children;
  }
  return changed ? { ...node, slots } : node;
}

function updateDocument(
  doc: CompositionDocument,
  updater: (root: CompositionNode) => CompositionNode,
): CompositionDocument {
  const root = updater(doc.root);
  if (root === doc.root) return doc;
  return { ...doc, root, updatedAt: Date.now() };
}

export function updateNode(
  doc: CompositionDocument,
  nodeId: string,
  updater: (node: CompositionNode) => CompositionNode,
  options: { registry?: typeof compositionRegistry; validate?: boolean } = {},
): OperationResult {
  const node = findNode(doc, nodeId);
  if (!node) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  const next = updateDocument(doc, (root) => mapNode(root, nodeId, updater));
  return finish(next, options.registry ?? compositionRegistry, options.validate ?? true);
}

export function setNodeProps(doc: CompositionDocument, nodeId: string, props: JsonObject): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, props: cloneJson(props) }));
}

export function setNodeProp(
  doc: CompositionDocument,
  nodeId: string,
  key: string,
  value: JsonValue | undefined,
): OperationResult {
  return updateNode(doc, nodeId, (node) => {
    const props: JsonObject = { ...node.props };
    if (value === undefined) delete props[key];
    else props[key] = cloneJson(value);
    return { ...node, props };
  });
}

export function setNodeLayout(
  doc: CompositionDocument,
  nodeId: string,
  patch: Partial<LayoutConfig>,
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({
    ...node,
    layout: deepMerge(node.layout ?? {}, patch),
  }));
}

export function setNodeStyle(
  doc: CompositionDocument,
  nodeId: string,
  patch: Partial<StyleConfig>,
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({
    ...node,
    style: deepMerge(node.style ?? {}, patch),
  }));
}

export function setNodeFlag(
  doc: CompositionDocument,
  nodeId: string,
  flag: 'hidden' | 'locked',
  value: boolean,
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, [flag]: value }));
}

export function renameNode(doc: CompositionDocument, nodeId: string, label: string): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, label: label.slice(0, 80) }));
}

export function setNodeBindings(
  doc: CompositionDocument,
  nodeId: string,
  bindings: CompositionNode['bindings'],
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, bindings }));
}

export function setNodeInteractions(
  doc: CompositionDocument,
  nodeId: string,
  interactions: CompositionNode['interactions'],
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, interactions }));
}

export function setNodeConditions(
  doc: CompositionDocument,
  nodeId: string,
  conditions: CompositionNode['conditions'],
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, conditions }));
}

export function setNodeA11y(
  doc: CompositionDocument,
  nodeId: string,
  a11y: CompositionNode['a11y'],
): OperationResult {
  return updateNode(doc, nodeId, (node) => ({ ...node, a11y }));
}

/**
 * Whether `componentType` may be placed in `parentId`/`slotName`.
 *
 * @param options.vacateNodeId When set, capacity is computed as if that node
 *   were already removed from the destination slot (same-slot moves).
 */
export function canInsert(
  doc: CompositionDocument,
  parentId: string,
  slotName: string,
  componentType: string,
  registry = compositionRegistry,
  options?: { vacateNodeId?: string },
): { ok: true; definition: ComponentDefinition } | { ok: false; reason: string } {
  const def = registry.get(componentType);
  if (!def) return { ok: false, reason: `Unknown component "${componentType}"` };
  if (def.rootOnly) return { ok: false, reason: `${def.name} can only be the page root` };
  const parent = findNode(doc, parentId);
  if (!parent) return { ok: false, reason: 'Target parent is not in this document' };
  const parentDef = registry.get(parent.type);
  const slot = parentDef?.slots?.find((s) => s.name === slotName);
  if (!slot) {
    return { ok: false, reason: `${parentDef?.name ?? parent.type} has no "${slotName}" slot` };
  }
  if (slot.accepts && slot.accepts !== '*' && !slot.accepts.includes(componentType)) {
    return { ok: false, reason: `${parentDef?.name ?? parent.type} does not accept ${def.name} in ${slot.label}` };
  }
  let occupied = parent.slots[slotName]?.length ?? 0;
  // Same-slot moves: the source node will leave this slot, so it must not count
  // against capacity (otherwise a full slot rejects every intra-slot reorder/move).
  if (options?.vacateNodeId) {
    const kids = parent.slots[slotName] ?? [];
    if (kids.some((n) => n.id === options.vacateNodeId)) {
      occupied = Math.max(0, occupied - 1);
    }
  }
  if (slot.max !== undefined && occupied >= slot.max) {
    return { ok: false, reason: `${slot.label} is full (max ${slot.max})` };
  }
  if (def.allowedParents && !def.allowedParents.includes(parent.type)) {
    return { ok: false, reason: `${def.name} cannot be placed inside ${parentDef?.name ?? parent.type}` };
  }
  const depth = ancestorsOf(doc, parentId).length + 1;
  if (depth + 1 > MAX_DEPTH) {
    return { ok: false, reason: `Nesting would exceed ${MAX_DEPTH} levels` };
  }
  return { ok: true, definition: def };
}

export function createComponentNode(componentType: string, registry = compositionRegistry): CompositionNode | null {
  const def = registry.get(componentType);
  if (!def) return null;
  return createDefaultNode(def);
}

export function insertNode(
  doc: CompositionDocument,
  parentId: string,
  slotName: string,
  index: number,
  node: CompositionNode,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  const registry = options.registry ?? compositionRegistry;
  const parent = findNode(doc, parentId);
  if (!parent) return fail('parent_not_found', `Parent "${parentId}" was not found`, parentId);
  if (!parent.slots[slotName]) return fail('slot_not_found', `Slot "${slotName}" was not found on ${parent.type}`, parentId);
  if (collectSubtree(node).some((n) => findNode(doc, n.id))) {
    return fail('duplicate_node_id', 'Inserted subtree contains an id already used in the document', node.id);
  }
  const check = canInsert(doc, parentId, slotName, node.type, registry);
  if (!check.ok) return fail('invalid_insert', check.reason, parentId);
  const next = updateDocument(doc, (root) =>
    mapNode(root, parentId, (p) => {
      const children = [...(p.slots[slotName] ?? [])];
      const at = Math.max(0, Math.min(index, children.length));
      children.splice(at, 0, cloneJson(node as unknown as JsonValue) as unknown as CompositionNode);
      return { ...p, slots: { ...p.slots, [slotName]: children } };
    }),
  );
  return finish(next, registry);
}

export function insertComponent(
  doc: CompositionDocument,
  parentId: string,
  slotName: string,
  index: number,
  componentType: string,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  const registry = options.registry ?? compositionRegistry;
  const node = createComponentNode(componentType, registry);
  if (!node) return fail('unknown_component', `Unknown component "${componentType}"`);
  return insertNode(doc, parentId, slotName, index, node, { registry });
}

export function removeNode(
  doc: CompositionDocument,
  nodeId: string,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  if (doc.root.id === nodeId) return fail('cannot_remove_root', 'The page root cannot be removed', nodeId);
  const parent = findParent(doc, nodeId);
  if (!parent) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  const next = updateDocument(doc, (root) =>
    mapNode(root, parent.parent.id, (p) => {
      const children = [...(p.slots[parent.slot] ?? [])];
      children.splice(parent.index, 1);
      return { ...p, slots: { ...p.slots, [parent.slot]: children } };
    }),
  );
  return finish(next, options.registry ?? compositionRegistry);
}

export function replaceNode(
  doc: CompositionDocument,
  nodeId: string,
  replacement: CompositionNode,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  if (nodeId === doc.root.id) {
    if (replacement.id !== doc.root.id) return fail('invalid_root_replacement', 'Root replacement must keep the root id', nodeId);
    return finish({ ...doc, root: replacement, updatedAt: Date.now() }, options.registry ?? compositionRegistry);
  }
  const location = findParent(doc, nodeId);
  if (!location) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  const next = updateDocument(doc, (root) =>
    mapNode(root, location.parent.id, (p) => {
      const children = [...(p.slots[location.slot] ?? [])];
      children[location.index] = replacement;
      return { ...p, slots: { ...p.slots, [location.slot]: children } };
    }),
  );
  return finish(next, options.registry ?? compositionRegistry);
}

export function moveNode(
  doc: CompositionDocument,
  nodeId: string,
  targetParentId: string,
  targetSlot: string,
  targetIndex: number,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  const registry = options.registry ?? compositionRegistry;
  if (nodeId === doc.root.id) return fail('cannot_move_root', 'The page root cannot be moved', nodeId);
  const node = findNode(doc, nodeId);
  if (!node) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  if (targetParentId === nodeId || isDescendant(doc, nodeId, targetParentId)) {
    return fail('invalid_move', 'A node cannot be moved inside itself', nodeId);
  }
  const source = findParent(doc, nodeId);
  if (!source) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);

  const sameSlot = source.parent.id === targetParentId && source.slot === targetSlot;
  const check = canInsert(doc, targetParentId, targetSlot, node.type, registry, {
    // Capacity after the source vacates this slot (critical for full same-slot moves).
    vacateNodeId: sameSlot ? nodeId : undefined,
  });
  if (!check.ok) return fail('invalid_move', check.reason, nodeId);

  let adjustedIndex = targetIndex;
  if (sameSlot && source.index < targetIndex) {
    adjustedIndex -= 1;
  }
  const detached = updateDocument(doc, (root) =>
    mapNode(root, source.parent.id, (p) => {
      const children = [...(p.slots[source.slot] ?? [])];
      children.splice(source.index, 1);
      return { ...p, slots: { ...p.slots, [source.slot]: children } };
    }),
  );
  const next = updateDocument(detached, (root) =>
    mapNode(root, targetParentId, (p) => {
      const children = [...(p.slots[targetSlot] ?? [])];
      const at = Math.max(0, Math.min(adjustedIndex, children.length));
      // Clone the moved node so the source document graph stays independent.
      children.splice(at, 0, cloneJson(node as unknown as JsonValue) as unknown as CompositionNode);
      return { ...p, slots: { ...p.slots, [targetSlot]: children } };
    }),
  );
  return finish(next, registry);
}

export function reorderWithinSlot(
  doc: CompositionDocument,
  parentId: string,
  slot: string,
  fromIndex: number,
  toIndex: number,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  const parent = findNode(doc, parentId);
  if (!parent) return fail('parent_not_found', `Parent "${parentId}" was not found`, parentId);
  const children = parent.slots[slot];
  if (!children) return fail('slot_not_found', `Slot "${slot}" was not found`, parentId);
  if (fromIndex < 0 || fromIndex >= children.length) return fail('index_out_of_range', 'Source index is out of range', parentId);
  const next = updateDocument(doc, (root) =>
    mapNode(root, parentId, (p) => {
      const copy = [...(p.slots[slot] ?? [])];
      const [item] = copy.splice(fromIndex, 1);
      if (!item) return p;
      copy.splice(Math.max(0, Math.min(toIndex, copy.length)), 0, item);
      return { ...p, slots: { ...p.slots, [slot]: copy } };
    }),
  );
  return finish(next, options.registry ?? compositionRegistry);
}

function regenerateIds(node: CompositionNode, ids: Map<string, string>): CompositionNode {
  const id = createNodeId();
  ids.set(node.id, id);
  const slots: Record<string, CompositionNode[]> = {};
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    slots[slot] = children.map((child) => regenerateIds(child, ids));
  }
  return { ...node, id, slots };
}

/**
 * Remap internal references after ID regeneration.
 * - scroll-to targets that point inside the duplicated subtree → new ids
 * - external targets stay unchanged
 * - responsive slotOrder ids already handled by the caller
 */
function remapInternalReferences(root: CompositionNode, ids: Map<string, string>): void {
  walkNodes(root, (n) => {
    if (!n.interactions?.length) return;
    n.interactions = n.interactions.map((interaction) => {
      if (interaction.action.kind !== 'scroll-to') return interaction;
      const mapped = ids.get(interaction.action.nodeId);
      if (!mapped) return interaction;
      return {
        ...interaction,
        action: { ...interaction.action, nodeId: mapped },
      };
    });
  });
}

export function duplicateNode(
  doc: CompositionDocument,
  nodeId: string,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  const node = findNode(doc, nodeId);
  if (!node) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  if (nodeId === doc.root.id) return fail('cannot_duplicate_root', 'The page root cannot be duplicated', nodeId);
  const location = findParent(doc, nodeId);
  if (!location) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  const ids = new Map<string, string>();
  const copy = regenerateIds(node, ids);
  // Preserve responsive ordering for the duplicated subtree.
  walkNodes(copy, (n) => {
    if (!n.responsive) return;
    const responsive = cloneJson(n.responsive as unknown as JsonValue) as typeof n.responsive;
    for (const bp of BREAKPOINTS) {
      const slotOrder = responsive?.[bp]?.slotOrder;
      if (!slotOrder) continue;
      for (const [slot, order] of Object.entries(slotOrder)) {
        slotOrder[slot] = order.map((id) => ids.get(id) ?? id);
      }
    }
    n.responsive = responsive;
  });
  remapInternalReferences(copy, ids);
  return insertNode(doc, location.parent.id, location.slot, location.index + 1, copy, options);
}

export function duplicateSubtree(
  doc: CompositionDocument,
  nodeId: string,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  return duplicateNode(doc, nodeId, options);
}

export function groupNodes(
  doc: CompositionDocument,
  nodeIds: readonly string[],
  groupType = 'structure.container',
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  if (nodeIds.length < 2) {
    return fail('invalid_group', 'Select at least two nodes to group');
  }
  const uniqueIds = new Set(nodeIds);
  if (uniqueIds.size !== nodeIds.length) {
    return fail('invalid_group', 'Grouped selection contains duplicate node ids');
  }
  const registry = options.registry ?? compositionRegistry;
  const groupDef = registry.get(groupType);
  if (!groupDef) return fail('unknown_component', `Unknown group component "${groupType}"`, undefined);

  const locations = nodeIds.map((id) => ({ id, location: findParent(doc, id) }));
  if (locations.some((l) => !l.location)) {
    return fail('node_not_found', 'A selected node was not found');
  }
  if (nodeIds.some((id) => id === doc.root.id)) {
    return fail('cannot_group_root', 'The page root cannot be grouped');
  }
  const first = locations[0]!.location!;
  if (
    locations.some(
      (l) =>
        !l.location ||
        l.location.parent.id !== first.parent.id ||
        l.location.slot !== first.slot,
    )
  ) {
    return fail('invalid_group', 'Grouped nodes must share the same parent and slot');
  }

  // Document order (slot index), not selection order.
  const ordered = [...locations].sort((a, b) => a.location!.index - b.location!.index);
  const indices = ordered.map((e) => e.location!.index);
  const minIndex = indices[0]!;
  const maxIndex = indices[indices.length - 1]!;
  // Contiguous range required: otherwise ungroup cannot restore original sibling order.
  if (maxIndex - minIndex + 1 !== ordered.length) {
    return fail(
      'invalid_group',
      'Grouped nodes must form a contiguous range in their parent slot',
    );
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== minIndex + i) {
      return fail(
        'invalid_group',
        'Grouped nodes must form a contiguous range in their parent slot',
      );
    }
  }

  const nodesInDocumentOrder: CompositionNode[] = [];
  for (const entry of ordered) {
    const node = findNode(doc, entry.id);
    if (!node) return fail('node_not_found', `Node "${entry.id}" was not found`, entry.id);
    nodesInDocumentOrder.push(cloneJson(node as unknown as JsonValue) as unknown as CompositionNode);
  }

  const group = createDefaultNode(groupDef);
  group.slots[DEFAULT_SLOT] = nodesInDocumentOrder;

  // Single immutable slot update: replace [minIndex..maxIndex] with the group node.
  const next = updateDocument(doc, (root) =>
    mapNode(root, first.parent.id, (p) => {
      const children = [...(p.slots[first.slot] ?? [])];
      children.splice(minIndex, ordered.length, group);
      return { ...p, slots: { ...p.slots, [first.slot]: children } };
    }),
  );
  return finish(next, registry);
}

export function ungroupNode(
  doc: CompositionDocument,
  nodeId: string,
  options: { registry?: typeof compositionRegistry } = {},
): OperationResult {
  const node = findNode(doc, nodeId);
  if (!node) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  if (nodeId === doc.root.id) return fail('cannot_ungroup_root', 'The page root cannot be ungrouped', nodeId);
  const parentDef = nodeId === doc.root.id ? undefined : undefined;
  void parentDef;
  const location = findParent(doc, nodeId);
  if (!location) return fail('node_not_found', `Node "${nodeId}" was not found`, nodeId);
  const children = node.slots[DEFAULT_SLOT] ?? [];
  if (children.length === 0) {
    return removeNode(doc, nodeId, options);
  }
  const next = updateDocument(doc, (root) =>
    mapNode(root, location.parent.id, (p) => {
      const existing = [...(p.slots[location.slot] ?? [])];
      existing.splice(location.index, 1, ...children.map((c) => cloneJson(c as unknown as JsonValue) as unknown as CompositionNode));
      return { ...p, slots: { ...p.slots, [location.slot]: existing } };
    }),
  );
  return finish(next, options.registry ?? compositionRegistry);
}

export function setDocumentName(doc: CompositionDocument, name: string, validate = true): OperationResult {
  const next = { ...doc, name: name.trim().slice(0, 120), updatedAt: Date.now() };
  return finish(next, compositionRegistry, validate);
}

export function setDocumentMetadata(
  doc: CompositionDocument,
  patch: NonNullable<CompositionDocument['metadata']>,
): OperationResult {
  const next = {
    ...doc,
    metadata: { ...(doc.metadata ?? {}), ...patch },
    updatedAt: Date.now(),
  };
  return finish(next);
}

export function updateDocumentSurfaceRoute(doc: CompositionDocument, route: string): OperationResult {
  const next = {
    ...doc,
    surface: { ...doc.surface, route },
    updatedAt: Date.now(),
  };
  return finish(next);
}

/** Assert that two snapshots do not share mutable structure (test helper). */
export function snapshotsAreIndependent(a: CompositionDocument, b: CompositionDocument): boolean {
  if (a === b) return false;
  const aNodes = new Set<CompositionNode>();
  const bNodes = new Set<CompositionNode>();
  walkNodes(a.root, (n) => aNodes.add(n));
  walkNodes(b.root, (n) => bNodes.add(n));
  for (const node of aNodes) if (bNodes.has(node)) return false;
  return true;
}

export function nodeCount(doc: CompositionDocument): number {
  let count = 0;
  walkNodes(doc.root, () => {
    count += 1;
  });
  return count;
}

export function isOperationResult(value: unknown): value is OperationResult {
  return isPlainObject(value) && 'ok' in value;
}
