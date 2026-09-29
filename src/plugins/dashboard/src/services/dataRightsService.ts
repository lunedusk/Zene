/**
 * Phase 2C — Data-rights lifecycle service (approve/process/partial).
 */

import {
    createDataRightsRequest,
    getDataRightsRequest,
    updateDataRightsRequest,
    ensureBuiltinDataRightsProviders,
    listDataRightsProviders,
    type DataRightsRequest,
    type DataRightsKind,
    type DataRightsProviderResult,
} from '../../../dash-data/src/repositories/dataRightsRepository.js';
import type { RequestContext } from '../lib/requestContext.js';
import { ServiceError, serviceOk, type ServiceResult } from '../lib/requestContext.js';
import { publishDashboardEvent } from '../lib/realtime/broker.js';
import { createJob } from '../../../dash-data/src/repositories/jobRepository.js';

const RECOVERABILITY_MS = 14 * 24 * 60 * 60 * 1000;
const RESTRICTED_MS = 7 * 24 * 60 * 60 * 1000;

export class DataRightsService {
    async request(
        ctx: RequestContext,
        input: { kind: DataRightsKind; guildId?: string | null },
    ): Promise<ServiceResult<DataRightsRequest>> {
        if (input.kind !== 'export' && input.kind !== 'deletion') {
            throw new ServiceError('VALIDATION', 'kind must be export|deletion', 400);
        }
        const rec = await createDataRightsRequest({
            userId: ctx.actor.userId,
            kind: input.kind,
            guildId: input.guildId ?? null,
        });
        publishDashboardEvent({
            type: 'data_rights.requested',
            actor: { userId: ctx.actor.userId },
            resource: { type: 'data_rights', id: rec.requestId, guildId: rec.guildId ?? undefined },
            payload: { kind: rec.kind, status: rec.status },
        });
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async get(ctx: RequestContext, requestId: string): Promise<ServiceResult<DataRightsRequest>> {
        const rec = await getDataRightsRequest(requestId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        if (rec.userId !== ctx.actor.userId && !ctx.actor.isEnvOwner && !ctx.actor.resolved.botOwner) {
            throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        }
        return serviceOk(rec, { requestId: ctx.requestId });
    }

    async review(
        ctx: RequestContext,
        requestId: string,
        decision: 'approved' | 'rejected',
    ): Promise<ServiceResult<DataRightsRequest>> {
        if (!ctx.actor.isEnvOwner && !ctx.actor.resolved.botOwner && !ctx.actor.resolved.bits.has('bot.servers.manage')) {
            throw new ServiceError('FORBIDDEN', 'Forbidden', 403);
        }
        const rec = await getDataRightsRequest(requestId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        if (rec.status !== 'pending') {
            throw new ServiceError('CONFLICT', `Cannot review from ${rec.status}`, 409);
        }
        const next = await updateDataRightsRequest(requestId, {
            status: decision,
            reviewerId: ctx.actor.userId,
            reviewedAt: Date.now(),
        });
        if (!next) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        return serviceOk(next, { requestId: ctx.requestId });
    }

    async process(ctx: RequestContext, requestId: string): Promise<ServiceResult<DataRightsRequest>> {
        if (!ctx.actor.isEnvOwner && !ctx.actor.resolved.botOwner) {
            throw new ServiceError('FORBIDDEN', 'Forbidden', 403);
        }
        const rec = await getDataRightsRequest(requestId);
        if (!rec) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        if (rec.status !== 'approved' && rec.status !== 'scheduled') {
            throw new ServiceError('CONFLICT', `Cannot process from ${rec.status}`, 409);
        }
        ensureBuiltinDataRightsProviders();
        await updateDataRightsRequest(requestId, { status: 'processing', startedAt: Date.now() });
        const results: DataRightsProviderResult[] = [];
        for (const p of listDataRightsProviders()) {
            if (!p.supports(rec)) continue;
            try {
                const r =
                    rec.kind === 'deletion'
                        ? await p.deleteEligible(rec)
                        : await (p.exportEligible?.(rec) ?? {
                              providerId: p.providerId,
                              status: 'skipped' as const,
                              detail: 'no_export',
                          });
                results.push(r);
            } catch (e) {
                results.push({
                    providerId: p.providerId,
                    status: 'failed',
                    detail: e instanceof Error ? e.message : String(e),
                });
            }
        }
        const anyFail = results.some((r) => r.status === 'failed');
        const anyOk = results.some((r) => r.status === 'succeeded');
        const now = Date.now();
        let status: DataRightsRequest['status'] = 'completed';
        if (anyFail && anyOk) status = 'partially_completed';
        else if (anyFail && !anyOk) status = 'failed';
        const patch: Partial<DataRightsRequest> = {
            status,
            completedAt: now,
            providerResults: results,
        };
        if (rec.kind === 'deletion' && (status === 'completed' || status === 'partially_completed')) {
            patch.recoverabilityUntil = now + RECOVERABILITY_MS;
            patch.restrictedUntil = now + RECOVERABILITY_MS + RESTRICTED_MS;
        }
        const next = await updateDataRightsRequest(requestId, patch);
        if (!next) throw new ServiceError('NOT_FOUND', 'Not found', 404, undefined, true);
        await createJob({
            type: 'data_rights.retention_followup',
            actorUserId: ctx.actor.userId,
            payload: { requestId, recoverabilityUntil: patch.recoverabilityUntil, restrictedUntil: patch.restrictedUntil },
            resourceKey: requestId,
            requestId: ctx.requestId,
        });
        publishDashboardEvent({
            type: 'data_rights.processed',
            actor: { userId: ctx.actor.userId },
            resource: { type: 'data_rights', id: requestId },
            payload: { status: next.status, providers: results.length },
        });
        return serviceOk(next, { requestId: ctx.requestId });
    }
}
