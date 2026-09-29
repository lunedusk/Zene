import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { buildRequestContext, ServiceError } from '../lib/requestContext.js';
import { DataRightsService } from '../services/dataRightsService.js';
import { rateLimit } from '../lib/rateLimit/middleware.js';

type DrParams = { requestId: string };

/**
 * @openapi
 * /api/dash/data-rights:
 *   post:
 *     tags: [DashboardDataRights]
 *     summary: Create data export or deletion request
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind]
 *             properties:
 *               kind: { type: string, enum: [export, deletion] }
 *               guildId: { type: string, nullable: true }
 *     responses:
 *       '200': { description: Request created }
 *       '429': { description: Rate limited }
 * /api/dash/data-rights/{requestId}:
 *   get:
 *     tags: [DashboardDataRights]
 *     summary: Get own data-rights request
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Request }
 *       '404': { description: Not found or hidden }
 * /api/dash/data-rights/{requestId}/review:
 *   post:
 *     tags: [DashboardDataRights]
 *     summary: Approve or reject pending request
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [approved, rejected] }
 *     responses:
 *       '200': { description: Reviewed }
 *       '403': { description: Forbidden }
 * /api/dash/data-rights/{requestId}/process:
 *   post:
 *     tags: [DashboardDataRights]
 *     summary: Process approved request through providers
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Processed (may be partial) }
 */
export default class DataRightsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/data-rights';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const auth = requireSession(this.heart);

        this.router.post(
            '/',
            auth,
            rateLimit('data_deletion'),
            this.asyncHandler(guarded(this.heart, this.create.bind(this))),
        );
        this.router.get(
            '/:requestId',
            auth,
            rateLimit('authenticated_read'),
            this.asyncHandler(guarded(this.heart, this.get.bind(this))),
        );
        this.router.post(
            '/:requestId/review',
            auth,
            rateLimit('sensitive_mutation'),
            this.asyncHandler(guarded(this.heart, this.review.bind(this))),
        );
        this.router.post(
            '/:requestId/process',
            auth,
            rateLimit('administrative'),
            this.asyncHandler(guarded(this.heart, this.process.bind(this))),
        );
    }

    private svc(): DataRightsService {
        return new DataRightsService();
    }

    private async create(req: DashRequest, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const kind = body.kind === 'export' || body.kind === 'deletion' ? body.kind : '';
        try {
            const result = await this.svc().request(ctx, {
                kind: kind as 'export' | 'deletion',
                guildId: body.guildId === null || typeof body.guildId === 'string' ? (body.guildId as string | null) : undefined,
            });
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            throw mapServiceError(e);
        }
    }

    private async get(req: DashRequest<DrParams>, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        try {
            const result = await this.svc().get(ctx, req.params.requestId);
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            throw mapServiceError(e);
        }
    }

    private async review(req: DashRequest<DrParams>, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null;
        if (!decision) throw new HttpError(400, 'validation_failed', 'decision must be approved|rejected');
        try {
            const result = await this.svc().review(ctx, req.params.requestId, decision);
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            throw mapServiceError(e);
        }
    }

    private async process(req: DashRequest<DrParams>, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        try {
            const result = await this.svc().process(ctx, req.params.requestId);
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            throw mapServiceError(e);
        }
    }
}

function mapServiceError(e: unknown): Error {
    if (e instanceof ServiceError) {
        return new HttpError(e.hideExistence ? 404 : e.httpStatus, e.code.toLowerCase(), e.message, e.details);
    }
    return e instanceof Error ? e : new Error(String(e));
}
