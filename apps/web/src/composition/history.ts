import type { CompositionDocument } from './types.js';

export interface CompositionHistoryOptions {
  limit?: number;
  /** Window in ms for coalescing consecutive edits with the same key. */
  coalesceWindowMs?: number;
}

interface CoalesceState {
  key: string;
  at: number;
}

/**
 * Snapshot history with transaction grouping. One drag/resize transaction
 * produces one undo entry; selections never touch this object.
 */
export class CompositionHistory {
  private past: CompositionDocument[] = [];
  private presentState: CompositionDocument;
  private future: CompositionDocument[] = [];
  private readonly limit: number;
  private readonly coalesceWindowMs: number;
  private transactionStart: CompositionDocument | null = null;
  private lastCoalesce: CoalesceState | null = null;

  constructor(initial: CompositionDocument, options: CompositionHistoryOptions = {}) {
    this.presentState = initial;
    this.limit = Math.max(1, options.limit ?? 100);
    this.coalesceWindowMs = options.coalesceWindowMs ?? 900;
  }

  get present(): CompositionDocument {
    return this.presentState;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get inTransaction(): boolean {
    return this.transactionStart !== null;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  beginTransaction(): void {
    if (this.transactionStart !== null) return;
    this.transactionStart = this.presentState;
    this.lastCoalesce = null;
  }

  endTransaction(): CompositionDocument {
    if (this.transactionStart === null) return this.presentState;
    const start = this.transactionStart;
    this.transactionStart = null;
    if (start !== this.presentState) {
      this.pushPast(start);
      this.future = [];
    }
    this.lastCoalesce = null;
    return this.presentState;
  }

  cancelTransaction(): CompositionDocument {
    if (this.transactionStart === null) return this.presentState;
    this.presentState = this.transactionStart;
    this.transactionStart = null;
    this.lastCoalesce = null;
    return this.presentState;
  }

  /**
   * Commit a new document. Returns true when the present changed.
   * `coalesceKey` merges rapid consecutive edits (e.g. typing) into one entry.
   */
  apply(next: CompositionDocument, coalesceKey?: string): boolean {
    if (Object.is(next, this.presentState)) return false;
    if (this.transactionStart !== null) {
      this.presentState = next;
      return true;
    }
    const now = Date.now();
    const canCoalesce =
      !!coalesceKey &&
      this.lastCoalesce !== null &&
      this.lastCoalesce.key === coalesceKey &&
      now - this.lastCoalesce.at <= this.coalesceWindowMs &&
      this.past.length > 0;
    if (canCoalesce) {
      this.presentState = next;
      this.lastCoalesce = { key: coalesceKey, at: now };
      this.future = [];
      return true;
    }
    this.pushPast(this.presentState);
    this.presentState = next;
    this.future = [];
    this.lastCoalesce = coalesceKey ? { key: coalesceKey, at: now } : null;
    return true;
  }

  undo(): CompositionDocument {
    if (this.transactionStart !== null) this.cancelTransaction();
    if (this.past.length === 0) return this.presentState;
    const previous = this.past.pop() as CompositionDocument;
    this.future = [this.presentState, ...this.future].slice(0, this.limit);
    this.presentState = previous;
    this.lastCoalesce = null;
    return this.presentState;
  }

  redo(): CompositionDocument {
    if (this.transactionStart !== null) return this.presentState;
    if (this.future.length === 0) return this.presentState;
    const [next, ...rest] = this.future;
    this.pushPast(this.presentState);
    this.presentState = next as CompositionDocument;
    this.future = rest;
    this.lastCoalesce = null;
    return this.presentState;
  }

  /** Replace the document and reset history (load/restore boundary). */
  reset(next: CompositionDocument): void {
    this.past = [];
    this.future = [];
    this.presentState = next;
    this.transactionStart = null;
    this.lastCoalesce = null;
  }

  /** Mark the current state as saved without adding history. */
  checkpoint(): CompositionDocument {
    this.lastCoalesce = null;
    return this.presentState;
  }

  private pushPast(doc: CompositionDocument): void {
    this.past.push(doc);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }
}
