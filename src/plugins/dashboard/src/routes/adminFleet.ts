import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedAnyBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, requireBody } from '../lib/http.js';
import { BITS } from '../lib/bits.js';
import { writeAudit } from '../lib/db.js';
import { resolveActorPermissions } from '#core/permissions/capabilities.js';

export default class AdminFleetRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/fleet';


    /**
     * @openapi
     * /api/dash/admin/fleet/status:
     *   get:
     *     tags: [DashboardFleet]
     *     summary: Fleet status
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Status }
     * /api/dash/admin/fleet/shards:
     *   get:
     *     tags: [DashboardFleet]
     *     summary: Shard map
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Shards }
     * /api/dash/admin/fleet/restart:
     *   post:
     *     tags: [DashboardFleet]
     *     summary: Fleet restart
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '202': { description: Accepted }
     * /api/dash/admin/fleet/shard-shift:
     *   post:
     *     tags: [DashboardFleet]
     *     summary: Manual shard shift
     *     security: [{ bearerAuth: [] }]
     *     requestBody:
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *     responses:
     *       '200': { description: Shift result }
     * /api/dash/admin/fleet/moderation-actions:
     *   get:
     *     tags: [DashboardFleet]
     *     summary: List moderation handler actions
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Actions }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const view = requireAuthedAnyBit(this.heart, [
            BITS.BOT_FLEET_VIEW,
            BITS.BOT_SHARD_VIEW,
            BITS.BOT_CROSSHOST_VIEW,
        ]);

        const fleetRestart = requireAuthedAnyBit(this.heart, [
            BITS.BOT_FLEET_RESTART,
            BITS.BOT_CROSSHOST_MANAGE,
        ]);
        const workerRestart = requireAuthedAnyBit(this.heart, [
            BITS.BOT_WORKER_RESTART,
            BITS.BOT_CROSSHOST_MANAGE,
        ]);
        const shardShift = requireAuthedAnyBit(this.heart, [
            BITS.BOT_SHARD_SHIFT,
            BITS.BOT_CROSSHOST_MANAGE,
        ]);

        this.router.get(
            '/status',
            ...view,
            this.asyncHandler(guarded(this.heart, this.status.bind(this))),
        );
        this.router.get(
            '/shards',
            ...view,
            this.asyncHandler(guarded(this.heart, this.shards.bind(this))),
        );
        this.router.post(
            '/restart',


            ...requireAuthedAnyBit(this.heart, [
                BITS.BOT_FLEET_RESTART,
                BITS.BOT_WORKER_RESTART,
                BITS.BOT_CROSSHOST_MANAGE,
            ]),
            this.asyncHandler(guarded(this.heart, this.restart.bind(this))),
        );
        this.router.post(
            '/shard-shift',
            ...shardShift,
            this.asyncHandler(guarded(this.heart, this.shardShift.bind(this))),
        );
        void fleetRestart;
        void workerRestart;

        const logs = requireAuthedAnyBit(this.heart, [
            BITS.BOT_LOGS_VIEW,
            BITS.BOT_MEMBERS_VIEW,
            BITS.BOT_AUDIT_VIEW,
        ]);
        this.router.get(
            '/moderation-actions',
            ...logs,
            this.asyncHandler(guarded(this.heart, this.moderationActions.bind(this))),
        );
    }

    private async status(req: DashRequest, res: Response): Promise<void> {
        const c = this.heart.control;
        const client = this.heart.client;
        const body = {
            mode: c.isCrossHost()
                ? 'crosshost'
                : client.shard
                  ? 'sharded'
                  : 'standalone',
            crossHost: c.isCrossHost(),
            role: c.role(),
            machineId: c.machineId(),
            shards: [...c.shards()],
            pid: c.pid(),
            uptimeMs: c.uptimeMs(),
            nodeVersion: c.nodeVersion(),
            guilds: client.guilds.cache.size,
            peers: c.isCrossHost() ? [...this.heart.crossHost.peers()] : [],
        };
        ok(res, body);
    }

    private async shards(req: DashRequest, res: Response): Promise<void> {
        if (!this.heart.control.isCrossHost()) {
            ok(res, {
                crossHost: false,
                totalShards: this.heart.client.shard?.count ?? 1,
                localShards: this.heart.control.shards(),
                dump: null,
            });
            return;
        }
        try {
            const { fetchClusterShards, isClusterClientReady } = await import(
                '#core/crosshost/worker/clusterClient.js'
            );
            if (!isClusterClientReady()) {
                throw new HttpError(503, 'fleet_unreachable', 'Cluster client not authenticated');
            }
            const dump = await fetchClusterShards();
            ok(res, { crossHost: true, dump });
        } catch (err: unknown) {
            if (err instanceof HttpError) throw err;
            const message = err instanceof Error ? err.message : String(err);
            throw new HttpError(503, 'fleet_unreachable', message);
        }
    }

    private async restart(req: DashRequest, res: Response): Promise<void> {
        if (!this.heart.control.isCrossHost()) {
            throw new HttpError(400, 'not_available_here', 'Fleet restart requires Cross-Host');
        }
        const body = (req.body ?? {}) as { scope?: string; machineId?: string; reason?: string };
        const actor = await resolveActorPermissions(req.dashSession!.payload.userId);
        const bits = actor.resolved.bits;
        const isOwner = actor.resolved.botOwner || bits.has('bot.owner');
        const scopeHint = body.scope === 'worker' ? 'worker' : 'fleet';
        if (scopeHint === 'worker') {
            if (!isOwner && !bits.has(BITS.BOT_WORKER_RESTART) && !bits.has(BITS.BOT_CROSSHOST_MANAGE)) {
                throw new HttpError(403, 'forbidden', 'worker restart requires bot.worker.restart');
            }
            const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : '';
            if (!machineId) {
                throw new HttpError(400, 'bad_request', 'machineId required for worker restart');
            }

        } else if (!isOwner && !bits.has(BITS.BOT_FLEET_RESTART) && !bits.has(BITS.BOT_CROSSHOST_MANAGE)) {
            throw new HttpError(403, 'forbidden', 'fleet restart requires bot.fleet.restart');
        }
        const scope = body.scope === 'worker' ? 'worker' : 'fleet';
        const reason = typeof body.reason === 'string' ? body.reason : 'dashboard fleet restart';
        const userId = req.dashSession!.payload.userId;

        if (scope === 'worker') {
            const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : '';
            if (!machineId) {
                throw new HttpError(400, 'bad_request', 'machineId required for worker restart');
            }
            await this.heart.control.shutdownMachine(machineId, reason);
            await writeAudit(this.heart, {
                actorId: userId,
                action: 'fleet.worker_restart',
                target: machineId,
                meta: { reason },
            });
            ok(res, { ok: true, scope, machineId, reason });
            return;
        }

        await writeAudit(this.heart, {
            actorId: userId,
            action: 'fleet.restart',
            target: 'fleet',
            meta: { reason },
        });
        ok(res, { ok: true, scope: 'fleet', reason });
        void this.heart.control.shutdownFleet(reason).catch(() => undefined);
    }

    private async shardShift(req: DashRequest, res: Response): Promise<void> {
        if (!this.heart.control.isCrossHost()) {
            throw new HttpError(400, 'not_available_here', 'Shard shift requires Cross-Host');
        }
        const body = requireBody<{ shardId: number | string; toMachineId: string }>(req.body, [
            'shardId',
            'toMachineId',
        ]);
        const shardId = typeof body.shardId === 'number' ? body.shardId : Number(body.shardId);
        const toMachineId = String(body.toMachineId).trim();
        if (!Number.isInteger(shardId) || shardId < 0) {
            throw new HttpError(400, 'bad_request', 'Invalid shardId');
        }
        if (!toMachineId) {
            throw new HttpError(400, 'bad_request', 'toMachineId required');
        }
        const { requestShardShift, isClusterClientReady } = await import(
            '#core/crosshost/worker/clusterClient.js'
        );
        if (!isClusterClientReady()) {
            throw new HttpError(503, 'fleet_unreachable', 'Cluster client not authenticated');
        }
        const result = await requestShardShift(shardId, toMachineId);
        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'fleet.shard_shift',
            target: String(shardId),
            meta: { from: result.from, to: result.to, generation: result.generation },
        });
        ok(res, { ok: true, shardId, ...result });
    }

    private async moderationActions(req: DashRequest, res: Response): Promise<void> {
        const { listModerationActions } = await import('../../../dash-data/src/lib/store.js');
        const limitRaw = req.query.limit;
        const limitStr = Array.isArray(limitRaw) ? limitRaw[0] : limitRaw;
        const limit = typeof limitStr === 'string' ? Number(limitStr) : 50;
        const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
        const targetUserId =
            typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined;
        const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
        const rows = await listModerationActions({
            actorId,
            targetUserId,
            guildId,
            limit: Number.isFinite(limit) ? limit : 50,
        });
        ok(res, { items: rows, count: rows.length });
    }
}
