/**
 * Durable scheduled owner-override publication — registers on JobsService path.
 */

import {
    registerJobHandler,
    createJob,
    registerDueIndex,
    processDueJobs,
    type JobRecord,
} from '../../../dash-data/src/repositories/jobRepository.js';
import { publishOverride, getOverride } from '../../../dash-data/src/repositories/ownerOverrideRepository.js';
import { publishDashboardEvent } from './realtime/broker.js';

export const OWNER_PUBLISH_JOB_TYPE = 'owner.override.publish' as const;

let registered = false;

export function ensureScheduledPublishHandlerRegistered(): void {
    if (registered) return;
    registered = true;
    registerJobHandler(OWNER_PUBLISH_JOB_TYPE, async (job: JobRecord) => {
        const payload = (job.payload ?? {}) as {
            overrideId?: string;
            expectedVersion?: number;
        };
        const overrideId = payload.overrideId;
        if (!overrideId || typeof overrideId !== 'string') {
            return { ok: false as const, error: 'missing_overrideId', retry: false };
        }
        const current = await getOverride(overrideId);
        if (!current) {
            return { ok: false as const, error: 'override_not_found', retry: false };
        }
        // Idempotent: already published at/after expected version
        if (
            typeof payload.expectedVersion === 'number' &&
            current.state === 'published' &&
            current.version > payload.expectedVersion
        ) {
            return { ok: true as const, result: { overrideId, version: current.version, idempotent: true } };
        }
        if (current.state === 'published' && current.version > (payload.expectedVersion ?? 0)) {
            return { ok: true as const, result: { overrideId, version: current.version, idempotent: true } };
        }
        const published = await publishOverride(overrideId);
        if (!published) {
            return { ok: false as const, error: 'publish_failed', retry: true };
        }
        publishDashboardEvent({
            type: 'publication.updated',
            resource: { type: 'override', id: overrideId },
            payload: { version: published.version, state: published.state },
        });
        return { ok: true as const, result: { overrideId, version: published.version } };
    });
}

/**
 * Enqueue durable scheduled publish. Survives process restart via job store + due index.
 */
export async function enqueueScheduledPublish(input: {
    overrideId: string;
    scheduledAt: number;
    actorUserId: string;
    expectedVersion?: number;
    requestId?: string;
    idempotencyKey?: string;
}): Promise<JobRecord> {
    ensureScheduledPublishHandlerRegistered();
    const job = await createJob({
        type: OWNER_PUBLISH_JOB_TYPE,
        actorUserId: input.actorUserId,
        payload: {
            overrideId: input.overrideId,
            expectedVersion: input.expectedVersion,
            scheduledAt: input.scheduledAt,
        },
        resourceKey: `override:${input.overrideId}`,
        idempotencyKey: input.idempotencyKey ?? `schedule:${input.overrideId}:${input.scheduledAt}`,
        requestId: input.requestId,
        maxAttempts: 5,
    });
    // Defer until scheduledAt
    const { updateJob } = await import('../../../dash-data/src/repositories/jobRepository.js');
    await updateJob(job.jobId, { nextAttemptAt: input.scheduledAt, status: 'queued' });
    await registerDueIndex(job.jobId, input.scheduledAt);
    return { ...job, nextAttemptAt: input.scheduledAt };
}

/** Worker tick — call from existing job poller / heartbeat. */
export async function runScheduledPublishTick(): Promise<JobRecord[]> {
    ensureScheduledPublishHandlerRegistered();
    return processDueJobs(Date.now());
}
