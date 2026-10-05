/**
 * Phase 4 — In-process Cross-Host transport boundary for integration tests and single-process fanout.
 * Production Cross-Host uses Redis pub/sub; this abstraction is the contract both share.
 */

export type CrossHostEnvelope = {
    readonly messageId: string;
    readonly sourceWorkerId: string;
    readonly type: string;
    readonly payload: unknown;
    readonly occurredAt: number;
    readonly sequence: number;
};

type Handler = (env: CrossHostEnvelope) => void | Promise<void>;

let sequence = 0;
const handlers = new Map<string, Set<Handler>>();
const seenMessageIds = new Set<string>();
const SEEN_MAX = 5_000;

export function resetCrossHostTransportForTests(): void {
    sequence = 0;
    handlers.clear();
    seenMessageIds.clear();
}

export function subscribeCrossHostChannel(channel: string, handler: Handler): () => void {
    let set = handlers.get(channel);
    if (!set) {
        set = new Set();
        handlers.set(channel, set);
    }
    set.add(handler);
    return () => {
        set!.delete(handler);
    };
}

export async function publishCrossHost(
    channel: string,
    sourceWorkerId: string,
    type: string,
    payload: unknown,
    messageId?: string,
): Promise<CrossHostEnvelope> {
    sequence += 1;
    const env: CrossHostEnvelope = {
        messageId: messageId ?? `ch_${sequence}_${Date.now()}`,
        sourceWorkerId,
        type,
        payload,
        occurredAt: Date.now(),
        sequence,
    };
    if (seenMessageIds.has(env.messageId)) {
        return env; // dedupe publish
    }
    seenMessageIds.add(env.messageId);
    if (seenMessageIds.size > SEEN_MAX) {
        const first = seenMessageIds.values().next().value;
        if (first) seenMessageIds.delete(first);
    }
    const set = handlers.get(channel);
    if (set) {
        for (const h of [...set]) {
            await h(env);
        }
    }
    return env;
}

export function wasMessageSeen(messageId: string): boolean {
    return seenMessageIds.has(messageId);
}
