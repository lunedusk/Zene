import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { buildRequestContext, ServiceError } from '../lib/requestContext.js';
import { SearchService } from '../services/searchService.js';
import { rateLimit } from '../lib/rateLimit/middleware.js';
import type { SearchResultKind } from '../lib/search/searchAuthz.js';

/**
 * @openapi
 * /api/dash/search:
 *   get:
 *     tags: [DashboardSearch]
 *     summary: Authenticated Dashboard search
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50 }
 *       - in: query
 *         name: kinds
 *         schema: { type: string, description: Comma-separated result kinds }
 *     responses:
 *       '200':
 *         description: Authorized results only
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       kind: { type: string }
 *                       title: { type: string }
 *                       snippet: { type: string }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       '429': { description: Rate limited }
 */
export default class SearchRoute extends BaseRoute {
    public readonly basePath = '/api/dash/search';

    protected register(): void {
        applyGateway(this.heart, this.router);
        const auth = requireSession(this.heart);
        this.router.get(
            '/',
            auth,
            rateLimit('authenticated_read'),
            this.asyncHandler(guarded(this.heart, this.search.bind(this))),
        );
    }

    private async search(req: DashRequest, res: Response): Promise<void> {
        const ctx = await buildRequestContext(req);
        const q = typeof req.query.q === 'string' ? req.query.q : '';
        const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
        const kindsRaw = typeof req.query.kinds === 'string' ? req.query.kinds : '';
        const kinds = kindsRaw
            ? (kindsRaw.split(',').map((s) => s.trim()).filter(Boolean) as SearchResultKind[])
            : undefined;
        try {
            const result = await new SearchService().search(ctx, { q, page, limit, kinds });
            if (!result.ok) throw result.error;
            ok(res, result.data, 200, { requestId: ctx.requestId });
        } catch (e) {
            if (e instanceof ServiceError) {
                throw new HttpError(e.hideExistence ? 404 : e.httpStatus, e.code.toLowerCase(), e.message, e.details);
            }
            throw e;
        }
    }
}
