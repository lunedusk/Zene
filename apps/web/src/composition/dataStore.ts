import type {
  CompositionDocument,
  DataBinding,
  JsonValue,
} from './types.js';
import type { BindingResult, SessionView } from './runtime.js';
import { bindingKey, isApprovedBinding } from './bindings.js';

export type BindingFetcher = (path: string) => Promise<unknown>;

export interface BindingStoreOptions {
  fetcher?: BindingFetcher;
  /** How long a resolved value stays fresh. */
  ttlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  status: BindingResult['status'];
  value?: JsonValue;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

type Loader = () => Promise<JsonValue>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? (value as JsonValue[]) : [];
}

function mapServerList(payload: unknown): JsonValue {
  const list = Array.isArray(payload) ? payload : asArray(asObject(payload)['servers']);
  return list as JsonValue;
}

function mapCommandCatalog(payload: unknown): JsonValue {
  const record = asObject(payload);
  const commands = asArray(record['commands']);
  return { commands, count: commands.length };
}

/**
 * Project /public/site binding fields from either legacy or canonical responses.
 * Exported for unit tests; BindingStore uses the same pure function.
 *
 * Canonical sectionCount = length of document.root.slots.default
 * (top-level children under the page root). Empty array is valid.
 * Missing/malformed root or default slot → invalid canonical result.
 */
export function projectPublicSiteBinding(payload: unknown): JsonValue {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { title: '', description: '', sectionCount: 0 };
  }
  const record = payload as Record<string, unknown>;

  if (record['kind'] === 'composition') {
    const document = record['document'];
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return { title: '', description: '', sectionCount: 0, invalid: true };
    }
    const doc = document as Record<string, unknown>;
    const root = doc['root'];
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return { title: '', description: '', sectionCount: 0, invalid: true };
    }
    const rootObj = root as Record<string, unknown>;
    const slots = rootObj['slots'];
    if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
      return { title: '', description: '', sectionCount: 0, invalid: true };
    }
    const slotsObj = slots as Record<string, unknown>;
    // Required by structure.page: a default slot array (may be empty).
    if (!Object.prototype.hasOwnProperty.call(slotsObj, 'default') || !Array.isArray(slotsObj['default'])) {
      return { title: '', description: '', sectionCount: 0, invalid: true };
    }
    const defaultChildren = slotsObj['default'] as unknown[];

    const metadata =
      doc['metadata'] && typeof doc['metadata'] === 'object' && !Array.isArray(doc['metadata'])
        ? (doc['metadata'] as Record<string, unknown>)
        : {};
    const titleFromMeta = typeof metadata['title'] === 'string' ? metadata['title'] : '';
    const title = titleFromMeta || (typeof doc['name'] === 'string' ? doc['name'] : '');
    const description = typeof metadata['description'] === 'string' ? metadata['description'] : '';
    return { title, description, sectionCount: defaultChildren.length };
  }

  // Legacy public-site configuration with sections[].
  const metadata =
    record['metadata'] && typeof record['metadata'] === 'object' && !Array.isArray(record['metadata'])
      ? (record['metadata'] as Record<string, unknown>)
      : {};
  const title =
    (typeof metadata['title'] === 'string' && metadata['title']) ||
    (typeof record['title'] === 'string' ? record['title'] : '');
  const description =
    (typeof metadata['description'] === 'string' && metadata['description']) ||
    (typeof record['description'] === 'string' ? record['description'] : '');
  const sections = Array.isArray(record['sections']) ? record['sections'] : [];
  return { title, description, sectionCount: sections.length };
}

function mapSite(payload: unknown): JsonValue {
  return projectPublicSiteBinding(payload);
}

/**
 * Read-only binding cache for the fixed provider allowlist.
 *
 * Documents never supply endpoints; each provider id maps to a hard-coded,
 * same-origin dashboard API path. Results are shared between nodes and
 * invalidated on session/document changes.
 */
export class BindingStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly fetcher: BindingFetcher;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private session: SessionView | undefined;
  private document: CompositionDocument | undefined;
  private currentVersion = 0;

  constructor(options: BindingStoreOptions = {}) {
    this.fetcher = options.fetcher ?? (async (path) => {
      const { apiClient } = await import('../api/client.js');
      return apiClient.request(path);
    });
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  get version(): number {
    return this.currentVersion;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSession(session: SessionView | undefined): void {
    if (this.session === session) return;
    this.session = session;
    this.invalidate('account.servers');
  }

  setDocument(document: CompositionDocument | undefined): void {
    this.document = document;
    this.bump();
  }

  invalidate(provider?: string): void {
    if (!provider) {
      this.cache.clear();
    } else {
      for (const key of [...this.cache.keys()]) {
        if (key.startsWith(`${provider}:`)) this.cache.delete(key);
      }
    }
    this.bump();
  }

  /** Resolve a binding synchronously, starting a load on first read. */
  get(binding: DataBinding | undefined): BindingResult {
    if (!binding) return { status: 'idle' };
    if (!isApprovedBinding(binding)) {
      return { status: 'unavailable', error: 'Provider is not approved' };
    }
    const synthetic = this.resolveSynthetic(binding);
    if (synthetic) return synthetic;

    const key = bindingKey(binding);
    const entry = this.cache.get(key);
    if (!entry) {
      this.start(key, binding);
      return { status: 'loading' };
    }
    if (entry.status === 'ready' && this.now() - entry.updatedAt > this.ttlMs) {
      this.start(key, binding);
      return { status: 'ready', value: entry.value };
    }
    return { status: entry.status, value: entry.value, error: entry.error };
  }

  /** Extract a field out of a resolved binding. */
  value(binding: DataBinding | undefined): JsonValue | undefined {
    const result = this.get(binding);
    if (result.status !== 'ready') return undefined;
    const field = binding?.field;
    if (!field) return result.value;
    if (result.value && typeof result.value === 'object' && !Array.isArray(result.value)) {
      return (result.value as Record<string, JsonValue>)[field];
    }
    return result.value;
  }

  private resolveSynthetic(binding: DataBinding): BindingResult | undefined {
    if (binding.provider === 'session') {
      const session = this.session;
      if (!session) return { status: 'unavailable', error: 'No session context' };
      return {
        status: 'ready',
        value: {
          username: session.username ?? '',
          userId: session.userId ?? '',
          authenticated: session.authenticated,
          isOwner: session.isOwner,
        },
      };
    }
    if (binding.provider === 'document') {
      if (!this.document) return { status: 'unavailable', error: 'No document context' };
      return {
        status: 'ready',
        value: {
          title: this.document.metadata?.title ?? this.document.name,
          description: this.document.metadata?.description ?? '',
          name: this.document.name,
        },
      };
    }
    if (binding.provider === 'account.servers' && !this.session?.authenticated) {
      return { status: 'unavailable', error: 'Sign in to load account data' };
    }
    return undefined;
  }

  private start(key: string, binding: DataBinding): void {
    if (this.inFlight.has(key)) return;
    const loader = this.loaderFor(binding);
    if (!loader) {
      this.cache.set(key, {
        status: 'unavailable',
        error: 'No loader for this provider',
        startedAt: this.now(),
        updatedAt: this.now(),
      });
      this.bump();
      return;
    }
    const startedAt = this.now();
    this.cache.set(key, { status: 'loading', startedAt, updatedAt: startedAt });
    const promise = loader()
      .then((value) => {
        this.cache.set(key, { status: 'ready', value, startedAt, updatedAt: this.now() });
      })
      .catch((error: unknown) => {
        this.cache.set(key, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Binding failed',
          startedAt,
          updatedAt: this.now(),
        });
      })
      .finally(() => {
        this.inFlight.delete(key);
        this.bump();
      });
    this.inFlight.set(key, promise);
  }

  private loaderFor(binding: DataBinding): Loader | undefined {
    switch (binding.provider) {
      case 'public.stats':
        return async () => (await this.fetcher('/public/stats')) as JsonValue;
      case 'public.botInfo':
        return async () => (await this.fetcher('/public/bot-info')) as JsonValue;
      case 'public.commands':
        return async () => mapCommandCatalog(await this.fetcher('/public/commands'));
      case 'public.site':
        return async () => mapSite(await this.fetcher('/public/site'));
      case 'account.servers':
        return async () => mapServerList(await this.fetcher('/me/servers'));
      default:
        return undefined;
    }
  }

  private bump(): void {
    this.currentVersion += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Listener failures must not break other subscribers.
      }
    }
  }
}

/** Preload every distinct binding in a document (used by preview/publish). */
export function collectBindings(document: CompositionDocument): DataBinding[] {
  const out: DataBinding[] = [];
  const seen = new Set<string>();
  const visit = (node: CompositionDocument['root']): void => {
    for (const binding of Object.values(node.bindings ?? {})) {
      const key = bindingKey(binding);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(binding);
    }
    for (const children of Object.values(node.slots ?? {})) children.forEach(visit);
  };
  visit(document.root);
  return out;
}
