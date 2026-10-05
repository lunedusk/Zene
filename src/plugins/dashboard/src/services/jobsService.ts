



import {
    createJob,
    getJob,
    transitionJob,
    executeJobOnce,
    type JobRecord,
    type JobStatus,
} from '../../../dash-data/src/repositories/jobRepository.js';
import type { RequestContext } from '../lib/requestContext.js';
import { ServiceError, serviceOk, type ServiceResult } from '../lib/requestContext.js';
import {
    durableIdempotencyLookup,
    durableIdempotencyStore,
    hashRequestPayload,
} from '../lib/durableIdempotency.js';
import { publishDashboardEvent } from '../lib/realtime/broker.js';

const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
    queued: ['running', 'cancelled'],
    running: ['succeeded', 'failed', 'retrying', 'cancelled'],
    retrying: ['running', 'cancelled', 'failed'],
    succeeded: [],
    failed: ['queued'],
    cancelled: [],
};

export class JobsService {
    async create(
        ctx: RequestContext,
        input: {
            type: string;
            payload?: unknown;
            resourceKey?: string;
            idempotencyKey?: string;
            maxAttempts?: number;
        },
    ): Promise<ServiceResult<JobRecord>> {
        if (!input.type || typeof input.type !== 'string') {
            throw new ServiceError('VALIDATION', 'type required', 400);
        }
        const requestHash = hashRequestPayload({ type: input.type, payload: input.payload, resourceKey: input.resourceKey });
        if (input.idempotencyKey) {
            const look = await durableIdempotencyLookup({
                actorId: ctx.actor.userId,
                operation: `job.create:${input.type}`,
                resourceKey: input.resourceKey ?? 'global',
                idempotencyKey: input.idempotencyKey,
                requestHash,
            });
            if (look.status === 'conflict') {
                throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict', 409);
            }
            if (look.status === 'replay' && look.record.result) {
                return serviceOk(look.record.result as JobRecord, { requestId: ctx.requestId, replay: true });
            }
        }
        const job = await createJob({
            type: input.type,
            actorUserId: ctx.actor.userId,
            payload: input.payload,
            resourceKey: input.resourceKey,
            idempotencyKey: input.idempotencyKey,
            requestId: ctx.requestId,
            maxAttempts: input.maxAttempts,
        });
        if (input.idempotencyKey) {
            await durableIdempotencyStore({
                actorId: ctx.actor.userId,
                operation: `job.create:${input.type}`,
                resourceKey: input.resourceKey ?? 'global',
                idempotencyKey: input.idempotencyKey,
                requestHash,
                result: job,
                jobId: job.jobId,
            });
        }
        publishDashboardEvent({
            type: 'job.created',
            actor: { userId: ctx.actor.userId },
            resource: { type: 'job', id: job.jobId },
            payload: { jobId: job.jobId, type: job.type, status: job.status },
        });
        return serviceOk(job, { requestId: ctx.requestId });
    }

    async get(ctx: RequestContext, jobId: string): Promise<ServiceResult<JobRecord>> {
        const job = await getJob(jobId);
        if (!job) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        if (job.actorUserId !== ctx.actor.userId && !ctx.actor.isEnvOwner && !ctx.actor.resolved.botOwner) {
            throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        }
        return serviceOk(job, { requestId: ctx.requestId });
    }

    async cancel(ctx: RequestContext, jobId: string): Promise<ServiceResult<JobRecord>> {
        const job = await getJob(jobId);
        if (!job) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        if (job.actorUserId !== ctx.actor.userId && !ctx.actor.isEnvOwner) {
            throw new ServiceError('FORBIDDEN', 'Forbidden', 403);
        }
        const allowed = ALLOWED_TRANSITIONS[job.status];
        if (!allowed.includes('cancelled')) {
            throw new ServiceError('CONFLICT', `Cannot cancel from ${job.status}`, 409);
        }
        const next = await transitionJob(jobId, 'cancelled');
        if (!next) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        publishDashboardEvent({
            type: 'job.cancelled',
            actor: { userId: ctx.actor.userId },
            resource: { type: 'job', id: jobId },
            payload: { jobId, status: next.status },
        });
        return serviceOk(next, { requestId: ctx.requestId });
    }


    async runOnce(ctx: RequestContext, jobId: string): Promise<ServiceResult<JobRecord>> {
        if (!ctx.actor.isEnvOwner && !ctx.actor.resolved.botOwner) {
            throw new ServiceError('FORBIDDEN', 'Forbidden', 403);
        }
        const next = await executeJobOnce(jobId);
        if (!next) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        return serviceOk(next, { requestId: ctx.requestId });
    }
}
