




export interface DashboardEvent {
  eventId: string;
  type: string;
  occurredAt?: string;
  sequence?: number;
  resource?: {
    type?: string;
    id?: string;
    guildId?: string;
    pluginId?: string;
  };
  payload?: unknown;
}

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface RealtimeClientOptions {
  url?: string;
  getToken?: () => string | null;
  scopes?: string[];
  onEvent?: (event: DashboardEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
}

export class RealtimeClient {
  private es: EventSource | null = null;
  private status: RealtimeStatus = 'idle';
  private lastEventId: string | undefined;
  private seen = new Set<string>();
  private backoffMs = 1000;
  private closed = false;
  private readonly url: string;
  private readonly getToken?: () => string | null;
  private readonly scopes: string[];
  private readonly onEvent?: (event: DashboardEvent) => void;
  private readonly onStatus?: (status: RealtimeStatus) => void;

  constructor(options: RealtimeClientOptions = {}) {
    this.url = options.url ?? '/api/dash/events/sse';
    this.getToken = options.getToken;
    this.scopes = options.scopes ?? [];
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  connect(): void {
    if (this.closed) return;
    this.setStatus(this.status === 'idle' ? 'connecting' : 'reconnecting');
    const token = this.getToken?.();
    const params = new URLSearchParams();
    if (this.scopes.length) params.set('scopes', this.scopes.join(','));


    let url = this.url;
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    if (token) url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;

    try {
      this.es = new EventSource(url, { withCredentials: true });
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.es.onopen = () => {
      this.backoffMs = 1000;
      this.setStatus('open');
    };

    this.es.onerror = () => {
      this.es?.close();
      this.es = null;
      this.scheduleReconnect();
    };

    this.es.onmessage = (msg) => {
      this.handleRaw(msg.data, msg.lastEventId || undefined);
    };


    for (const name of ['registry.updated', 'theme.updated', 'layout.updated', 'heartbeat', 'job.created', 'job.cancelled']) {
      this.es.addEventListener(name, (ev) => {
        const e = ev as MessageEvent;
        this.handleRaw(typeof e.data === 'string' ? e.data : '', e.lastEventId || undefined, name);
      });
    }
  }

  private handleRaw(data: string, lastEventId?: string, typeHint?: string): void {
    if (!data) return;
    let parsed: DashboardEvent;
    try {
      const json = JSON.parse(data) as DashboardEvent;
      parsed = {
        eventId: json.eventId || lastEventId || crypto.randomUUID(),
        type: json.type || typeHint || 'message',
        occurredAt: json.occurredAt,
        sequence: json.sequence,
        resource: json.resource,
        payload: json.payload ?? json,
      };
    } catch {
      return;
    }
    if (this.seen.has(parsed.eventId)) return;
    this.seen.add(parsed.eventId);
    if (this.seen.size > 500) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
    this.lastEventId = parsed.eventId;
    this.onEvent?.(parsed);
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.setStatus('reconnecting');
    const delay = this.backoffMs;
    this.backoffMs = Math.min(30_000, this.backoffMs * 2);
    window.setTimeout(() => this.connect(), delay);
  }

  private setStatus(s: RealtimeStatus): void {
    this.status = s;
    this.onStatus?.(s);
  }

  disconnect(): void {
    this.closed = true;
    this.es?.close();
    this.es = null;
    this.setStatus('closed');
  }

  getLastEventId(): string | undefined {
    return this.lastEventId;
  }
}


export function eventInvalidationKeys(event: DashboardEvent): string[] {
  const keys: string[] = [`event:${event.type}`];
  if (event.resource?.type) keys.push(`resource:${event.resource.type}`);
  if (event.resource?.id) keys.push(`resource:${event.resource.type}:${event.resource.id}`);
  if (event.resource?.guildId) keys.push(`guild:${event.resource.guildId}`);
  if (event.type.startsWith('registry')) keys.push('registry');
  if (event.type.startsWith('theme')) keys.push('theme');
  if (event.type.startsWith('layout')) keys.push('layout');
  return keys;
}
