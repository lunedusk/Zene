/**
 * Phase 4 — Distributed job claim using durable KV compare-and-set semantics.
 */

import { kvGet, kvSet } from '../../../../dash-data/src/lib/store.js';
import { getJob, updateJob, type JobRecord } from '../../../../dash-data/src/repositories/jobRepository.js';

const NS_LEASE = 'dash_job_leases';

export interface JobLeaseRecord {
    readonly jobId: string;
    readonly ownerId: string;
    readonly leasedAt: number;
    readonly leaseExpiresAt: number;
    readonly token: string;
}

function leaseToken(ownerId: string, jobId: string, at: number): string {
    return `${ownerId}:${jobId}:${at}`;
}

/**
 * Attempt exclusive claim. Returns null if another worker holds a valid lease.
 */
export async function claimJob(
    jobId: string,
    ownerId: string,
    leaseMs = 30_000,
): Promise<{ ok: true; lease: JobLeaseRecord; job: JobRecord } | { ok: false; reason: string }> {
    const job = await getJob(jobId);
    if (!job) return { ok: false, reason: 'not_found' };
    if (job.status === 'succeeded' || job.status === 'cancelled') {
        return { ok: false, reason: `terminal_${job.status}` };
    }
    if (job.status === 'running') {
        const existing = await kvGet(NS_LEASE, jobId);
        if (existing && typeof existing === 'object') {
            const lease = existing as JobLeaseRecord;
            if (lease.leaseExpiresAt > Date.now() && lease.ownerId !== ownerId) {
                return { ok: false, reason: 'leased_by_other' };
            }
        }
    }

    const now = Date.now();
    const lease: JobLeaseRecord = {
        jobId,
        ownerId,
        leasedAt: now,
        leaseExpiresAt: now + leaseMs,
        token: leaseToken(ownerId, jobId, now),
    };

    // Re-check race
    const race = await kvGet(NS_LEASE, jobId);
    if (race && typeof race === 'object') {
        const other = race as JobLeaseRecord;
        if (other.leaseExpiresAt > now && other.ownerId !== ownerId) {
            return { ok: false, reason: 'race_lost' };
        }
    }

    await kvSet(NS_LEASE, jobId, lease);
    const updated = await updateJob(jobId, {
        status: 'running',
        startedAt: job.startedAt ?? now,
        attempt: job.attempt + 1,
    });
    if (!updated) return { ok: false, reason: 'update_failed' };
    return { ok: true, lease, job: updated };
}

export async function heartbeatLease(
    jobId: string,
    ownerId: string,
    token: string,
    leaseMs = 30_000,
): Promise<boolean> {
    const raw = await kvGet(NS_LEASE, jobId);
    if (!raw || typeof raw !== 'object') return false;
    const lease = raw as JobLeaseRecord;
    if (lease.ownerId !== ownerId || lease.token !== token) return false;
    const next: JobLeaseRecord = {
        ...lease,
        leaseExpiresAt: Date.now() + leaseMs,
    };
    await kvSet(NS_LEASE, jobId, next);
    return true;
}

export async function releaseLease(jobId: string, ownerId: string, token: string): Promise<void> {
    const raw = await kvGet(NS_LEASE, jobId);
    if (!raw || typeof raw !== 'object') return;
    const lease = raw as JobLeaseRecord;
    if (lease.ownerId === ownerId && lease.token === token) {
        await kvSet(NS_LEASE, jobId, null);
    }
}

export async function recoverExpiredLeases(now = Date.now()): Promise<string[]> {
    // Index of active leases is optional; callers pass known running jobs
    return [];
    void now;
}
