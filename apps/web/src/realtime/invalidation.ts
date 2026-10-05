



import { eventInvalidationKeys, type DashboardEvent } from './sseClient.js';
import { logger } from '../lib/logger.js';

type Listener = (keys: string[], event: DashboardEvent) => void;

const listeners = new Set<Listener>();
const lastSeen = new Set<string>();

export function subscribeInvalidation(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function handleRealtimeEvent(event: DashboardEvent): void {
  if (lastSeen.has(event.eventId)) {
    logger.debug('dashboard.realtime.invalidate', { eventId: event.eventId, status: 'duplicate' });
    return;
  }
  lastSeen.add(event.eventId);
  if (lastSeen.size > 500) {
    const first = lastSeen.values().next().value;
    if (first) lastSeen.delete(first);
  }
  const keys = eventInvalidationKeys(event);
  logger.debug('dashboard.realtime.invalidate', {
    eventId: event.eventId,
    eventType: event.type,
    keys: keys.join(','),
  });
  for (const fn of listeners) fn(keys, event);
}

export function matchesKey(keys: string[], interest: string): boolean {
  return keys.some((k) => k === interest || k.startsWith(`${interest}:`) || interest.startsWith(`${k}:`));
}
