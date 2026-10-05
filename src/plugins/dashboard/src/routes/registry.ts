import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import {
    applyGateway,
    requireSession,
    requireCapability,
    ensureRequestId,
    type DashRequest,
} from '../lib/authz.js';
import { ok, guarded } from '../lib/http.js';
import {
    buildRegistrySnapshot,
    projectExternalRegistry,
    projectRegistryDiagnostics,
} from '../lib/dashRegistry.js';
import { resolveActorPermissions } from '#core/permissions/capabilities.js';

export default class DashRegistryRoute extends BaseRoute {
    public readonly basePath = '/api/dash';

    /**
     * @openapi
     * /api/dash/registry:
     *   get:
     *     tags: [Dashboard]
     *     summary: Server-resolved external registry (unauthorized surfaces omitted)
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: External registry snapshot }
     * /api/dash/registry/diagnostics:
     *   get:
     *     tags: [Dashboard]
     *     summary: Registry diagnostics (blocked reasons) — capability gated
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Diagnostics }
     *       '403': { description: Forbidden }
     *       '404': { description: Hidden when existence-sensitive }
     */

    protected register(): void {
        applyGateway(this.heart, this.router);
        this.router.get(
            '/registry',
            ensureRequestId,
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.snapshot.bind(this))),
        );
        this.router.get(
            '/registry/diagnostics',
            ensureRequestId,
            requireSession(this.heart),
            requireCapability(this.heart, 'dashboard.registry.diagnostics', { hideExistence: true }),
            this.asyncHandler(guarded(this.heart, this.diagnostics.bind(this))),
        );
    }

    private async snapshot(req: DashRequest, res: Response): Promise<void> {
        const session = req.dashSession!;
        const userId = session.payload.userId;

        const actor = await resolveActorPermissions(userId);
        const data = await buildRegistrySnapshot({
            bits: actor.resolved.bits,
            userId,
            isEnvOwner: actor.isEnvOwner,
        });
        const external = projectExternalRegistry(data);
        ok(res, external, 200, { requestId: req.requestId });
    }

    private async diagnostics(req: DashRequest, res: Response): Promise<void> {
        const session = req.dashSession!;
        const userId = session.payload.userId;
        const actor = await resolveActorPermissions(userId);
        const data = await buildRegistrySnapshot({
            bits: actor.resolved.bits,
            userId,
            isEnvOwner: actor.isEnvOwner,
        });
        ok(res, projectRegistryDiagnostics(data), 200, { requestId: req.requestId });
    }
}
