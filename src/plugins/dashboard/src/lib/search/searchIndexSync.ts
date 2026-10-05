/**
 * Phase 4 — Search index Cross-Host synchronization via EventBus-style publish hooks.
 * Workers observe the same durable store; mutations emit index events for peers.
 */

import { durableUpsertTracked, durableRemove } from './durableSearchRepository.js';
import type { SearchCandidate, SearchResultKind } from './searchAuthz.js';
import { publishDashboardEvent } from '../realtime/broker.js';

export type SearchIndexEventType = 'search.index.upsert' | 'search.index.remove' | 'search.index.rebuild';

export async function publishSearchUpsert(candidate: SearchCandidate): Promise<void> {
    await durableUpsertTracked(candidate);
    publishDashboardEvent({
        type: 'search.index.upsert',
        resource: {
            type: 'global',
            id: `${candidate.kind}:${candidate.id}`,
            guildId: candidate.guildId,
            pluginId: candidate.pluginId,
        },
        payload: { kind: candidate.kind, id: candidate.id, title: candidate.title },
    });
}

export async function publishSearchRemove(kind: SearchResultKind, id: string): Promise<void> {
    await durableRemove(kind, id);
    publishDashboardEvent({
        type: 'search.index.remove',
        resource: { type: 'global', id: `${kind}:${id}` },
        payload: { kind, id },
    });
}

/**
 * Apply a remote index event into the durable store (idempotent).
 */
export async function applyRemoteSearchIndexEvent(event: {
    type: string;
    payload?: unknown;
}): Promise<void> {
    if (event.type === 'search.index.upsert' && event.payload && typeof event.payload === 'object') {
        const p = event.payload as SearchCandidate;
        if (typeof p.id === 'string' && typeof p.kind === 'string' && typeof p.title === 'string') {
            await durableUpsertTracked(p);
        }
    }
    if (event.type === 'search.index.remove' && event.payload && typeof event.payload === 'object') {
        const p = event.payload as { kind?: SearchResultKind; id?: string };
        if (p.kind && p.id) await durableRemove(p.kind, p.id);
    }
}
