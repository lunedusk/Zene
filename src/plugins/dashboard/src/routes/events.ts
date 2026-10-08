import { randomBytes } from 'node:crypto';
import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { guarded, HttpError, err } from '../lib/http.js';
import { ensureDashEventWiring, addSseClient } from '../lib/dashEvents.js';
import { getLogger } from '#core/utils/logger.js';
import {
    getDashboardSessionRecord,
    establishRealtimeConnection,
    closeRealtimeConnection,
    DashboardRealtimeError,
} from '#core/dashboard/index.js';

const log = getLogger('DashEventsRoute');

export default class DashEventsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/events';

    /**
     * @openapi
     * /api/dash/events/sse:
     *   get:
     *     tags: [DashboardEvents]
     *     summary: Server-sent events stream (Core-session authorized)
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
                'WebSocket transport is deferred. Use GET /api/dash/events/sse.',
            );
        });
    }

    private async sse(req: DashRequest, res: Response): Promise<void> {
        const coreSessionId = req.coreSessionId;
        if (!coreSessionId) {
            throw new HttpError(401, 'core_session_required', 'Core dashboard session required');
        }
        const core = getDashboardSessionRecord(coreSessionId);
        if (!core || core.revoked) {
            throw new HttpError(401, 'unauthorized', 'session required');
        }

        const pluginId =
            typeof req.query.pluginId === 'string' ? req.query.pluginId : undefined;
        const contributionId =
            typeof req.query.contributionId === 'string'
                ? req.query.contributionId
                : undefined;
        const guildId =
            typeof req.query.guildId === 'string' ? req.query.guildId : undefined;

        let realtimeConn;
        try {
            realtimeConn = establishRealtimeConnection({
                sessionId: coreSessionId,
                contributionPluginId: pluginId,
                contributionId,
                requestedGuildId: guildId,
                clientClaims: {
                    // Intentionally ignore client authority headers for stream auth
                },
            });
        } catch (e) {
            if (e instanceof DashboardRealtimeError) {
                const status =
                    e.code === 'unauthenticated' ||
                    e.code === 'session_expired' ||
                    e.code === 'session_revoked'
                        ? 401
                        : 403;
                throw new HttpError(status, e.code, e.message);
            }
            throw e;
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('X-Zene-Realtime-Connection', realtimeConn.connectionId);
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        const bits = new Set(core.principal.bits);
        const remove = addSseClient({
            id: realtimeConn.connectionId,
            res,
            userId: core.principal.userId,
            bits,
            isEnvOwner: core.principal.isEnvOwner,
        });

        log.debug(
            `SSE client ${realtimeConn.connectionId} connected user=${core.principal.userId} coreSession`,
        );

        const onClose = () => {
            remove();
            closeRealtimeConnection(realtimeConn.connectionId);
            log.debug(`SSE client ${realtimeConn.connectionId} disconnected`);
        };
        req.on('close', onClose);
        res.on('close', onClose);

        await new Promise<void>((resolve) => {
            req.on('close', () => resolve());
            res.on('close', () => resolve());
        });
    }
}
