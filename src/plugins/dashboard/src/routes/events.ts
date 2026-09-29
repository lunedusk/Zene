import { randomBytes } from 'node:crypto';
import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { guarded, HttpError, err } from '../lib/http.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';
import { isBotOwnerFromBits } from '../lib/owner.js';
import type { Bit } from '#core/manager/token.js';
import { tryTokens } from '../lib/tokens.js';
import { ensureDashEventWiring, addSseClient } from '../lib/dashEvents.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DashEventsRoute');

export default class DashEventsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/events';

    
    /**
     * @openapi
     * /api/dash/events/sse:
     *   get:
     *     tags: [DashboardEvents]
     *     summary: Server-sent events stream
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: text/event-stream }
     * /api/dash/events/ws:
     *   get:
     *     tags: [DashboardEvents]
     *     summary: WebSocket upgrade endpoint metadata
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Upgrade or info }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        ensureDashEventWiring();

        this.router.get(
            '/sse',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.sse.bind(this))),
        );

        this.router.get('/ws', requireSession(this.heart), (req: DashRequest, res: Response) => {
            err(
                res,
                501,
                'ws_deferred',
                'WebSocket transport is deferred to a follow-up slice (Next BFF upgrade auth). Use GET /api/dash/events/sse for registry hot-reload.',
            );
        });
    }

    private async sse(req: DashRequest, res: Response): Promise<void> {
        const session = req.dashSession;
        if (!session) {
            throw new HttpError(401, 'unauthorized', 'session required');
        }

        // Prefer PermissionsManager resolve for delivery filter; fall back to token bits.
        let bits: Set<string>;
        let isEnvOwner: boolean;
        try {
            const { resolveActorPermissions } = await import('#core/permissions/capabilities.js');
            const actor = await resolveActorPermissions(session.payload.userId);
            bits = new Set(actor.resolved.bits);
            isEnvOwner = actor.isEnvOwner;
            if (actor.resolved.botOwner) bits.add(BOT_OWNER_BIT);
        } catch {
            bits = new Set<string>((session.payload.bits ?? []).map(String));
            const t = tryTokens(this.heart);
            if (t?.hasBit(session, BOT_OWNER_BIT as Bit)) bits.add(BOT_OWNER_BIT);
            isEnvOwner = isBotOwnerFromBits(session.payload.userId, bits);
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        const id = randomBytes(12).toString('hex');
        const remove = addSseClient({
            id,
            res,
            userId: session.payload.userId,
            bits,
            isEnvOwner,
        });

        log.debug(`SSE client ${id} connected user=${session.payload.userId}`);

        const onClose = () => {
            remove();
            log.debug(`SSE client ${id} disconnected`);
        };
        req.on('close', onClose);
        res.on('close', onClose);

        await new Promise<void>((resolve) => {
            req.on('close', () => resolve());
            res.on('close', () => resolve());
        });
    }
}
