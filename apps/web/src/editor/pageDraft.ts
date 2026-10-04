/**
 * Owner page draft model — same renderer pipeline as built-in pages.
 */

import { logger } from '../lib/logger.js';
import type { DashboardLayout } from '../widgets/types.js';
import { createEmptyBreakpoint } from '../layout/engine.js';

export interface PageDraft {
  pageId: string;
  route: string;
  title: string;
  description?: string;
  icon?: string;
  layout: DashboardLayout;
  dirty: boolean;
}

/** Collision-safe page ID (not Date.now-only). */
export function newPageId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `page_${cryptoObj.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  // Fallback: time + entropy (still unique under same-ms bursts)
  const entropy = Math.random().toString(36).slice(2, 10);
  return `page_${Date.now().toString(36)}_${entropy}`;
}

export function createPageDraft(input?: Partial<PageDraft>): PageDraft {
  const pageId = input?.pageId ?? newPageId();
  const layout: DashboardLayout =
    input?.layout ??
    ({
      layoutId: `layout_${pageId}`,
      surfaceId: pageId,
      version: 0,
      breakpoints: {
        desktop: createEmptyBreakpoint('desktop'),
        tablet: createEmptyBreakpoint('tablet'),
        mobile: createEmptyBreakpoint('mobile'),
      },
    } satisfies DashboardLayout);
  logger.debug('dashboard.page.create', { pageId });
  return {
    pageId,
    route: input?.route ?? `/custom/${pageId}`,
    title: input?.title ?? 'New page',
    description: input?.description,
    icon: input?.icon,
    layout,
    dirty: true,
  };
}

export function renamePage(draft: PageDraft, title: string): PageDraft {
  logger.debug('dashboard.page.update', { pageId: draft.pageId, field: 'title' });
  return { ...draft, title, dirty: true };
}

export function setPageRoute(draft: PageDraft, route: string): PageDraft {
  logger.debug('dashboard.page.update', { pageId: draft.pageId, field: 'route' });
  return { ...draft, route, dirty: true };
}

export function duplicatePage(draft: PageDraft): PageDraft {
  const pageId = newPageId();
  logger.debug('dashboard.page.create', { pageId, duplicatedFrom: draft.pageId });
  return {
    ...draft,
    pageId,
    route: `${draft.route}-copy`,
    title: `${draft.title} (copy)`,
    layout: {
      ...draft.layout,
      layoutId: `layout_${pageId}`,
      surfaceId: pageId,
    },
    dirty: true,
  };
}
