




import { DashApiError, type ApiResult } from './types.js';
import { logger } from '../lib/logger.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  expectedVersion?: number;
  retrySafe?: boolean;
}


export const SESSION_STORAGE_KEY = 'dash.session';

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export class DashApiClient {
  constructor(
    private readonly baseUrl = '/api/dash',
    private readonly getSessionToken?: () => string | null,
  ) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const token = this.getSessionToken?.();
    if (token) {
      headers['X-Dash-Session'] = token;
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
      logger.debug('api.idempotency', { path, hasKey: true });
    }
    if (options.expectedVersion !== undefined) {
      headers['If-Match'] = String(options.expectedVersion);
    }

    const maxAttempts = method === 'GET' && options.retrySafe !== false ? 2 : 1;
    let lastError: unknown;
    const started = Date.now();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      logger.debug('api.request.start', { method, path, attempt, retryCount: attempt });
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: options.signal,
          credentials: 'same-origin',
        });
        const requestId = res.headers.get('x-request-id') ?? undefined;
        let json: ApiResult<T> | null = null;
        const text = await res.text();
        if (text) {
          try {
            json = JSON.parse(text) as ApiResult<T>;
          } catch {
            logger.debug('api.request.failure', {
              method,
              path,
              status: res.status,
              reason: 'malformed_json',
              requestId,
              durationMs: Date.now() - started,
            });
            throw new DashApiError(res.status, 'MALFORMED_RESPONSE', 'Response was not JSON', undefined, requestId);
          }
        }
        if (!res.ok) {
          const code = json && !json.ok ? json.error.code : `HTTP_${res.status}`;
          const message = json && !json.ok ? json.error.message : res.statusText || 'Request failed';
          const details = json && !json.ok ? json.error.details : undefined;
          logger.debug('api.request.failure', {
            method,
            path,
            status: res.status,
            code,
            requestId,
            durationMs: Date.now() - started,
          });
          throw new DashApiError(
            res.status,
            code,
            message,
            details,
            requestId ?? (json && !json.ok ? json.requestId : undefined),
          );
        }
        if (json && json.ok === false) {
          throw new DashApiError(res.status, json.error.code, json.error.message, json.error.details, json.requestId);
        }
        logger.debug('api.request.success', {
          method,
          path,
          status: res.status,
          requestId,
          durationMs: Date.now() - started,
        });
        if (json && json.ok === true) {
          return json.data;
        }
        return json as unknown as T;
      } catch (e) {
        lastError = e;
        if (e instanceof DashApiError && e.status >= 400 && e.status < 500) throw e;
        if (attempt + 1 >= maxAttempts) throw e;
        logger.debug('api.request.retry', { method, path, attempt: attempt + 1 });
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  getMe(): Promise<unknown> {
    return this.request('/me');
  }


  getPublicConfig(): Promise<unknown> {
    return this.request('/public/bot-info', { retrySafe: true });
  }

  getRegistry(): Promise<unknown> {
    return this.request('/registry');
  }

  search(q: string, page = 1, limit = 20): Promise<unknown> {
    return this.request('/search', { query: { q, page, limit } });
  }
}

export const apiClient = new DashApiClient('/api/dash', () => {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
});
