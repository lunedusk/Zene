



import { createHash } from 'node:crypto';
import type { RequestContext, ServiceResult } from '../lib/requestContext.js';
import { serviceOk, ServiceError } from '../lib/requestContext.js';
import {
    putOverrideDraft,
    publishOverride,
    schedulePublish,
    cancelScheduledPublish,
    listOverrideVersions,
    restoreOverrideVersion,
    rollbackOverrideVersion,
    getOverride,
    getOverrideByTarget,
    attachPreviewSession,
    clearPreviewSession,
    type OwnerOverrideRecord,
} from '../../../dash-data/src/repositories/ownerOverrideRepository.js';
import { mintPreviewToken, validatePreviewToken, hashPreviewToken } from '../lib/previewToken.js';

function contentHash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

function previewSecret(ctx: RequestContext): string {

    const fromEnv = process.env['DASH_PREVIEW_SECRET'] ?? process.env['BETTER_AUTH_SECRET'];
    if (fromEnv && fromEnv.length >= 16) return fromEnv;
    return `dev-preview-secret-${ctx.actor.userId}`;
}

export class OwnerOverrideService {
    async saveDraft(
        ctx: RequestContext,
        input: {
            targetKind: string;
            targetKey: string;
            payload: unknown;
            changeSummary?: string;
            pluginId?: string;
        },
    ): Promise<ServiceResult<OwnerOverrideRecord>> {
        const rec = await putOverrideDraft({
            targetKind: input.targetKind,
            targetKey: input.targetKey,
            payload: input.payload,
            contentHash: contentHash(input.payload),
            authorUserId: ctx.actor.userId,
            changeSummary: input.changeSummary,
            pluginId: input.pluginId,
        });
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async publish(ctx: RequestContext, overrideId: string): Promise<ServiceResult<OwnerOverrideRecord>> {
        const rec = await publishOverride(overrideId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Override not found', 404);
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async schedule(
        ctx: RequestContext,
        overrideId: string,
        scheduledAt: number,
    ): Promise<ServiceResult<OwnerOverrideRecord & { jobId?: string }>> {
        if (scheduledAt <= Date.now()) {
            throw new ServiceError('VALIDATION', 'scheduledAt must be in the future', 400);
        }
        const rec = await schedulePublish(overrideId, scheduledAt);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Override not found', 404);
        const { enqueueScheduledPublish } = await import('../lib/scheduledPublishHandler.js');
        const job = await enqueueScheduledPublish({
            overrideId,
            scheduledAt,
            actorUserId: ctx.actor.userId,
            expectedVersion: rec.version,
            requestId: ctx.requestId,
            idempotencyKey: `schedule:${overrideId}:${scheduledAt}`,
        });
        return serviceOk({ ...rec, jobId: job.jobId }, { requestId: ctx.requestId, jobId: job.jobId });
    }

    async cancelSchedule(ctx: RequestContext, overrideId: string): Promise<ServiceResult<OwnerOverrideRecord>> {
        const rec = await cancelScheduledPublish(overrideId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Override not found', 404);
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async versions(
        ctx: RequestContext,
        targetKind: string,
        targetKey: string,
    ): Promise<ServiceResult<OwnerOverrideRecord[]>> {
        const list = await listOverrideVersions(targetKind, targetKey);
        return serviceOk(list, { requestId: ctx.requestId });
    }


    async restore(
        ctx: RequestContext,
        targetKind: string,
        targetKey: string,
        version: number,
    ): Promise<ServiceResult<OwnerOverrideRecord>> {
        const rec = await restoreOverrideVersion(targetKind, targetKey, version);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Version not found', 404);
        return serviceOk(rec, { requestId: ctx.requestId });
    }


    async rollback(
        ctx: RequestContext,
        targetKind: string,
        targetKey: string,
        version: number,
    ): Promise<ServiceResult<OwnerOverrideRecord>> {
        const rec = await rollbackOverrideVersion(targetKind, targetKey, version);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Version not found', 404);
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async createPreview(
        ctx: RequestContext,
        overrideId: string,
        ttlSeconds = 900,
    ): Promise<ServiceResult<{ token: string; expiresAt: number; overrideId: string; robots: 'noindex' }>> {
        const existing = await getOverride(overrideId);
        if (!existing) throw new ServiceError('NOT_FOUND', 'Override not found', 404);
        const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
        const { token, tokenHash } = mintPreviewToken(previewSecret(ctx), {
            overrideId,
            targetKind: existing.targetKind,
            targetKey: existing.targetKey,
            authorUserId: ctx.actor.userId,
            exp,
        });
        await attachPreviewSession(overrideId, tokenHash, exp * 1000);
        return serviceOk(
            {
                token,
                expiresAt: exp * 1000,
                overrideId,
                robots: 'noindex' as const,
            },
            { requestId: ctx.requestId },
        );
    }

    async validatePreview(
        ctx: RequestContext,
        token: string,
    ): Promise<ServiceResult<{ claims: unknown; record: OwnerOverrideRecord }>> {
        const v = validatePreviewToken(previewSecret(ctx), token);
        if (!v.ok) {
            if (v.reason === 'expired') throw new ServiceError('FORBIDDEN', 'Preview expired', 403);
            throw new ServiceError('UNAUTHENTICATED', 'Invalid preview token', 401);
        }
        const rec = await getOverride(v.claims.overrideId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Override not found', 404);
        if (rec.previewTokenHash && rec.previewTokenHash !== hashPreviewToken(token)) {
            throw new ServiceError('FORBIDDEN', 'Preview revoked', 403);
        }
        if (rec.previewExpiresAt && rec.previewExpiresAt <= Date.now()) {
            throw new ServiceError('FORBIDDEN', 'Preview expired', 403);
        }
        return serviceOk({ claims: v.claims, record: rec }, { requestId: ctx.requestId });
    }

    async getCurrent(
        ctx: RequestContext,
        targetKind: string,
        targetKey: string,
    ): Promise<ServiceResult<OwnerOverrideRecord | null>> {
        const rec = await getOverrideByTarget(targetKind, targetKey);
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async revokePreview(ctx: RequestContext, overrideId: string): Promise<ServiceResult<OwnerOverrideRecord>> {
        const rec = await clearPreviewSession(overrideId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Override not found', 404);
        return serviceOk(rec, { requestId: ctx.requestId });
    }
}

export const ownerOverrideService = new OwnerOverrideService();
