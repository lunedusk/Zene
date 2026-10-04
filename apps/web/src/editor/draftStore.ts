/**
 * Editor draft state — never silently becomes published production config.
 */

import { logger } from '../lib/logger.js';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
  type HistoryState,
} from './history.js';
import type { DashboardLayout, LayoutBreakpointState, Breakpoint } from '../widgets/types.js';
import { createEmptyBreakpoint } from '../layout/engine.js';

export type EditorMode = 'edit' | 'preview';
export type PublishStatus = 'draft' | 'published' | 'scheduled';

export interface EditorDraft {
  surfaceId: string;
  layout: DashboardLayout;
  themeOverrides: Record<string, string>;
  navigationOverrides: unknown[];
  dirty: boolean;
  mode: EditorMode;
  status: PublishStatus;
  versionLabel?: string;
  scheduledAt?: string;
}

function defaultLayout(surfaceId: string): DashboardLayout {
  return {
    layoutId: `layout_${surfaceId}`,
    surfaceId,
    version: 0,
    breakpoints: {
      desktop: createEmptyBreakpoint('desktop'),
      tablet: createEmptyBreakpoint('tablet'),
      mobile: createEmptyBreakpoint('mobile'),
    },
  };
}

export function createDraft(surfaceId: string): EditorDraft {
  return {
    surfaceId,
    layout: defaultLayout(surfaceId),
    themeOverrides: {},
    navigationOverrides: [],
    dirty: false,
    mode: 'edit',
    status: 'draft',
  };
}

export class EditorSession {
  private history: HistoryState<EditorDraft>;
  private breakpoint: Breakpoint = 'desktop';

  constructor(surfaceId: string) {
    this.history = createHistory(createDraft(surfaceId));
    logger.debug('dashboard.editor.open', { surfaceId });
  }

  get draft(): EditorDraft {
    return this.history.present;
  }

  get activeBreakpoint(): Breakpoint {
    return this.breakpoint;
  }

  setBreakpoint(bp: Breakpoint): void {
    this.breakpoint = bp;
    logger.debug('dashboard.editor.change', { operation: 'breakpoint', breakpoint: bp });
  }

  private commit(next: EditorDraft): void {
    this.history = pushHistory(this.history, { ...next, dirty: true });
    logger.debug('dashboard.editor.change', {
      surfaceId: next.surfaceId,
      dirty: true,
    });
  }

  updateBreakpointLayout(next: LayoutBreakpointState): void {
    const d = this.draft;
    const layout: DashboardLayout = {
      ...d.layout,
      breakpoints: { ...d.layout.breakpoints, [this.breakpoint]: next },
    };
    this.commit({ ...d, layout });
    logger.debug('dashboard.layout.change', {
      surfaceId: d.surfaceId,
      breakpoint: this.breakpoint,
      widgetCount: next.widgets.length,
    });
  }

  setThemeOverride(key: string, value: string): void {
    const d = this.draft;
    this.commit({
      ...d,
      themeOverrides: { ...d.themeOverrides, [key]: value },
    });
  }

  setMode(mode: EditorMode): void {
    const d = this.draft;
    this.commit({ ...d, mode, dirty: d.dirty });
    logger.debug(mode === 'preview' ? 'dashboard.editor.preview' : 'dashboard.editor.change', {
      surfaceId: d.surfaceId,
      mode,
    });
  }

  undo(): boolean {
    if (!canUndo(this.history)) return false;
    this.history = undo(this.history);
    logger.debug('dashboard.editor.undo', { surfaceId: this.draft.surfaceId });
    return true;
  }

  redo(): boolean {
    if (!canRedo(this.history)) return false;
    this.history = redo(this.history);
    logger.debug('dashboard.editor.redo', { surfaceId: this.draft.surfaceId });
    return true;
  }

  get canUndo(): boolean {
    return canUndo(this.history);
  }

  get canRedo(): boolean {
    return canRedo(this.history);
  }

  /** Local mark only — publish must call Dashboard API. */
  markPublished(versionLabel?: string): void {
    const d = this.draft;
    this.history = createHistory({
      ...d,
      dirty: false,
      status: 'published',
      versionLabel,
      mode: 'edit',
    });
    logger.debug('dashboard.editor.publish', {
      surfaceId: d.surfaceId,
      versionLabel,
    });
  }
}
