



import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, requireBody } from '../lib/http.js';
import { isEnvOwnerUser } from '../lib/owner.js';
import { buildRequestContext, ServiceError, unwrapServiceResult } from '../lib/requestContext.js';
import { ownerOverrideService } from '../services/ownerOverrideService.js';
import { ensureScheduledPublishHandlerRegistered } from '../lib/scheduledPublishHandler.js';

function assertEnvOwner(req: DashRequest): void {
    if (!isEnvOwnerUser(req.dashSession!.payload.userId)) {
        throw new HttpError(403, 'forbidden', 'Owner override mutations require env BotOwnerIds');
    }
}

function sendService(_res: Response, err: unknown): void {
    if (err instanceof ServiceError) {
        throw new HttpError(err.httpStatus, err.code.toLowerCase(), err.message);
    }
    throw err;
}

export default class OwnerOverridesRoute extends BaseRoute {
    public readonly basePath = '/api/dash/owner/overrides';

    protected register(): void {
        ensureScheduledPublishHandlerRegistered();
        applyGateway(this.heart, this.router);
        const sess = requireSession(this.heart);

        this.router.post('/draft', sess, this.asyncHandler(guarded(this.heart, this.draft.bind(this))));
        this.router.post('/:overrideId/publish', sess, this.asyncHandler(guarded(this.heart, this.publish.bind(this))));
        this.router.post('/:overrideId/schedule', sess, this.asyncHandler(guarded(this.heart, this.schedule.bind(this))));
        this.router.delete('/:overrideId/schedule', sess, this.asyncHandler(guarded(this.heart, this.cancelSchedule.bind(this))));
        this.router.post('/:overrideId/preview', sess, this.asyncHandler(guarded(this.heart, this.createPreview.bind(this))));
        this.router.delete('/:overrideId/preview', sess, this.asyncHandler(guarded(this.heart, this.revokePreview.bind(this))));
        this.router.get('/preview/validate', this.asyncHandler(guarded(this.heart, this.validatePreview.bind(this))));
        this.router.get('/versions', sess, this.asyncHandler(guarded(this.heart, this.versions.bind(this))));
        this.router.post('/restore', sess, this.asyncHandler(guarded(this.heart, this.restore.bind(this))));
        this.router.post('/rollback', sess, this.asyncHandler(guarded(this.heart, this.rollback.bind(this))));
        this.router.get('/current', sess, this.asyncHandler(guarded(this.heart, this.current.bind(this))));
        this.router.post('/jobs/process-due', sess, this.asyncHandler(guarded(this.heart, this.processDue.bind(this))));
    }

    private async draft(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const body = requireBody<{
            targetKind: string;
            targetKey: string;
            payload: unknown;
            changeSummary?: string;
            pluginId?: string;
        }>(req.body, ['targetKind', 'targetKey', 'payload']);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.saveDraft(ctx, body);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async publish(req: DashRequest<{ overrideId: string }>, res: Response): Promise<void> {
        assertEnvOwner(req);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.publish(ctx, req.params.overrideId);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async schedule(req: DashRequest<{ overrideId: string }>, res: Response): Promise<void> {
        assertEnvOwner(req);
        const body = requireBody<{ scheduledAt: number }>(req.body, ['scheduledAt']);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.schedule(ctx, req.params.overrideId, Number(body.scheduledAt));
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async cancelSchedule(req: DashRequest<{ overrideId: string }>, res: Response): Promise<void> {
        assertEnvOwner(req);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.cancelSchedule(ctx, req.params.overrideId);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async createPreview(req: DashRequest<{ overrideId: string }>, res: Response): Promise<void> {
        assertEnvOwner(req);
        try {
            const ctx = await buildRequestContext(req);
            const ttl = typeof req.body?.ttlSeconds === 'number' ? req.body.ttlSeconds : 900;
            const result = await ownerOverrideService.createPreview(ctx, req.params.overrideId, ttl);

            res.setHeader('X-Robots-Tag', 'noindex, nofollow');
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async revokePreview(req: DashRequest<{ overrideId: string }>, res: Response): Promise<void> {
        assertEnvOwner(req);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.revokePreview(ctx, req.params.overrideId);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async validatePreview(req: DashRequest, res: Response): Promise<void> {
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        if (!token) throw new HttpError(400, 'bad_request', 'token required');
        try {

            if (!req.dashSession) {

                const { validatePreviewToken } = await import('../lib/previewToken.js');
                const secret = process.env['DASH_PREVIEW_SECRET'] ?? process.env['BETTER_AUTH_SECRET'] ?? '';
                if (!secret || secret.length < 16) {
                    throw new HttpError(503, 'misconfigured', 'Preview secret not configured');
                }
                const v = validatePreviewToken(secret, token);
                if (!v.ok) {
                    throw new HttpError(v.reason === 'expired' ? 403 : 401, v.reason, 'Preview invalid');
                }
                ok(res, { claims: v.claims, robots: 'noindex' }, 200, { requestId: req.requestId });
                return;
            }
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.validatePreview(ctx, token);
            res.setHeader('X-Robots-Tag', 'noindex, nofollow');
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async versions(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const targetKind = typeof req.query.targetKind === 'string' ? req.query.targetKind : '';
        const targetKey = typeof req.query.targetKey === 'string' ? req.query.targetKey : '';
        if (!targetKind || !targetKey) throw new HttpError(400, 'bad_request', 'targetKind and targetKey required');
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.versions(ctx, targetKind, targetKey);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async restore(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const body = requireBody<{ targetKind: string; targetKey: string; version: number }>(req.body, [
            'targetKind',
            'targetKey',
            'version',
        ]);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.restore(ctx, body.targetKind, body.targetKey, Number(body.version));
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async rollback(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const body = requireBody<{ targetKind: string; targetKey: string; version: number }>(req.body, [
            'targetKind',
            'targetKey',
            'version',
        ]);
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.rollback(ctx, body.targetKind, body.targetKey, Number(body.version));
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async processDue(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const { runScheduledPublishTick } = await import('../lib/scheduledPublishHandler.js');
        const results = await runScheduledPublishTick();
        ok(res, { processed: results.length, jobs: results.map((j) => ({ jobId: j.jobId, status: j.status })) }, 200, {
            requestId: req.requestId,
        });
    }

    private async current(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const targetKind = typeof req.query.targetKind === 'string' ? req.query.targetKind : '';
        const targetKey = typeof req.query.targetKey === 'string' ? req.query.targetKey : '';
        if (!targetKind || !targetKey) throw new HttpError(400, 'bad_request', 'targetKind and targetKey required');
        try {
            const ctx = await buildRequestContext(req);
            const result = await ownerOverrideService.getCurrent(ctx, targetKind, targetKey);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }
}
