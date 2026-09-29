/**
 * Phase 2A — durable idempotency foundation backed by dash-data KV.
 * Survives process restart (unlike Phase 1 in-memory Map).
 */

import { createHash } from 'node:crypto';
import { kvGet, kvSet } from '../../../dash-data/src/lib/store.js';

const NS = 'dash_idempotency';

export interface DurableIdempotencyRecord {
    actorId: string;
    operation: string;
    resourceKey: string;
    idempotencyKey: string;
    requestHash: string;
    result?: unknown;
    jobId?: string;
    createdAt: number;
    expiresAt: number;
}

function storageKey(actorId: string, operation: string, resourceKey: string, idempotencyKey: string): string {
    return `${actorId}|${operation}|${resourceKey}|${idempotencyKey}`;
}

export function hashRequestPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export async function durableIdempotencyLookup(options: {
    actorId: string;
    operation: string;
    resourceKey: string;
    idempotencyKey: string;
    requestHash: string;
}): Promise<
    | { status: 'miss' }
    | { status: 'replay'; record: DurableIdempotencyRecord }
    | { status: 'conflict' }
> {
    const key = storageKey(options.actorId, options.operation, options.resourceKey, options.idempotencyKey);
    const raw = await kvGet(NS, key);
    if (!raw || typeof raw !== 'object') return { status: 'miss' };
    const record = raw as DurableIdempotencyRecord;
    if (typeof record.expiresAt !== 'number' || record.expiresAt < Date.now()) {
        return { status: 'miss' };
    }
    if (record.requestHash !== options.requestHash) return { status: 'conflict' };
    return { status: 'replay', record };
}

export async function durableIdempotencyStore(options: {
    actorId: string;
    operation: string;
    resourceKey: string;
    idempotencyKey: string;
    requestHash: string;
    result?: unknown;
    jobId?: string;
    ttlMs?: number;
}): Promise<void> {
    const key = storageKey(options.actorId, options.operation, options.resourceKey, options.idempotencyKey);
    const now = Date.now();
    const record: DurableIdempotencyRecord = {
        actorId: options.actorId,
        operation: options.operation,
        resourceKey: options.resourceKey,
        idempotencyKey: options.idempotencyKey,
        requestHash: options.requestHash,
        result: options.result,
        jobId: options.jobId,
        createdAt: now,
        expiresAt: now + (options.ttlMs ?? 24 * 60 * 60 * 1000),
    };
    await kvSet(NS, key, record);
}
