/**
 * Canonical composition editor session.
 *
 * Owns one CompositionDocument plus editor-only UI state. Document mutations
 * always go through existing validated operations + CompositionHistory.
 * Selection / hover / breakpoint / mode never enter history or dirty tracking.
 */

import type { BreakpointId, CompositionDiagnostic, CompositionDocument, CompositionNode } from './types.js';
import { CompositionHistory, type CompositionHistoryOptions } from './history.js';
import {
  findNode,
  type OperationResult,
  walkNodes,
} from './operations.js';

export type EditorMode = 'edit' | 'preview';

export interface EditorSessionOptions extends CompositionHistoryOptions {
  /** Initial breakpoint. Defaults to desktop. */
  breakpoint?: BreakpointId;
  /** Initial editor mode. Defaults to edit. */
  mode?: EditorMode;
}

export interface EditorSessionSnapshot {
  readonly document: CompositionDocument;
  readonly selection: readonly string[];
  readonly primarySelection: string | null;
  readonly hoveredNodeId: string | null;
  readonly breakpoint: BreakpointId;
  readonly mode: EditorMode;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dirty: boolean;
  readonly diagnostics: readonly CompositionDiagnostic[];
  readonly inTransaction: boolean;
  readonly revision: number;
}

export type EditorOperation = (document: CompositionDocument) => OperationResult;

function collectNodeIds(doc: CompositionDocument): Set<string> {
  const ids = new Set<string>();
  walkNodes(doc.root, (node) => {
    ids.add(node.id);
  });
  return ids;
}

/** Document-order list of node ids (pre-order walk). */
function nodeIdsInDocumentOrder(doc: CompositionDocument): string[] {
  const order: string[] = [];
  walkNodes(doc.root, (node) => {
    order.push(node.id);
  });
  return order;
}

function pruneSelection(selection: readonly string[], valid: Set<string>): string[] {
  return selection.filter((id) => valid.has(id));
}

function sortSelectionByDocumentOrder(selection: readonly string[], doc: CompositionDocument): string[] {
  if (selection.length <= 1) return [...selection];
  const order = nodeIdsInDocumentOrder(doc);
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...selection].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/**
 * Coordinates a canonical composition document with editor-only state.
 * Safe for useSyncExternalStore via subscribe + getSnapshot.
 */
export class CompositionEditorSession {
  private history: CompositionHistory;
  private selectionIds: string[] = [];
  private hoveredId: string | null = null;
  private activeBreakpoint: BreakpointId;
  private editorMode: EditorMode;
  private savedDocument: CompositionDocument;
  private lastDiagnostics: CompositionDiagnostic[] = [];
  private revision = 0;
  private snapshotCache: EditorSessionSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  /** Dirty flag captured when a transaction begins (for cancel restore). */
  private dirtyAtTransactionStart: boolean | null = null;
  private readonly historyOptions: CompositionHistoryOptions;

  constructor(document: CompositionDocument, options: EditorSessionOptions = {}) {
    this.historyOptions = {
      limit: options.limit,
      coalesceWindowMs: options.coalesceWindowMs,
    };
    this.history = new CompositionHistory(document, this.historyOptions);
    this.savedDocument = document;
    this.activeBreakpoint = options.breakpoint ?? 'desktop';
    this.editorMode = options.mode ?? 'edit';
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot / subscription                                              */
  /* ------------------------------------------------------------------ */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EditorSessionSnapshot => {
    if (this.snapshotCache) return this.snapshotCache;
    const document = this.history.present;
    const selection = this.selectionIds;
    this.snapshotCache = {
      document,
      selection,
      primarySelection: selection[0] ?? null,
      hoveredNodeId: this.hoveredId,
      breakpoint: this.activeBreakpoint,
      mode: this.editorMode,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: !Object.is(document, this.savedDocument),
      diagnostics: this.lastDiagnostics,
      inTransaction: this.history.inTransaction,
      revision: this.revision,
    };
    return this.snapshotCache;
  };

  private notify(): void {
    this.snapshotCache = null;
    this.revision += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Subscriber errors must not break other listeners.
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Document accessors                                                   */
  /* ------------------------------------------------------------------ */

  get document(): CompositionDocument {
    return this.history.present;
  }

  get selection(): readonly string[] {
    return this.selectionIds;
  }

  get primarySelection(): string | null {
    return this.selectionIds[0] ?? null;
  }

  get hoveredNodeId(): string | null {
    return this.hoveredId;
  }

  get breakpoint(): BreakpointId {
    return this.activeBreakpoint;
  }

  get mode(): EditorMode {
    return this.editorMode;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get dirty(): boolean {
    return !Object.is(this.history.present, this.savedDocument);
  }

  get diagnostics(): readonly CompositionDiagnostic[] {
    return this.lastDiagnostics;
  }

  get inTransaction(): boolean {
    return this.history.inTransaction;
  }

  selectedNodes(): CompositionNode[] {
    const doc = this.document;
    const nodes: CompositionNode[] = [];
    for (const id of this.selectionIds) {
      const node = findNode(doc, id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /* ------------------------------------------------------------------ */
  /* Selection / hover / viewport (no history, no dirty)                  */
  /* ------------------------------------------------------------------ */

  select(nodeIds: readonly string[]): void {
    const valid = collectNodeIds(this.document);
    const next = sortSelectionByDocumentOrder(
      [...new Set(nodeIds.filter((id) => valid.has(id)))],
      this.document,
    );
    if (arraysEqual(this.selectionIds, next)) return;
    this.selectionIds = next;
    this.notify();
  }

  toggleSelection(nodeId: string): void {
    if (!findNode(this.document, nodeId)) return;
    const set = new Set(this.selectionIds);
    if (set.has(nodeId)) set.delete(nodeId);
    else set.add(nodeId);
    const next = sortSelectionByDocumentOrder([...set], this.document);
    if (arraysEqual(this.selectionIds, next)) return;
    this.selectionIds = next;
    this.notify();
  }

  clearSelection(): void {
    if (this.selectionIds.length === 0) return;
    this.selectionIds = [];
    this.notify();
  }

  hover(nodeId: string | null): void {
    if (nodeId !== null && !findNode(this.document, nodeId)) {
      if (this.hoveredId === null) return;
      this.hoveredId = null;
      this.notify();
      return;
    }
    if (this.hoveredId === nodeId) return;
    this.hoveredId = nodeId;
    this.notify();
  }

  clearHover(): void {
    this.hover(null);
  }

  setBreakpoint(breakpoint: BreakpointId): void {
    if (this.activeBreakpoint === breakpoint) return;
    this.activeBreakpoint = breakpoint;
    this.notify();
  }

  setMode(mode: EditorMode): void {
    if (this.editorMode === mode) return;
    this.editorMode = mode;
    this.notify();
  }

  /* ------------------------------------------------------------------ */
  /* Document lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Replace the working document (load/import). Resets history, selection,
   * diagnostics and establishes a clean saved baseline.
   */
  loadDocument(document: CompositionDocument): void {
    this.history.reset(document);
    this.savedDocument = document;
    this.selectionIds = [];
    this.hoveredId = null;
    this.lastDiagnostics = [];
    this.dirtyAtTransactionStart = null;
    this.notify();
  }

  /**
   * Mark the current document as the saved baseline without history entry.
   */
  markSaved(): void {
    this.savedDocument = this.history.present;
    this.history.checkpoint();
    this.notify();
  }

  /* ------------------------------------------------------------------ */
  /* Validated operation dispatch                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Apply a pure operation function against the current document.
   * Failed results leave document and history unchanged.
   */
  dispatch(operation: EditorOperation, options: { coalesceKey?: string } = {}): OperationResult {
    const result = operation(this.history.present);
    if (!result.ok) {
      this.lastDiagnostics = result.diagnostics;
      this.notify();
      return result;
    }
    const changed = this.history.apply(result.document, options.coalesceKey);
    if (!changed) {
      this.lastDiagnostics = [];
      // Still may need selection prune if op was no-op identity
      this.pruneSelectionAgainstDocument();
      this.notify();
      return result;
    }
    this.lastDiagnostics = [];
    this.syncSelectionAfterDocumentChange(result.document);
    this.notify();
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Transactions                                                         */
  /* ------------------------------------------------------------------ */

  beginTransaction(): void {
    if (this.history.inTransaction) return;
    this.dirtyAtTransactionStart = this.dirty;
    this.history.beginTransaction();
    this.notify();
  }

  commitTransaction(): void {
    if (!this.history.inTransaction) return;
    this.history.endTransaction();
    this.dirtyAtTransactionStart = null;
    this.pruneSelectionAgainstDocument();
    this.notify();
  }

  cancelTransaction(): void {
    if (!this.history.inTransaction) return;
    this.history.cancelTransaction();
    this.dirtyAtTransactionStart = null;
    this.lastDiagnostics = [];
    this.pruneSelectionAgainstDocument();
    this.notify();
  }

  undo(): boolean {
    if (!this.history.canUndo) return false;
    this.history.undo();
    this.lastDiagnostics = [];
    this.pruneSelectionAgainstDocument();
    this.notify();
    return true;
  }

  redo(): boolean {
    if (!this.history.canRedo) return false;
    this.history.redo();
    this.lastDiagnostics = [];
    this.pruneSelectionAgainstDocument();
    this.notify();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Selection maintenance after document changes                         */
  /* ------------------------------------------------------------------ */

  private pruneSelectionAgainstDocument(): void {
    const valid = collectNodeIds(this.history.present);
    const next = pruneSelection(this.selectionIds, valid);
    this.selectionIds = sortSelectionByDocumentOrder(next, this.history.present);
    if (this.hoveredId !== null && !valid.has(this.hoveredId)) {
      this.hoveredId = null;
    }
  }

  private syncSelectionAfterDocumentChange(doc: CompositionDocument): void {
    this.pruneSelectionAgainstDocument();
    // Keep selection sorted by new document order.
    this.selectionIds = sortSelectionByDocumentOrder(this.selectionIds, doc);
  }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
