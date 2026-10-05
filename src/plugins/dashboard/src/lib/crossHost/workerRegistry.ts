/**
 * Phase 4 — Authoritative Cross-Host worker endpoint registry.
 * Orchestrator is the authority; clients never supply worker endpoints.
 */

import { kvGet, kvSet } from '../../../../dash-data/src/lib/store.js';

export type WorkerRegistrationState = 'active' | 'stale' | 'disabled' | 'expired';

export interface WorkerEndpointRecord {
    readonly machineId: string;
    readonly endpoint: string;
    readonly generation: number;
    readonly state: WorkerRegistrationState;
    readonly lastHeartbeatAt: number;
    readonly registeredAt: number;
    readonly zeneVersion?: string;
    readonly capabilities?: readonly string[];
    readonly tlsRequired?: boolean;
    /** Expiry absolute ms; heartbeat extends. */
    readonly expiresAt: number;
}

const NS = 'crosshost_worker_registry';
const NS_INDEX = 'crosshost_worker_index';
const DEFAULT_TTL_MS = 90_000;

function indexKey(): string {
    return 'machines';
}

async function loadIndex(): Promise<string[]> {
    const raw = await kvGet(NS_INDEX, indexKey());
    return Array.isArray(raw) ? (raw as string[]) : [];
}

async function saveIndex(ids: string[]): Promise<void> {
    await kvSet(NS_INDEX, indexKey(), [...new Set(ids)]);
}

export async function registerWorker(input: {
    machineId: string;
    endpoint: string;
    generation: number;
    zeneVersion?: string;
    capabilities?: readonly string[];
    tlsRequired?: boolean;
    ttlMs?: number;
}): Promise<WorkerEndpointRecord> {
    if (!input.machineId || !input.endpoint) {
        throw new Error('machineId and endpoint required');
    }
    // Reject client-looking loopback spoof patterns only if empty — real validation is orchestrator-signed
    const now = Date.now();
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    const rec: WorkerEndpointRecord = {
        machineId: input.machineId,
        endpoint: input.endpoint.replace(/\/$/, ''),
        generation: input.generation,
        state: 'active',
        lastHeartbeatAt: now,
        registeredAt: now,
        zeneVersion: input.zeneVersion,
        capabilities: input.capabilities,
        tlsRequired: input.tlsRequired ?? true,
        expiresAt: now + ttl,
    };
    await kvSet(NS, input.machineId, rec);
    const idx = await loadIndex();
    if (!idx.includes(input.machineId)) {
        idx.push(input.machineId);
        await saveIndex(idx);
    }
    return rec;
}

export async function heartbeatWorker(
    machineId: string,
    generation: number,
    ttlMs = DEFAULT_TTL_MS,
): Promise<WorkerEndpointRecord | null> {
    const cur = await getWorker(machineId);
    if (!cur) return null;
    if (cur.state === 'disabled') return cur;
    if (generation < cur.generation) {
        // stale generation — reject heartbeat
        return { ...cur, state: 'stale' };
    }
    const now = Date.now();
    const next: WorkerEndpointRecord = {
        ...cur,
        generation: Math.max(cur.generation, generation),
        lastHeartbeatAt: now,
        expiresAt: now + ttlMs,
        state: 'active',
    };
    await kvSet(NS, machineId, next);
    return next;
}

export async function getWorker(machineId: string): Promise<WorkerEndpointRecord | null> {
    const raw = await kvGet(NS, machineId);
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as WorkerEndpointRecord;
    if (rec.expiresAt < Date.now() && rec.state === 'active') {
        return { ...rec, state: 'expired' };
    }
    return rec;
}

export async function resolveWorkerEndpoint(
    machineId: string,
    expectedGeneration?: number,
): Promise<
    | { ok: true; endpoint: string; record: WorkerEndpointRecord }
    | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'DISABLED' | 'STALE_GENERATION' | 'STALE'; message: string }
> {
    const rec = await getWorker(machineId);
    if (!rec) return { ok: false, code: 'NOT_FOUND', message: `Worker ${machineId} not registered` };
    if (rec.state === 'disabled') return { ok: false, code: 'DISABLED', message: 'Worker disabled' };
    if (rec.state === 'expired' || rec.expiresAt < Date.now()) {
        return { ok: false, code: 'EXPIRED', message: 'Worker registration expired' };
    }
    if (rec.state === 'stale') return { ok: false, code: 'STALE', message: 'Worker stale' };
    if (typeof expectedGeneration === 'number' && expectedGeneration > 0 && rec.generation !== expectedGeneration) {
        return {
            ok: false,
            code: 'STALE_GENERATION',
            message: `Expected generation ${expectedGeneration}, have ${rec.generation}`,
        };
    }
    return { ok: true, endpoint: rec.endpoint, record: rec };
}

export async function disableWorker(machineId: string): Promise<void> {
    const cur = await getWorker(machineId);
    if (!cur) return;
    await kvSet(NS, machineId, { ...cur, state: 'disabled' as const });
}

export async function listWorkers(): Promise<WorkerEndpointRecord[]> {
    const idx = await loadIndex();
    const out: WorkerEndpointRecord[] = [];
    for (const id of idx) {
        const w = await getWorker(id);
        if (w) out.push(w);
    }
    return out;
}

/** Endpoint resolver for Cross-Host forwarder */
export function createWorkerEndpointResolver(): {
    resolveBaseUrl(workerId: string): string | null;
} {
    const cache = new Map<string, string>();
    return {
        resolveBaseUrl(workerId: string): string | null {
            // Synchronous cache only — callers needing freshness should await resolveWorkerEndpoint
            return cache.get(workerId) ?? null;
        },
    };
}

export async function refreshEndpointResolverCache(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const w of await listWorkers()) {
        if (w.state === 'active' && w.expiresAt > Date.now()) {
            map.set(w.machineId, w.endpoint);
        }
    }
    return map;
}
