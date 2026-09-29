import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { buildRequestContext, ServiceError } from '../lib/requestContext.js';
import { JobsService } from '../services/jobsService.js';
import { rateLimit } from '../lib/rateLimit/middleware.js';

type JobParams = { jobId: string };

/**
 * @openapi
 * /api/dash/jobs:
 *   post:
 *     tags: [DashboardJobs]
 *     summary: Create a durable job
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type: { type: string }
 *               payload: {}
 *               resourceKey: { type: string }
 *               idempotencyKey: { type: string }
 *               maxAttempts: { type: integer }
 *     responses:
 *       '200': { description: Job created or replayed }
 *       '409': { description: Idempotency conflict }
 *       '429': { description: Rate limited }
 * /api/dash/jobs/{jobId}:
 *   get:
 *     tags: [DashboardJobs]
 *     summary: Get job by id (own or admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Job }
 *       '404': { description: Not found or hidden }
 *   delete:
 *     tags: [DashboardJobs]
 *     summary: Cancel job when state allows
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Cancelled }
 *       '409': { description: Invalid state }
 * /api/dash/jobs/{jobId}/run:
 *   post:
 *     tags: [DashboardJobs]
 *     summary: Execute job once (owner/admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Job after execution }
 *       '403': { description: Forbidden }
 */
export default class JobsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/jobs';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const auth = requireSession(this.heart);

        this.router.post(
            '/',
            auth,
            rateLimit('mutation'),
            this.asyncHandler(guarded(this.heart, this.create.bind(this))),
        );
        this.router.get(
            '/:jobId',
            auth,
            rateLimit('authenticated_read'),
            this.asyncHandler(guarded(this.heart, this.get.bind(this))),
        );
        this.router.delete(
            '/:jobId',
            auth,
            rateLimit('mutation'),
            this.asyncHandler(guarded(this.heart, this.cancel.bind(this))),
        );
        this.router.post(
            '/:jobId/run',
            auth,
            rateLimit('administrative'),
            this.asyncHandler(guarded(this.heart, this.run.bind(this))),
        );
    }

    private svc(): JobsService {
        return new JobsService();
    }

    private async create(req: DashRequest, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const headerKey = req.headers['idempotency-key'];
        const idempotencyKey =
            typeof body.idempotencyKey === 'string'
                ? body.idempotencyKey
                : typeof headerKey === 'string'
                  ? headerKey
                  : undefined;
        try {
            const result = await this.svc().create(ctx, {
                type: String(body.type ?? ''),
                payload: body.payload,
                resourceKey: typeof body.resourceKey === 'string' ? body.resourceKey : undefined,
                idempotencyKey,
                maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
            });
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId, ...(result.meta ?? {}) });
        } catch (e) {
            throw mapServiceError(e);
        }
    }

    private async get(req: DashRequest<JobParams>, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        try {
            const result = await this.svc().get(ctx, req.params.jobId);
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            throw mapServiceError(e);
        }
    }

    private async cancel(req: DashRequest<JobParams>, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        try {
            const result = await this.svc().cancel(ctx, req.params.jobId);
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            throw mapServiceError(e);
        }
    }

    private async run(req: DashRequest<JobParams>, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        try {
            const result = await this.svc().runOnce(ctx, req.params.jobId);
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
