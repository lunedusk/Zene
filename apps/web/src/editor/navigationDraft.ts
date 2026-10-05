



import { logger } from '../lib/logger.js';
import type { NavigationItem, VisibilityExpr } from '../nav/types.js';

export interface NavEditorItem {
  id: string;
  label: string;
  href: string;
  icon?: string;
  groupId?: string;
  order: number;
  visibility?: VisibilityExpr;
  requiredBit?: string;
}

export interface NavEditorGroup {
  id: string;
  label: string;
  order: number;
}

export interface NavigationDraft {
  groups: NavEditorGroup[];
  items: NavEditorItem[];
  dirty: boolean;
}

export function draftFromItems(items: NavigationItem[]): NavigationDraft {
  const groups = new Map<string, NavEditorGroup>();
  const out: NavEditorItem[] = [];
  items.forEach((item, i) => {
    const groupId = item.section ?? 'global';
    if (!groups.has(groupId)) {
      groups.set(groupId, { id: groupId, label: groupId, order: groups.size });
    }
    out.push({
      id: item.id,
      label: item.label,
      href: item.href,
      icon: item.icon,
      groupId,
      order: item.order ?? i,
      visibility: item.visibility,
      requiredBit: item.requiredBit,
    });
  });
  return {
    groups: [...groups.values()].sort((a, b) => a.order - b.order),
    items: out.sort((a, b) => a.order - b.order),
    dirty: false,
  };
}

export function addNavItem(draft: NavigationDraft, item: Omit<NavEditorItem, 'order'>): NavigationDraft {
  const order = draft.items.length ? Math.max(...draft.items.map((i) => i.order)) + 10 : 10;
  logger.debug('dashboard.navigation.change', { operation: 'add', id: item.id });
  return { ...draft, dirty: true, items: [...draft.items, { ...item, order }] };
}

export function removeNavItem(draft: NavigationDraft, id: string): NavigationDraft {
  logger.debug('dashboard.navigation.change', { operation: 'remove', id });
  return { ...draft, dirty: true, items: draft.items.filter((i) => i.id !== id) };
}

export function renameNavItem(draft: NavigationDraft, id: string, label: string): NavigationDraft {
  logger.debug('dashboard.navigation.change', { operation: 'rename', id });
  return {
    ...draft,
    dirty: true,
    items: draft.items.map((i) => (i.id === id ? { ...i, label } : i)),
  };
}

export function reorderNavItem(draft: NavigationDraft, id: string, toIndex: number): NavigationDraft {
  const items = [...draft.items].sort((a, b) => a.order - b.order);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return draft;
  const [row] = items.splice(idx, 1);
  if (!row) return draft;
  items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, row);
  logger.debug('dashboard.navigation.change', { operation: 'reorder', id, toIndex });
  return {
    ...draft,
    dirty: true,
    items: items.map((i, order) => ({ ...i, order: (order + 1) * 10 })),
  };
}

export function setNavItemHref(draft: NavigationDraft, id: string, href: string): NavigationDraft {
  return {
    ...draft,
    dirty: true,
    items: draft.items.map((i) => (i.id === id ? { ...i, href } : i)),
  };
}

export function setNavItemBit(draft: NavigationDraft, id: string, requiredBit?: string): NavigationDraft {
  return {
    ...draft,
    dirty: true,
    items: draft.items.map((i) => (i.id === id ? { ...i, requiredBit } : i)),
  };
}

export function toNavOrder(draft: NavigationDraft): string[] {
  return [...draft.items].sort((a, b) => a.order - b.order).map((i) => i.id);
}

export function toNavigationItems(draft: NavigationDraft): NavigationItem[] {
  return [...draft.items]
    .sort((a, b) => a.order - b.order)
    .map((i) => ({
      id: i.id,
      label: i.label,
      href: i.href,
      icon: i.icon,
      section: (i.groupId as NavigationItem['section']) ?? 'global',
      order: i.order,
      visibility: i.visibility,
      requiredBit: i.requiredBit,
    }));
}
