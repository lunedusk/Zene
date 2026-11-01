/**
 * Pure helpers for the composition workbench (insertion targets, multi-delete order).
 */

import type { CompositionDocument, CompositionNode, ComponentDefinition } from '../types.js';
import { DEFAULT_SLOT } from '../types.js';
import { canInsert, findNode, findParent, removeNode, type OperationResult } from '../operations.js';
import type { RegistryLike } from '../types.js';
import { compositionRegistry } from '../registry.js';

export interface InsertionTarget {
  parentId: string;
  slot: string;
  index: number;
  reason?: string;
}

export function nodeLabel(node: CompositionNode, def?: ComponentDefinition): string {
  if (node.label && node.label.trim()) return node.label;
  if (def?.name) return def.name;
  return node.type;
}

/**
 * Resolve where a new component should be inserted given current selection.
 */
export function resolveInsertionTarget(
  doc: CompositionDocument,
  componentType: string,
  selectedIds: readonly string[],
  preferredSlot?: string,
  registry: RegistryLike = compositionRegistry,
): InsertionTarget | { error: string } {
  const def = registry.get(componentType);
  if (!def) return { error: `Unknown component type: ${componentType}` };

  const tryParent = (
    parentId: string,
    slot: string,
    index: number,
  ): InsertionTarget | null => {
    const check = canInsert(doc, parentId, slot, componentType, registry);
    if (check.ok) return { parentId, slot, index };
    return null;
  };

  // 1. Selected node with compatible slot
  const primary = selectedIds[0];
  if (primary) {
    const selected = findNode(doc, primary);
    if (selected) {
      const slots = Object.keys(selected.slots ?? {});
      const preferred =
        preferredSlot && slots.includes(preferredSlot)
          ? preferredSlot
          : slots.includes(DEFAULT_SLOT)
            ? DEFAULT_SLOT
            : slots[0];
      if (preferred) {
        const children = selected.slots?.[preferred] ?? [];
        const hit = tryParent(primary, preferred, children.length);
        if (hit) return hit;
      }
      // 2. Sibling after selected (non-root)
      if (primary !== doc.root.id) {
        const parentInfo = findParent(doc, primary);
        if (parentInfo) {
          const idx = parentInfo.index + 1;
          const hit = tryParent(parentInfo.parent.id, parentInfo.slot, idx);
          if (hit) return hit;
        }
      }
    }
  }

  // 3. Root default slot
  const rootSlot = DEFAULT_SLOT;
  const rootChildren = doc.root.slots?.[rootSlot] ?? [];
  const rootHit = tryParent(doc.root.id, rootSlot, rootChildren.length);
  if (rootHit) return rootHit;

  return { error: `Cannot insert ${componentType} into the current selection or root` };
}

/**
 * Remove multiple nodes atomically: apply removals deepest-first so parents
 * are not removed before children. Returns first failure or final success.
 */
export function removeNodesAtomic(
  doc: CompositionDocument,
  nodeIds: readonly string[],
): OperationResult {
  const unique = [...new Set(nodeIds)].filter((id) => id !== doc.root.id);
  if (unique.length === 0) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'cannot_remove_root',
          message: 'Cannot remove the document root',
        },
      ],
    };
  }

  // Order: deeper nodes first (approximate by repeated remove in stable reverse doc order)
  let current = doc;
  for (const id of unique.slice().reverse()) {
    if (!findNode(current, id)) continue;
    const result = removeNode(current, id);
    if (!result.ok) return result;
    current = result.document;
  }
  if (Object.is(current, doc)) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'nothing_removed',
          message: 'No removable nodes in the selection',
        },
      ],
    };
  }
  return { ok: true, document: current };
}
