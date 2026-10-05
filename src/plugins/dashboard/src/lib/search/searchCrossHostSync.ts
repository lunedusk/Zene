




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





export function startSearchIndexPeerSubscriber(worker: SearchSyncWorkerContext): () => void {
    const unsub = subscribeCrossHostChannel(CHANNEL, async (env: CrossHostEnvelope) => {
        if (env.sourceWorkerId === worker.workerId) return;
        if (env.type !== 'search.index.upsert' && env.type !== 'search.index.remove') return;
        await applyRemoteSearchIndexEvent({ type: env.type, payload: env.payload });
    });
    worker.unsubscribe = unsub;
    return unsub;
}




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
