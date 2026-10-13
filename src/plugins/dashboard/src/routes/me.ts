import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { dashGet, dashAll, dashRun, dashMongo, ensureDashboardAdapter, writeAudit, infractionsCollection } from '../lib/db.js';
import { getMember, serializeMember } from '../lib/discord.js';

type GuildParams = { guildId: string };

export default class MeRoute extends BaseRoute {
    public readonly basePath = '/api/dash/me';

    
    /**
     * @openapi
     * /api/dash/me:
     *   get:
     *     tags: [DashboardMe]
     *     summary: Current user profile
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Profile }
     * /api/dash/me/data:
     *   get:
     *     tags: [DashboardMe]
     *     summary: Stored user data
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Data blob }
     * /api/dash/me/data/deletion-request:
     *   post:
     *     tags: [DashboardMe]
     *     summary: Request data deletion
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Queued }
     *   delete:
     *     tags: [DashboardMe]
     *     summary: Cancel deletion request
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Cancelled }
     * /api/dash/me/servers:
     *   get:
     *     tags: [DashboardMe]
     *     summary: Servers for current user
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Server list }
     * /api/dash/me/servers/{guildId}/stats:
     *   get:
     *     tags: [DashboardMe]
     *     summary: Per-server stats for current user
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200': { description: Stats }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const auth = requireSession(this.heart);

        this.router.get('/', auth, this.asyncHandler(guarded(this.heart, this.profile.bind(this))));
        this.router.get('/data', auth, this.asyncHandler(guarded(this.heart, this.allData.bind(this))));
        this.router.post('/data/deletion-request', auth, this.asyncHandler(guarded(this.heart, this.requestDeletion.bind(this))));
        this.router.delete('/data/deletion-request', auth, this.asyncHandler(guarded(this.heart, this.cancelDeletion.bind(this))));
        this.router.get('/servers', auth, this.asyncHandler(guarded(this.heart, this.myServers.bind(this))));
        this.router.get('/servers/:guildId/stats', auth, this.asyncHandler(guarded(this.heart, this.myServerStats.bind(this))));
    }

    private async profile(req: DashRequest, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        const user = await this.heart.client.users.fetch(userId).catch(() => null);
        ok(res, {
            id: userId,
            username: user?.username ?? null,
            avatarUrl: user?.displayAvatarURL({ size: 256 }) ?? null,
            bits: req.dashSession!.payload.bits,
            sessionExpiresAt: req.dashSession!.payload.exp,
        });
    }

    private async allData(req: DashRequest, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        const db = await ensureDashboardAdapter();

        let notes: unknown[];
        if (db.engine === 'mongo') {
            notes = await (await dashMongo('dash_member_notes')).find({ userId });
        } else {
            notes = await dashAll(
                `SELECT id, guildId, content, authorId, createdAt FROM dash_member_notes WHERE userId = ?`,
                [userId],
            );
        }

        const infractionsCol = await infractionsCollection(this.heart);
        const infractions: Record<string, unknown>[] = [];
        for await (const doc of infractionsCol.scan('infr_', 'infr_\uffff')) {
            if (doc.userId === userId) infractions.push(doc);
        }

        let deletionRequest: unknown;
        if (db.engine === 'mongo') {
            deletionRequest = await (await dashMongo('dash_deletion_requests')).findOne({
                $or: [{ userId }, { _id: userId }],
            });
        } else {
            deletionRequest = await dashGet(
                `SELECT userId, requestedAt, status FROM dash_deletion_requests WHERE userId = ?`,
                [userId],
            );
        }

        const memberships = [...this.heart.client.guilds.cache.values()]
            .filter((g) => g.members.cache.has(userId))
            .map((g) => g.id);

        ok(res, { userId, memberships, notes, infractions, deletionRequest: deletionRequest ?? null });
    }

    private async requestDeletion(req: DashRequest, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        const db = await ensureDashboardAdapter();
        let existing: unknown;
        if (db.engine === 'mongo') {
            existing = await (await dashMongo('dash_deletion_requests')).findOne({
                $or: [{ userId }, { _id: userId }],
            });
        } else {
            existing = await dashGet(`SELECT userId FROM dash_deletion_requests WHERE userId = ?`, [userId]);
        }
        if (existing) throw new HttpError(409, 'conflict', 'A deletion request is already pending for this account.');

        const at = Date.now();
        if (db.engine === 'mongo') {
            await (await dashMongo('dash_deletion_requests')).insertOne({
                _id: userId,
                userId,
                requestedAt: at,
                status: 'pending',
            });
        } else {
            await dashRun(
                `INSERT INTO dash_deletion_requests (userId, requestedAt, status) VALUES (?, ?, 'pending')`,
                [userId, at],
            );
        }

        const graceDays = (this.heart.assets.config.get('dataDeletion') as { graceDays: number }).graceDays;
        await writeAudit(this.heart, { actorId: userId, action: 'me.deletion-request.create', target: userId });
        ok(res, { requested: true, graceDays }, 201);
    }

    private async cancelDeletion(req: DashRequest, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        const db = await ensureDashboardAdapter();
        let changed: boolean;
        if (db.engine === 'mongo') {
            const n = await (await dashMongo('dash_deletion_requests')).deleteOne({
                $and: [{ $or: [{ userId }, { _id: userId }] }, { status: 'pending' }],
            });
            changed = n > 0;
        } else {
            const before = await dashGet(
                `SELECT userId FROM dash_deletion_requests WHERE userId = ? AND status = 'pending'`,
                [userId],
            );
            await dashRun(`DELETE FROM dash_deletion_requests WHERE userId = ? AND status = 'pending'`, [userId]);
            changed = !!before;
        }
        if (!changed) throw new HttpError(404, 'not_found', 'No pending deletion request to cancel.');

        await writeAudit(this.heart, { actorId: userId, action: 'me.deletion-request.cancel', target: userId });
        ok(res, { cancelled: true });
    }

    private async myServers(req: DashRequest, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        const shared = [...this.heart.client.guilds.cache.values()]
            .filter((g) => g.members.cache.has(userId))
            .map((g) => ({ id: g.id, name: g.name, iconUrl: g.iconURL({ size: 256 }) ?? null }));
        ok(res, shared);
    }

    private async myServerStats(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        const { guildId } = req.params;
        const member = await getMember(this.heart, guildId, userId);

        const col = await infractionsCollection(this.heart);
        let infractionCount = 0;
        const prefix = `infr_${guildId}_${userId}_`;
        for await (const _doc of col.scan(prefix, prefix + '\uffff')) infractionCount += 1;

        ok(res, { ...serializeMember(member), guildId, infractionCount });
    }
}
