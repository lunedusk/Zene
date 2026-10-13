import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, parsePagination, paginated } from '../lib/http.js';
import { dashGet, dashRun, dashMongo, ensureDashboardAdapter, writeAudit } from '../lib/db.js';
import { getGuild, leaveGuild, serializeGuild } from '../lib/discord.js';
import { BITS } from '../lib/bits.js';

type GuildParams = { guildId: string };

export default class AdminServersRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/servers';

    
    /**
     * @openapi
     * /api/dash/admin/servers:
     *   get:
     *     tags: [DashboardServers]
     *     summary: List servers
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Servers }
     * /api/dash/admin/servers/{guildId}:
     *   get:
     *     tags: [DashboardServers]
     *     summary: Server detail
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200': { description: Guild }
     * /api/dash/admin/servers/{guildId}/ban:
     *   post:
     *     tags: [DashboardServers]
     *     summary: Ban guild (gate)
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Banned }
     * /api/dash/admin/servers/{guildId}/unban:
     *   post:
     *     tags: [DashboardServers]
     *     summary: Unban guild
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Unbanned }
     * /api/dash/admin/servers/{guildId}/leave:
     *   post:
     *     tags: [DashboardServers]
     *     summary: Leave guild
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Left }
     */

protected register(): void {
        applyGateway(this.heart, this.router);

        this.router.get(
            '/',
            ...requireAuthedBit(this.heart, BITS.BOT_SERVERS_VIEW),
            this.asyncHandler(guarded(this.heart, this.list.bind(this))),
        );
        this.router.get(
            '/:guildId',
            ...requireAuthedBit(this.heart, BITS.BOT_SERVERS_VIEW),
            this.asyncHandler(guarded(this.heart, this.detail.bind(this))),
        );
        this.router.post(
            '/:guildId/ban',
            ...requireAuthedBit(this.heart, BITS.BOT_SERVERS_BAN),
            this.asyncHandler(guarded(this.heart, this.ban.bind(this))),
        );
        this.router.post(
            '/:guildId/unban',
            ...requireAuthedBit(this.heart, BITS.BOT_SERVERS_BAN),
            this.asyncHandler(guarded(this.heart, this.unban.bind(this))),
        );
        this.router.post(
            '/:guildId/leave',
            ...requireAuthedBit(this.heart, BITS.BOT_SERVERS_MANAGE),
            this.asyncHandler(guarded(this.heart, this.leave.bind(this))),
        );
    }

    private async isBanned(guildId: string): Promise<boolean> {
        const db = await ensureDashboardAdapter();
        if (db.engine === 'mongo') {
            const row = await (await dashMongo('dash_server_bans')).findOne({
                $or: [{ guildId }, { _id: guildId }],
            });
            return !!row;
        }
        const row = await dashGet(`SELECT guildId FROM dash_server_bans WHERE guildId = ?`, [guildId]);
        return !!row;
    }

    private async list(req: DashRequest, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;

        let guilds = [...this.heart.client.guilds.cache.values()];
        if (search) guilds = guilds.filter((g) => g.name.toLowerCase().includes(search) || g.id === search);

        const banFlags = await Promise.all(guilds.map(async (g) => [g.id, await this.isBanned(g.id)] as const));
        const bannedSet = new Set(banFlags.filter(([, b]) => b).map(([id]) => id));

        if (status === 'banned') guilds = guilds.filter((g) => bannedSet.has(g.id));
        if (status === 'active') guilds = guilds.filter((g) => !bannedSet.has(g.id));

        const total = guilds.length;
        const page = guilds.slice(p.offset, p.offset + p.limit).map((g) => ({
            ...serializeGuild(g),
            banned: bannedSet.has(g.id),
        }));

        ok(res, paginated(page, total, p));
    }

    private async detail(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const guild = getGuild(this.heart, req.params.guildId);
        const db = await ensureDashboardAdapter();
        let ban: unknown;
        if (db.engine === 'mongo') {
            ban = await (await dashMongo('dash_server_bans')).findOne({
                $or: [{ guildId: guild.id }, { _id: guild.id }],
            });
        } else {
            ban = await dashGet(
                `SELECT reason, bannedBy, bannedAt FROM dash_server_bans WHERE guildId = ?`,
                [guild.id],
            );
        }
        ok(res, { ...serializeGuild(guild), ban: ban ?? null });
    }

    private async ban(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const { guildId } = req.params;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const guild = getGuild(this.heart, guildId);
        const at = Date.now();
        const by = req.dashSession!.payload.userId;
        const db = await ensureDashboardAdapter();

        if (db.engine === 'mongo') {
            await (await dashMongo('dash_server_bans')).updateOne(
                { _id: guildId },
                { $set: { _id: guildId, guildId, reason: reason ?? null, bannedBy: by, bannedAt: at } },
                { upsert: true },
            );
        } else if (db.engine === 'postgres') {
            await dashRun(
                `INSERT INTO dash_server_bans (guildId, reason, bannedBy, bannedAt) VALUES (?, ?, ?, ?)
                 ON CONFLICT (guildId) DO UPDATE SET reason = EXCLUDED.reason, bannedBy = EXCLUDED.bannedBy, bannedAt = EXCLUDED.bannedAt`,
                [guildId, reason ?? null, by, at],
            );
        } else {
            await dashRun(
                `INSERT INTO dash_server_bans (guildId, reason, bannedBy, bannedAt) VALUES (?, ?, ?, ?)
                 ON CONFLICT(guildId) DO UPDATE SET reason = excluded.reason, bannedBy = excluded.bannedBy, bannedAt = excluded.bannedAt`,
                [guildId, reason ?? null, by, at],
            );
        }

        await leaveGuild(this.heart, guildId);
        await writeAudit(this.heart, {
            actorId: by,
            action: 'server.ban',
            target: guildId,
            meta: { reason, guildName: guild.name },
        });

        ok(res, { guildId, banned: true });
    }

    private async unban(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const { guildId } = req.params;
        const db = await ensureDashboardAdapter();
        let changed: boolean;
        if (db.engine === 'mongo') {
            const n = await (await dashMongo('dash_server_bans')).deleteOne({
                $or: [{ _id: guildId }, { guildId }],
            });
            changed = n > 0;
        } else {
            const before = await dashGet(`SELECT guildId FROM dash_server_bans WHERE guildId = ?`, [guildId]);
            await dashRun(`DELETE FROM dash_server_bans WHERE guildId = ?`, [guildId]);
            changed = !!before;
        }
        if (!changed) throw new HttpError(404, 'not_found', `Guild ${guildId} is not banned.`);

        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'server.unban',
            target: guildId,
        });
        ok(res, { guildId, banned: false });
    }

    private async leave(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const { guildId } = req.params;
        const guild = getGuild(this.heart, guildId);
        await leaveGuild(this.heart, guildId);
        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'server.leave',
            target: guildId,
            meta: { guildName: guild.name },
        });
        ok(res, { guildId, left: true });
    }
}
