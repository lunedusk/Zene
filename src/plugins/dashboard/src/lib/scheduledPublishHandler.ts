import {
    registerJobHandler,
    createJob,
    registerDueIndex,
    processDueJobs,
    type JobRecord,
} from '../../../dash-data/src/repositories/jobRepository.js';
import {
    publishOverride,
    getOverride,
    hashOwnerOverridePayload,
    OwnerOverrideIntegrityError,
} from '../../../dash-data/src/repositories/ownerOverrideRepository.js';
import { publishDashboardEvent } from './realtime/broker.js';
import {
    describeCompositionIssues,
    isCompositionPayload,
    validateCompositionPayload,
} from './compositionValidation.js';

export const OWNER_PUBLISH_JOB_TYPE = 'owner.override.publish' as const;

/** Job payload fields that bind a scheduled publish to exact content identity. */
export interface ScheduledPublishJobPayload {
    overrideId?: string;
    expectedVersion?: number;
    expectedRevision?: number;
    expectedContentHash?: string;
    scheduledAt?: number;
}

let registered = false;

/** Core scheduled-publish job body (exported for tests). */
export async function executeScheduledPublishJob(
    job: JobRecord,
): Promise<{ ok: true; result?: unknown } | { ok: false; error: string; retry?: boolean }> {
    const payload = (job.payload ?? {}) as ScheduledPublishJobPayload;
    const overrideId = payload.overrideId;
    if (!overrideId || typeof overrideId !== 'string') {
        return { ok: false as const, error: 'missing_overrideId', retry: false };
    }
    const current = await getOverride(overrideId);
    if (!current) {
        return { ok: false as const, error: 'override_not_found', retry: false };
    }

    // Idempotent: already published past the version that was scheduled.
    if (
        current.state === 'published' &&
        typeof payload.expectedVersion === 'number' &&
        current.version > payload.expectedVersion
    ) {
        return { ok: true as const, result: { overrideId, version: current.version, idempotent: true } };
    }

    // Must still be the scheduled record — draft saves reset state to 'draft'.
    if (current.state !== 'scheduled') {
        return { ok: false as const, error: 'schedule_not_active', retry: false };
    }

    // Content identity captured at schedule time must still match.
    if (
        typeof payload.expectedContentHash === 'string' &&
        current.contentHash !== payload.expectedContentHash
    ) {
        return { ok: false as const, error: 'schedule_content_changed', retry: false };
    }
    if (
        typeof payload.expectedRevision === 'number' &&
        current.revision !== payload.expectedRevision
    ) {
        return { ok: false as const, error: 'schedule_revision_changed', retry: false };
    }

    // Integrity: stored hash must match payload bytes.
    try {
        if (hashOwnerOverridePayload(current.payload) !== current.contentHash) {
            return { ok: false as const, error: 'payload_integrity_mismatch', retry: false };
        }
    } catch {
        return { ok: false as const, error: 'payload_integrity_mismatch', retry: false };
    }

    if (isCompositionPayload(current.payload)) {
        const validation = validateCompositionPayload(current.payload);
        if (!validation.ok) {
            return {
                ok: false as const,
                error: `invalid_composition:${describeCompositionIssues(validation)}`,
                retry: false,
            };
        }
    }

    let published;
    try {
        published = await publishOverride(overrideId, current.contentHash);
    } catch (e) {
        if (e instanceof OwnerOverrideIntegrityError) {
            return { ok: false as const, error: 'payload_integrity_mismatch', retry: false };
        }
        return { ok: false as const, error: 'publish_failed', retry: true };
    }
    if (!published) {
        return { ok: false as const, error: 'publish_failed', retry: true };
    }
    publishDashboardEvent({
        type: 'publication.updated',
        resource: { type: 'override', id: overrideId },
        payload: { version: published.version, state: published.state },
    });
    return { ok: true as const, result: { overrideId, version: published.version } };
}

export function ensureScheduledPublishHandlerRegistered(): void {
    if (registered) return;
    registered = true;
    registerJobHandler(OWNER_PUBLISH_JOB_TYPE, executeScheduledPublishJob);
}

export async function enqueueScheduledPublish(input: {
    overrideId: string;
    scheduledAt: number;
    actorUserId: string;
    expectedVersion?: number;
    expectedRevision?: number;
    expectedContentHash?: string;
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
            expectedRevision: input.expectedRevision,
            expectedContentHash: input.expectedContentHash,
            scheduledAt: input.scheduledAt,
        } satisfies ScheduledPublishJobPayload,
        resourceKey: `override:${input.overrideId}`,
        idempotencyKey:
            input.idempotencyKey ??
            `schedule:${input.overrideId}:${input.scheduledAt}:${input.expectedContentHash ?? ''}`,
        requestId: input.requestId,
        maxAttempts: 5,
    });

    const { updateJob } = await import('../../../dash-data/src/repositories/jobRepository.js');
    await updateJob(job.jobId, { nextAttemptAt: input.scheduledAt, status: 'queued' });
    await registerDueIndex(job.jobId, input.scheduledAt);
    return { ...job, nextAttemptAt: input.scheduledAt };
}

export async function runScheduledPublishTick(): Promise<JobRecord[]> {
    ensureScheduledPublishHandlerRegistered();
    return processDueJobs(Date.now());
}
