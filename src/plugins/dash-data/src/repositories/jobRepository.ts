



import { kvGet, kvSet, newId } from '../lib/store.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying' | 'cancelled';

export interface JobRecord {
    jobId: string;
    type: string;
    status: JobStatus;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    attempt: number;
    maxAttempts: number;
    nextAttemptAt?: number;
    actorUserId: string;
    resourceKey?: string;
    payload?: unknown;
    result?: unknown;
    error?: string;
    idempotencyKey?: string;
    requestId?: string;
}

const NS = 'dash_jobs';
const NS_INDEX = 'dash_jobs_index';

export async function createJob(input: {
    type: string;
    actorUserId: string;
    payload?: unknown;
    resourceKey?: string;
    idempotencyKey?: string;
    requestId?: string;
    maxAttempts?: number;
}): Promise<JobRecord> {
    const jobId = newId('job');
    const now = Date.now();
    const rec: JobRecord = {
        jobId,
        type: input.type,
        status: 'queued',
        createdAt: now,
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 3,
        actorUserId: input.actorUserId,
        resourceKey: input.resourceKey,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
    };
    await kvSet(NS, jobId, rec);
    await indexAppend(input.actorUserId, jobId);
    return rec;
}

async function indexAppend(userId: string, jobId: string): Promise<void> {
    const raw = await kvGet(NS_INDEX, userId);
    const list = Array.isArray(raw) ? (raw as string[]) : [];
    list.push(jobId);
    await kvSet(NS_INDEX, userId, list.slice(-200));
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
    const raw = await kvGet(NS, jobId);
    return raw && typeof raw === 'object' ? (raw as JobRecord) : null;
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const cur = await getJob(jobId);
    if (!cur) return null;
    const next = { ...cur, ...patch, jobId: cur.jobId };
    await kvSet(NS, jobId, next);
    return next;
}

export async function transitionJob(
    jobId: string,
    to: JobStatus,
    extra?: Partial<JobRecord>,
): Promise<JobRecord | null> {
    const cur = await getJob(jobId);
    if (!cur) return null;
    const now = Date.now();
    const patch: Partial<JobRecord> = { ...extra, status: to };
    if (to === 'running' && !cur.startedAt) patch.startedAt = now;
    if (to === 'succeeded' || to === 'failed' || to === 'cancelled') patch.finishedAt = now;
    if (to === 'retrying') {
        patch.attempt = cur.attempt + 1;
        patch.nextAttemptAt = now + Math.min(60_000, 1000 * 2 ** cur.attempt);
    }
    return updateJob(jobId, patch);
}

export type JobHandler = (job: JobRecord) => Promise<{ ok: true; result?: unknown } | { ok: false; error: string; retry?: boolean }>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
    handlers.set(type, handler);
}

export async function executeJobOnce(jobId: string): Promise<JobRecord | null> {
    const job = await getJob(jobId);
    if (!job) return null;
    if (job.status === 'succeeded' || job.status === 'cancelled') return job;
    if (typeof job.nextAttemptAt === 'number' && job.nextAttemptAt > Date.now()) {
        return job;
    }
    if (job.status !== 'queued' && job.status !== 'retrying' && job.status !== 'running') {
        return job;
    }
    if (job.status !== 'running') {
        const claimed = await transitionJob(jobId, 'running');
        if (!claimed || claimed.status !== 'running') return claimed;
    }
    const handler = handlers.get(job.type);
    if (!handler) {
        return transitionJob(jobId, 'failed', { error: 'NO_HANDLER' });
    }
    try {
        const latest = (await getJob(jobId)) ?? job;
        const out = await handler({ ...latest, status: 'running' });
        if (out.ok) {
            return transitionJob(jobId, 'succeeded', { result: out.result, error: undefined });
        }
        if (out.retry && job.attempt + 1 < job.maxAttempts) {
            return transitionJob(jobId, 'retrying', { error: out.error });
        }
        return transitionJob(jobId, 'failed', { error: out.error });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (job.attempt + 1 < job.maxAttempts) {
            return transitionJob(jobId, 'retrying', { error: msg });
        }
        return transitionJob(jobId, 'failed', { error: msg });
    }
}

const NS_DUE = 'dash_jobs_due';

export async function indexDueJob(jobId: string, runAt: number): Promise<void> {
    await kvSet(NS_DUE, jobId, { jobId, runAt });
}

export async function listDueJobIds(nowMs: number = Date.now()): Promise<string[]> {
    const raw = await kvGet(NS_DUE, '_index');
    const ids = Array.isArray(raw) ? (raw as string[]) : [];
    const due: string[] = [];
    for (const id of ids) {
        const meta = (await kvGet(NS_DUE, id)) as { jobId?: string; runAt?: number } | null;
        if (meta && typeof meta.runAt === 'number' && meta.runAt <= nowMs) {
            due.push(id);
        }
    }
    return due;
}

export async function registerDueIndex(jobId: string, runAt: number): Promise<void> {
    await indexDueJob(jobId, runAt);
    const raw = await kvGet(NS_DUE, '_index');
    const ids = Array.isArray(raw) ? (raw as string[]) : [];
    if (!ids.includes(jobId)) ids.push(jobId);
    await kvSet(NS_DUE, '_index', ids.slice(-500));
}

export async function clearDueIndex(jobId: string): Promise<void> {
    await kvSet(NS_DUE, jobId, null);
    const raw = await kvGet(NS_DUE, '_index');
    const ids = Array.isArray(raw) ? (raw as string[]) : [];
    await kvSet(NS_DUE, '_index', ids.filter((id) => id !== jobId));
}

export async function processDueJobs(nowMs: number = Date.now()): Promise<JobRecord[]> {
    const ids = await listDueJobIds(nowMs);
    const out: JobRecord[] = [];
    for (const id of ids) {
        const job = await getJob(id);
        if (!job) {
            await clearDueIndex(id);
            continue;
        }
        if (job.status === 'succeeded' || job.status === 'cancelled' || job.status === 'failed') {
            await clearDueIndex(id);
            continue;
        }
        const result = await executeJobOnce(id);
        if (result) out.push(result);
        if (result && (result.status === 'succeeded' || result.status === 'failed' || result.status === 'cancelled')) {
            await clearDueIndex(id);
        }
    }
    return out;
}
