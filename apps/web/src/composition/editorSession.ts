/**
 * Canonical composition editor session.
 *
 * Owns one CompositionDocument plus editor-only UI state. Document mutations
 * always go through existing validated operations + CompositionHistory.
 * Selection / hover / breakpoint / mode never enter history or dirty tracking.
 *
 * Document boundary: session-owned trees are deep-cloned on intake and deep-
 * frozen before exposure so external code cannot mutate session state.
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
import { cloneDocument } from './schema.js';
import type { RegistryLike } from './types.js';

export type EditorMode = 'edit' | 'preview';

export interface EditorSessionOptions extends CompositionHistoryOptions {
  breakpoint?: BreakpointId;
  mode?: EditorMode;
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

/** Deep-freeze a JSON-compatible value. Idempotent on already-frozen trees. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(value);
}

/** Clone then freeze — independent, immutable session ownership. */
function adoptDocument(doc: CompositionDocument): CompositionDocument {
  return deepFreeze(cloneDocument(doc));
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
      x.severity !== y.severity ||
      x.code !== y.code ||
      x.message !== y.message ||
      x.nodeId !== y.nodeId ||
      x.path !== y.path ||
      x.property !== y.property
    ) {
      return false;
    }
  }
  return true;
}

function freezeDiagnostic(d: CompositionDiagnostic): Readonly<CompositionDiagnostic> {
  return Object.freeze({
    severity: d.severity,
    code: d.code,
    message: d.message,
    ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
    ...(d.path !== undefined ? { path: d.path } : {}),
    ...(d.property !== undefined ? { property: d.property } : {}),
  });
}

function freezeDiagnostics(
  list: readonly CompositionDiagnostic[],
): readonly CompositionDiagnostic[] {
  return Object.freeze(list.map((d) => freezeDiagnostic(d)));
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
  private transactionCheckpoint: TransactionCheckpoint | null = null;
  private readonly registry: RegistryLike;

  constructor(document: CompositionDocument, options: EditorSessionOptions = {}) {
    const owned = adoptDocument(document);
    this.history = new CompositionHistory(owned, {
      limit: options.limit,
      coalesceWindowMs: options.coalesceWindowMs,
    });
    this.savedDocument = owned;
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
    const selection = Object.freeze([...this.selectionIds]) as readonly string[];
    const diagnostics = freezeDiagnostics(this.lastDiagnostics);
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

  /** Invalidate cache and notify subscribers of an observable change. */
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
  /* Accessors                                                            */
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
    return !this.history.inTransaction && this.history.canRedo;
  }

  get dirty(): boolean {
    return !Object.is(this.history.present, this.savedDocument);
  }

  get diagnostics(): readonly CompositionDiagnostic[] {
    return freezeDiagnostics(this.lastDiagnostics);
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
    // Nodes are already frozen as part of the session document tree.
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

  loadDocument(document: CompositionDocument): void {
    const owned = adoptDocument(document);
    this.history.reset(owned);
    this.savedDocument = owned;
    this.selectionIds = [];
    this.hoveredId = null;
    this.lastDiagnostics = [];
    this.transactionCheckpoint = null;
    this.notify();
  }

  markSaved(): void {
    if (Object.is(this.history.present, this.savedDocument)) {
      this.history.checkpoint();
      return;
    }
    this.savedDocument = this.history.present;
    this.history.checkpoint();
    this.notify();
  }

  /* ------------------------------------------------------------------ */
  /* Validated operation dispatch                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Apply a pure operation against the current frozen document.
   * Identity-preserving no-ops keep the same document reference (no history).
   * New documents are re-validated and adopted (clone + freeze) before history.
   */
  dispatch(operation: EditorOperation, options: { coalesceKey?: string } = {}): OperationResult {
    const input = this.history.present;
    const result = operation(input);

    if (!result.ok) {
      const frozen = freezeDiagnostics(result.diagnostics);
      if (diagnosticsEqual(this.lastDiagnostics, result.diagnostics)) {
        // Still return an independently frozen copy; never the caller's array/objects.
        return { ok: false, diagnostics: frozen };
      }
      // Own copies for internal state (unfrozen until exposed via getters/snapshot).
      this.lastDiagnostics = result.diagnostics.map((d) => ({ ...d }));
      this.notify();
      return { ok: false, diagnostics: frozen };
    }

    // Identity no-op: same document reference — preserve history and dirty state.
    if (Object.is(result.document, input)) {
      if (this.lastDiagnostics.length === 0) {
        return { ok: true, document: input };
      }
      this.lastDiagnostics = [];
      this.notify();
      return { ok: true, document: input };
    }

    const validation = validateDocument(result.document, this.registry);
    if (!validation.ok) {
      const diagnostics = validation.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => ({ ...d }));
      if (diagnosticsEqual(this.lastDiagnostics, diagnostics)) {
        return { ok: false, diagnostics: freezeDiagnostics(diagnostics) };
      }
      this.lastDiagnostics = diagnostics;
      this.notify();
      return { ok: false, diagnostics: freezeDiagnostics(diagnostics) };
    }

    const previousSelection = [...this.selectionIds];
    const previousHover = this.hoveredId;
    const previousDiagnosticsLen = this.lastDiagnostics.length;
    const ownedNext = adoptDocument(result.document);

    const changed = this.history.apply(ownedNext, options.coalesceKey);
    this.lastDiagnostics = [];
    this.syncSelectionAfterDocumentChange(ownedNext);

    const selectionChanged = !arraysEqual(previousSelection, this.selectionIds);
    const hoverChanged = previousHover !== this.hoveredId;
    const diagnosticsCleared = previousDiagnosticsLen > 0;

    if (!changed && !selectionChanged && !hoverChanged && !diagnosticsCleared) {
      return { ok: true, document: this.history.present };
    }

    this.notify();
    return { ok: true, document: this.history.present };
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
    this.notify();
  }

  commitTransaction(): void {
    if (!this.history.inTransaction) return;
    this.history.endTransaction();
    this.transactionCheckpoint = null;
    this.pruneSelectionAgainstDocument();
    this.notify();
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
    this.notify();
  }

  /**
   * While a transaction is open, undo cancels the transaction only.
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
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.history.inTransaction) return false;
    if (!this.history.canRedo) return false;
    const before = this.history.present;
    this.history.redo();
    if (Object.is(before, this.history.present)) return false;
    this.lastDiagnostics = [];
    this.pruneSelectionAgainstDocument();
    this.notify();
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
