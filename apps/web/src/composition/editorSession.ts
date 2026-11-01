/**
 * Canonical composition editor session.
 *
 * Owns one CompositionDocument plus editor-only UI state. Document mutations
 * always go through existing validated operations + CompositionHistory.
 * Selection / hover / breakpoint / mode never enter history or dirty tracking.
 */

import type {
  BreakpointId,
  CompositionDiagnostic,
  CompositionDocument,
  CompositionNode,
} from './types.js';
import { CompositionHistory, type CompositionHistoryOptions } from './history.js';
import { findNode, type OperationResult, walkNodes } from './operations.js';
import { validateDocument } from './validate.js';
import { compositionRegistry } from './registry.js';
import type { RegistryLike } from './types.js';

export type EditorMode = 'edit' | 'preview';

export interface EditorSessionOptions extends CompositionHistoryOptions {
  /** Initial breakpoint. Defaults to desktop. */
  breakpoint?: BreakpointId;
  /** Initial editor mode. Defaults to edit. */
  mode?: EditorMode;
  /**
   * Registry used to re-validate successful operation results before they
   * enter history. Defaults to the application composition registry.
   */
  registry?: RegistryLike;
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

interface TransactionCheckpoint {
  selection: string[];
  hoveredId: string | null;
}

function collectNodeIds(doc: CompositionDocument): Set<string> {
  const ids = new Set<string>();
  walkNodes(doc.root, (node) => {
    ids.add(node.id);
  });
  return ids;
}

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

function sortSelectionByDocumentOrder(
  selection: readonly string[],
  doc: CompositionDocument,
): string[] {
  if (selection.length <= 1) return [...selection];
  const order = nodeIdsInDocumentOrder(doc);
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...selection].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function diagnosticsEqual(
  a: readonly CompositionDiagnostic[],
  b: readonly CompositionDiagnostic[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.code !== y.code ||
      x.message !== y.message ||
      x.severity !== y.severity ||
      x.nodeId !== y.nodeId ||
      x.path !== y.path
    ) {
      return false;
    }
  }
  return true;
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
  /** Editor-only state captured at beginTransaction for cancel restore. */
  private transactionCheckpoint: TransactionCheckpoint | null = null;
  private readonly registry: RegistryLike;

  constructor(document: CompositionDocument, options: EditorSessionOptions = {}) {
    this.history = new CompositionHistory(document, {
      limit: options.limit,
      coalesceWindowMs: options.coalesceWindowMs,
    });
    this.savedDocument = document;
    this.activeBreakpoint = options.breakpoint ?? 'desktop';
    this.editorMode = options.mode ?? 'edit';
    this.registry = options.registry ?? compositionRegistry;
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
    // Defensive copies so consumers cannot mutate session-owned arrays.
    const selection = Object.freeze([...this.selectionIds]) as readonly string[];
    const diagnostics = Object.freeze([...this.lastDiagnostics]) as readonly CompositionDiagnostic[];
    this.snapshotCache = Object.freeze({
      document,
      selection,
      primarySelection: selection[0] ?? null,
      hoveredNodeId: this.hoveredId,
      breakpoint: this.activeBreakpoint,
      mode: this.editorMode,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: !Object.is(document, this.savedDocument),
      diagnostics,
      inTransaction: this.history.inTransaction,
      revision: this.revision,
    });
    return this.snapshotCache;
  };

  /** Notify only when observable state actually changes. */
  private notifyIfChanged(): void {
    const previous = this.snapshotCache;
    this.snapshotCache = null;
    this.revision += 1;
    // Build next snapshot so identity is stable for subsequent getSnapshot calls.
    const next = this.getSnapshot();
    if (
      previous &&
      Object.is(previous.document, next.document) &&
      arraysEqual(previous.selection, next.selection) &&
      previous.hoveredNodeId === next.hoveredNodeId &&
      previous.breakpoint === next.breakpoint &&
      previous.mode === next.mode &&
      previous.canUndo === next.canUndo &&
      previous.canRedo === next.canRedo &&
      previous.dirty === next.dirty &&
      diagnosticsEqual(previous.diagnostics, next.diagnostics) &&
      previous.inTransaction === next.inTransaction
    ) {
      // Observable fields identical — restore previous identity and skip notify.
      this.snapshotCache = previous;
      this.revision -= 1;
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Subscriber errors must not break other listeners.
      }
    }
  }

  private forceNotify(): void {
    this.snapshotCache = null;
    this.revision += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Accessors (defensive copies for collections)                         */
  /* ------------------------------------------------------------------ */

  get document(): CompositionDocument {
    return this.history.present;
  }

  get selection(): readonly string[] {
    return Object.freeze([...this.selectionIds]) as readonly string[];
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
    // History refuses redo while a transaction is open.
    return !this.history.inTransaction && this.history.canRedo;
  }

  get dirty(): boolean {
    return !Object.is(this.history.present, this.savedDocument);
  }

  get diagnostics(): readonly CompositionDiagnostic[] {
    return Object.freeze([...this.lastDiagnostics]) as readonly CompositionDiagnostic[];
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
  /* Selection / hover / viewport                                         */
  /* ------------------------------------------------------------------ */

  select(nodeIds: readonly string[]): void {
    const valid = collectNodeIds(this.document);
    const next = sortSelectionByDocumentOrder(
      [...new Set(nodeIds.filter((id) => valid.has(id)))],
      this.document,
    );
    if (arraysEqual(this.selectionIds, next)) return;
    this.selectionIds = next;
    this.forceNotify();
  }

  toggleSelection(nodeId: string): void {
    if (!findNode(this.document, nodeId)) return;
    const set = new Set(this.selectionIds);
    if (set.has(nodeId)) set.delete(nodeId);
    else set.add(nodeId);
    const next = sortSelectionByDocumentOrder([...set], this.document);
    if (arraysEqual(this.selectionIds, next)) return;
    this.selectionIds = next;
    this.forceNotify();
  }

  clearSelection(): void {
    if (this.selectionIds.length === 0) return;
    this.selectionIds = [];
    this.forceNotify();
  }

  hover(nodeId: string | null): void {
    if (nodeId !== null && !findNode(this.document, nodeId)) {
      if (this.hoveredId === null) return;
      this.hoveredId = null;
      this.forceNotify();
      return;
    }
    if (this.hoveredId === nodeId) return;
    this.hoveredId = nodeId;
    this.forceNotify();
  }

  clearHover(): void {
    this.hover(null);
  }

  setBreakpoint(breakpoint: BreakpointId): void {
    if (this.activeBreakpoint === breakpoint) return;
    this.activeBreakpoint = breakpoint;
    this.forceNotify();
  }

  setMode(mode: EditorMode): void {
    if (this.editorMode === mode) return;
    this.editorMode = mode;
    this.forceNotify();
  }

  /* ------------------------------------------------------------------ */
  /* Document lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  loadDocument(document: CompositionDocument): void {
    this.history.reset(document);
    this.savedDocument = document;
    this.selectionIds = [];
    this.hoveredId = null;
    this.lastDiagnostics = [];
    this.transactionCheckpoint = null;
    this.forceNotify();
  }

  markSaved(): void {
    const already = Object.is(this.history.present, this.savedDocument);
    this.savedDocument = this.history.present;
    this.history.checkpoint();
    if (already) {
      // May still clear coalesce state inside history; only notify if dirty flipped.
      // already true means dirty was false and stays false — no notify.
      return;
    }
    this.forceNotify();
  }

  /* ------------------------------------------------------------------ */
  /* Validated operation dispatch                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Apply a pure operation function against the current document.
   * Successful results are re-validated before entering history so a forged
   * `{ ok: true, document }` cannot install an invalid tree.
   */
  dispatch(operation: EditorOperation, options: { coalesceKey?: string } = {}): OperationResult {
    const result = operation(this.history.present);
    if (!result.ok) {
      if (diagnosticsEqual(this.lastDiagnostics, result.diagnostics)) {
        return result;
      }
      this.lastDiagnostics = [...result.diagnostics];
      this.forceNotify();
      return result;
    }

    // Trust boundary: re-validate any successful result before applying.
    const validation = validateDocument(result.document, this.registry);
    if (!validation.ok) {
      const diagnostics = validation.diagnostics.filter((d) => d.severity === 'error');
      if (diagnosticsEqual(this.lastDiagnostics, diagnostics)) {
        return { ok: false, diagnostics };
      }
      this.lastDiagnostics = [...diagnostics];
      this.forceNotify();
      return { ok: false, diagnostics };
    }

    const previousDoc = this.history.present;
    const previousSelection = [...this.selectionIds];
    const previousHover = this.hoveredId;
    const previousDiagnostics = this.lastDiagnostics;

    const changed = this.history.apply(result.document, options.coalesceKey);
    this.lastDiagnostics = [];
    this.syncSelectionAfterDocumentChange(result.document);

    const selectionChanged = !arraysEqual(previousSelection, this.selectionIds);
    const hoverChanged = previousHover !== this.hoveredId;
    const diagnosticsChanged = previousDiagnostics.length > 0;
    if (!changed && !selectionChanged && !hoverChanged && !diagnosticsChanged) {
      // True no-op — restore previous diagnostics array identity if empty.
      this.lastDiagnostics = previousDiagnostics;
      return result;
    }

    this.forceNotify();
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Transactions                                                         */
  /* ------------------------------------------------------------------ */

  beginTransaction(): void {
    if (this.history.inTransaction) return;
    this.transactionCheckpoint = {
      selection: [...this.selectionIds],
      hoveredId: this.hoveredId,
    };
    this.history.beginTransaction();
    this.forceNotify();
  }

  commitTransaction(): void {
    if (!this.history.inTransaction) return;
    this.history.endTransaction();
    this.transactionCheckpoint = null;
    this.pruneSelectionAgainstDocument();
    this.forceNotify();
  }

  cancelTransaction(): void {
    if (!this.history.inTransaction) return;
    const checkpoint = this.transactionCheckpoint;
    this.history.cancelTransaction();
    this.transactionCheckpoint = null;
    this.lastDiagnostics = [];
    if (checkpoint) {
      const valid = collectNodeIds(this.history.present);
      this.selectionIds = sortSelectionByDocumentOrder(
        pruneSelection(checkpoint.selection, valid),
        this.history.present,
      );
      this.hoveredId =
        checkpoint.hoveredId !== null && valid.has(checkpoint.hoveredId)
          ? checkpoint.hoveredId
          : null;
    } else {
      this.pruneSelectionAgainstDocument();
    }
    this.forceNotify();
  }

  /**
   * Undo policy: while a transaction is open, undo cancels the transaction only.
   * It does not also unwind an earlier committed history entry.
   */
  undo(): boolean {
    if (this.history.inTransaction) {
      this.cancelTransaction();
      return true;
    }
    if (!this.history.canUndo) return false;
    const before = this.history.present;
    this.history.undo();
    if (Object.is(before, this.history.present)) return false;
    this.lastDiagnostics = [];
    this.pruneSelectionAgainstDocument();
    this.forceNotify();
    return true;
  }

  /**
   * Redo is a no-op (returns false) while a transaction is open, matching
   * CompositionHistory which refuses redo during transactions.
   */
  redo(): boolean {
    if (this.history.inTransaction) return false;
    if (!this.history.canRedo) return false;
    const before = this.history.present;
    this.history.redo();
    if (Object.is(before, this.history.present)) return false;
    this.lastDiagnostics = [];
    this.pruneSelectionAgainstDocument();
    this.forceNotify();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Selection maintenance                                                */
  /* ------------------------------------------------------------------ */

  private pruneSelectionAgainstDocument(): void {
    const valid = collectNodeIds(this.history.present);
    this.selectionIds = sortSelectionByDocumentOrder(
      pruneSelection(this.selectionIds, valid),
      this.history.present,
    );
    if (this.hoveredId !== null && !valid.has(this.hoveredId)) {
      this.hoveredId = null;
    }
  }

  private syncSelectionAfterDocumentChange(doc: CompositionDocument): void {
    this.pruneSelectionAgainstDocument();
    this.selectionIds = sortSelectionByDocumentOrder(this.selectionIds, doc);
  }
}
