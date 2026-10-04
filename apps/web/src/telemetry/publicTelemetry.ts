/**
 * Public marketing telemetry — privacy-aware, never sends tokens/secrets.
 */

import { logger } from '../lib/logger.js';

export type PublicEventName =
  | 'page_view'
  | 'cta_invite'
  | 'cta_dashboard'
  | 'cta_docs'
  | 'login_start'
  | 'docs_nav'
  | 'search'
  | 'command_search'
  | 'command_open';

const SENSITIVE = /token|password|cookie|authorization|secret|session/i;

export function trackPublic(event: PublicEventName, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k)) continue;
    if (typeof v === 'string' && SENSITIVE.test(v)) continue;
    safe[k] = v;
  }
  logger.debug('web.telemetry.public', { event, ...safe });
  // Optional beacon to Dashboard public analytics if endpoint exists — fire-and-forget
  try {
    void fetch('/api/dash/public/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ event, ...safe, ts: Date.now() }),
      keepalive: true,
    }).catch(() => {
      /* endpoint may be absent — telemetry is best-effort */
    });
  } catch {
    /* ignore */
  }
}
