/**
 * Phase 4 — Search index Cross-Host peer application.
 * Worker A publishes; Worker B subscribers apply into durable index.
 */

import {
    publishCrossHost,
    subscribeCrossHostChannel,
    type CrossHostEnvelope,
} from '../crossHost/transportBus.js';
import { applyRemoteSearchIndexEvent, publishSearchRemove, publishSearchUpsert } from './searchIndexSync.js';
import type { SearchCandidate, SearchResultKind } from './searchAuthz.js';

const CHANNEL = 'dash.search.index';

export type SearchSyncWorkerContext = {
    readonly workerId: string;
    unsubscribe?: () => void;
};

/**
 * Subscribe this worker to search index events from peers.
 * Idempotent application via durable store.
 */
export function startSearchIndexPeerSubscriber(worker: SearchSyncWorkerContext): () => void {
    const unsub = subscribeCrossHostChannel(CHANNEL, async (env: CrossHostEnvelope) => {
        if (env.sourceWorkerId === worker.workerId) return; // ignore self
        if (env.type !== 'search.index.upsert' && env.type !== 'search.index.remove') return;
        await applyRemoteSearchIndexEvent({ type: env.type, payload: env.payload });
    });
    worker.unsubscribe = unsub;
    return unsub;
}

/**
 * Local mutation + Cross-Host fanout.
 */
export async function mutateSearchAndPropagate(
    workerId: string,
    op: 'upsert' | 'remove',
    candidateOrKey: SearchCandidate | { kind: SearchResultKind; id: string },
): Promise<void> {
    if (op === 'upsert') {
        const c = candidateOrKey as SearchCandidate;
        await publishSearchUpsert(c);
        await publishCrossHost(CHANNEL, workerId, 'search.index.upsert', c);
    } else {
        const k = candidateOrKey as { kind: SearchResultKind; id: string };
        await publishSearchRemove(k.kind, k.id);
        await publishCrossHost(CHANNEL, workerId, 'search.index.remove', k);
    }
}
