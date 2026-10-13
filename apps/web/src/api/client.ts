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
  /** Internal: skip CSRF acquisition (used for the CSRF token GET itself). */
  skipCsrf?: boolean;
}

/** @deprecated Cookie session is authoritative; storage key retained only for cleanup of old clients. */
export const SESSION_STORAGE_KEY = 'dash.session';

const UNSAFE_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

/** In-memory CSRF token for the current Core session (never persisted to storage). */
let cachedCsrfToken: string | null = null;
let csrfFetchInFlight: Promise<string> | null = null;

export function clearCsrfToken(): void {
  cachedCsrfToken = null;
  csrfFetchInFlight = null;
}

export function getCachedCsrfToken(): string | null {
  return cachedCsrfToken;
}

/** Test seam: seed or clear the in-memory CSRF cache. */
export function setCachedCsrfTokenForTests(token: string | null): void {
  cachedCsrfToken = token;
  csrfFetchInFlight = null;
}

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

function isCsrfFailure(err: unknown): boolean {
  return (
    err instanceof DashApiError &&
    (err.code === 'csrf_failure' ||
      err.code === 'CSRF_FAILURE' ||
      /csrf/i.test(err.code) ||
      /csrf/i.test(err.message))
  );
}

export class DashApiClient {
  constructor(
    private readonly baseUrl = '/api/dash',
    /** @deprecated Ignored — Core HttpOnly cookie carries the session. */
    _getSessionToken?: () => string | null,
  ) {}

  /**
   * Fetch a CSRF token from GET /auth/csrf (safe method — no CSRF header).
   * Response schema: { ok: true, data: { csrfToken: string } }.
   */
  async fetchCsrfToken(signal?: AbortSignal): Promise<string> {
    if (cachedCsrfToken) return cachedCsrfToken;
    if (csrfFetchInFlight) return csrfFetchInFlight;

    csrfFetchInFlight = (async () => {
      try {
        const data = await this.request<{ csrfToken?: unknown }>('/auth/csrf', {
          method: 'GET',
          skipCsrf: true,
          signal,
          retrySafe: false,
        });
        const token =
          data && typeof data === 'object' && typeof data.csrfToken === 'string'
            ? data.csrfToken
            : null;
        if (!token || token.length < 8) {
          throw new DashApiError(
            500,
            'MALFORMED_CSRF_RESPONSE',
            'CSRF endpoint did not return a csrfToken string',
          );
        }
        cachedCsrfToken = token;
        return token;
      } finally {
        csrfFetchInFlight = null;
      }
    })();

    return csrfFetchInFlight;
  }

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
    // Do not attach Authorization: Bearer or X-Dash-Session — session is HttpOnly cookie only.

    const needsCsrf = UNSAFE_METHODS.has(method) && options.skipCsrf !== true;
    if (needsCsrf) {
      const token = await this.fetchCsrfToken(options.signal);
      headers['X-CSRF-Token'] = token;
    }

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
      logger.debug('api.idempotency', { path, hasKey: true });
    }
    if (options.expectedVersion !== undefined) {
      headers['If-Match'] = String(options.expectedVersion);
    }

    // GET may retry once; mutations never auto-retry (avoid duplicate side effects).
    // Single bounded CSRF refresh: at most one extra attempt after csrf_failure.
    const maxAttempts = method === 'GET' && options.retrySafe !== false ? 2 : 1;
    let csrfRetried = false;
    let lastError: unknown;
    const started = Date.now();
    let attempt = 0;
    while (attempt < maxAttempts) {
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
            throw new DashApiError(
              res.status,
              'MALFORMED_RESPONSE',
              'Response was not JSON',
              undefined,
              requestId,
            );
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
          const err = new DashApiError(
            res.status,
            code,
            message,
            details,
            requestId ?? (json && !json.ok ? json.requestId : undefined),
          );
          // Narrow CSRF retry: refresh token once, then re-issue the same request.
          if (needsCsrf && !csrfRetried && isCsrfFailure(err)) {
            csrfRetried = true;
            clearCsrfToken();
            const fresh = await this.fetchCsrfToken(options.signal);
            headers['X-CSRF-Token'] = fresh;
            attempt += 1;
            continue;
          }
          throw err;
        }
        if (json && json.ok === false) {
          throw new DashApiError(
            res.status,
            json.error.code,
            json.error.message,
            json.error.details,
            json.requestId,
          );
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
        attempt += 1;
        continue;
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

  /** Server logout: POST /auth/logout with CSRF when a session cookie may exist. */
  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST', retrySafe: false });
    } finally {
      clearCsrfToken();
    }
  }
}

/** Same-origin relative API; session is the HttpOnly Core cookie only. */
export const apiClient = new DashApiClient('/api/dash');
