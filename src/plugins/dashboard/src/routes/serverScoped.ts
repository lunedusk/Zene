import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireGuildBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, parsePagination, paginated, requireBody, toStringArray } from '../lib/http.js';
import { dashGet, dashAll, dashRun, dashMongo, ensureDashboardAdapter, writeAudit, infractionsCollection, auditCollection, newId, getServerPluginConfig, setServerPluginConfig } from '../lib/db.js';
import { getGuild, getMember, kickMember, banMember, muteMember, serializeGuild, serializeMember } from '../lib/discord.js';
import { listAllPlugins } from '../lib/pluginLifecycle.js';
import { permissions } from '../lib/roles.js';
import { BITS } from '../lib/bits.js';

type GuildParams = { guildId: string };
type GuildPluginParams = { guildId: string; pluginId: string };
type GuildUserParams = { guildId: string; userId: string };
type GuildUserInfractionParams = { guildId: string; userId: string; id: string };
type GuildRoleParams = { guildId: string; roleId: string };

export default class ServerScopedRoute extends BaseRoute {
    public readonly basePath = '/api/dash/servers';

    
    /**
     * @openapi
     * /api/dash/servers/{guildId}:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Server overview
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: guildId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200': { description: Guild overview }
     * /api/dash/servers/{guildId}/plugins:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild plugins
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Plugins }
     * /api/dash/servers/{guildId}/plugins/{pluginId}/config:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild plugin config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Config }
     *   put:
     *     tags: [DashboardServerScoped]
     *     summary: Update guild plugin config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Saved }
     * /api/dash/servers/{guildId}/members:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild members
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Members }
     * /api/dash/servers/{guildId}/members/{userId}:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild member
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Member }
     * /api/dash/servers/{guildId}/members/{userId}/infractions:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Member infractions
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Infractions }
     * /api/dash/servers/{guildId}/members/{userId}/kick:
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Kick
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/servers/{guildId}/members/{userId}/ban:
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Ban
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/servers/{guildId}/members/{userId}/mute:
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Mute
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/servers/{guildId}/members/{userId}/infractions/{id}:
     *   delete:
     *     tags: [DashboardServerScoped]
     *     summary: Delete infraction
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Deleted }
     * /api/dash/servers/{guildId}/members/{userId}/notes:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Notes
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Notes }
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Add note
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '201': { description: Created }
     * /api/dash/servers/{guildId}/roles:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Server roles
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Roles }
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Create server role
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '201': { description: Created }
     * /api/dash/servers/{guildId}/roles/{roleId}:
     *   put:
     *     tags: [DashboardServerScoped]
     *     summary: Update server role
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Updated }
     *   delete:
     *     tags: [DashboardServerScoped]
     *     summary: Delete server role
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Deleted }
     * /api/dash/servers/{guildId}/roles/{roleId}/assign:
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Assign
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Assigned }
     * /api/dash/servers/{guildId}/roles/{roleId}/revoke:
     *   post:
     *     tags: [DashboardServerScoped]
     *     summary: Revoke
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Revoked }
     * /api/dash/servers/{guildId}/lang:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild lang
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Lang }
     *   put:
     *     tags: [DashboardServerScoped]
     *     summary: Set guild lang
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Saved }
     * /api/dash/servers/{guildId}/logs:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild logs
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Logs }
     * /api/dash/servers/{guildId}/analytics:
     *   get:
     *     tags: [DashboardServerScoped]
     *     summary: Guild analytics
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Analytics }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const g = this.heart;
        const R = <T extends keyof typeof BITS>(bit: T, cross?: keyof typeof BITS) =>
            requireGuildBit(g, BITS[bit], cross ? BITS[cross] : undefined);

        this.router.get('/:guildId', ...R('SERVER_CONFIG_VIEW', 'BOT_SERVERS_VIEW'), this.asyncHandler(guarded(g, this.detail.bind(this))));

        this.router.get('/:guildId/plugins', ...R('SERVER_CONFIG_VIEW', 'BOT_PLUGINS_VIEW'), this.asyncHandler(guarded(g, this.plugins.bind(this))));
        this.router.get('/:guildId/plugins/:pluginId/config', ...R('SERVER_CONFIG_VIEW', 'BOT_PLUGINS_VIEW'), this.asyncHandler(guarded(g, this.getPluginConfig.bind(this))));
        this.router.put('/:guildId/plugins/:pluginId/config', ...R('SERVER_CONFIG_MANAGE', 'BOT_PLUGINS_MANAGE'), this.asyncHandler(guarded(g, this.putPluginConfig.bind(this))));

        this.router.get('/:guildId/members', ...R('SERVER_MEMBERS_VIEW', 'BOT_MEMBERS_VIEW'), this.asyncHandler(guarded(g, this.members.bind(this))));
        this.router.get('/:guildId/members/:userId', ...R('SERVER_MEMBERS_VIEW', 'BOT_MEMBERS_VIEW'), this.asyncHandler(guarded(g, this.memberDetail.bind(this))));
        this.router.get('/:guildId/members/:userId/infractions', ...R('SERVER_MEMBERS_HISTORY', 'BOT_MEMBERS_VIEW'), this.asyncHandler(guarded(g, this.memberInfractions.bind(this))));
        this.router.post('/:guildId/members/:userId/kick', ...R('SERVER_MEMBERS_KICK', 'BOT_MEMBERS_KICK'), this.asyncHandler(guarded(g, this.kick.bind(this))));
        this.router.post('/:guildId/members/:userId/ban', ...R('SERVER_MEMBERS_BAN', 'BOT_MEMBERS_BAN'), this.asyncHandler(guarded(g, this.ban.bind(this))));
        this.router.post('/:guildId/members/:userId/mute', ...R('SERVER_MEMBERS_MUTE', 'BOT_MEMBERS_MUTE'), this.asyncHandler(guarded(g, this.mute.bind(this))));
        this.router.delete('/:guildId/members/:userId/infractions/:id', ...R('PLUGIN_DASHBOARD_INFRACTIONS_MANAGE', 'PLUGIN_DASHBOARD_INFRACTIONS_MANAGE'), this.asyncHandler(guarded(g, this.removeInfraction.bind(this))));
        this.router.get('/:guildId/members/:userId/notes', ...R('SERVER_MEMBERS_NOTES', 'BOT_MEMBERS_VIEW'), this.asyncHandler(guarded(g, this.getNotes.bind(this))));
        this.router.post('/:guildId/members/:userId/notes', ...R('SERVER_MEMBERS_NOTES', 'PLUGIN_DASHBOARD_MEMBERS_NOTES'), this.asyncHandler(guarded(g, this.addNote.bind(this))));

        this.router.get('/:guildId/roles', ...R('SERVER_ROLES_MANAGE', 'BOT_ROLES_MANAGE'), this.asyncHandler(guarded(g, this.listRoles.bind(this))));
        this.router.post('/:guildId/roles', ...R('SERVER_ROLES_MANAGE', 'BOT_ROLES_MANAGE'), this.asyncHandler(guarded(g, this.createRole.bind(this))));
        this.router.put('/:guildId/roles/:roleId', ...R('SERVER_ROLES_MANAGE', 'BOT_ROLES_MANAGE'), this.asyncHandler(guarded(g, this.updateRole.bind(this))));
        this.router.delete('/:guildId/roles/:roleId', ...R('SERVER_ROLES_MANAGE', 'BOT_ROLES_MANAGE'), this.asyncHandler(guarded(g, this.deleteRole.bind(this))));
        this.router.post('/:guildId/roles/:roleId/assign', ...R('SERVER_ROLES_MANAGE', 'BOT_ROLES_MANAGE'), this.asyncHandler(guarded(g, this.assignRole.bind(this))));
        this.router.post('/:guildId/roles/:roleId/revoke', ...R('SERVER_ROLES_MANAGE', 'BOT_ROLES_MANAGE'), this.asyncHandler(guarded(g, this.revokeRole.bind(this))));

        this.router.get('/:guildId/lang', ...R('SERVER_LANG_MANAGE'), this.asyncHandler(guarded(g, this.getLang.bind(this))));
        this.router.put('/:guildId/lang', ...R('SERVER_LANG_MANAGE'), this.asyncHandler(guarded(g, this.putLang.bind(this))));

        this.router.get('/:guildId/logs', ...R('SERVER_LOGS_VIEW', 'BOT_LOGS_VIEW'), this.asyncHandler(guarded(g, this.logs.bind(this))));
        this.router.get('/:guildId/analytics', ...R('SERVER_ANALYTICS_VIEW', 'BOT_ANALYTICS_VIEW'), this.asyncHandler(guarded(g, this.analytics.bind(this))));
    }

    private async detail(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        ok(res, serializeGuild(getGuild(this.heart, req.params.guildId)));
    }

    private async plugins(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const all = await listAllPlugins();
        const withGuildState = await Promise.all(
            all.map(async (p) => {
                const override = await getServerPluginConfig(this.heart, req.params.guildId, p.id);
                return { ...p, hasServerConfigOverride: Object.keys(override).length > 0 };
            }),
        );
        ok(res, withGuildState);
    }

    private async getPluginConfig(req: DashRequest<GuildPluginParams>, res: Response): Promise<void> {
        ok(res, await getServerPluginConfig(this.heart, req.params.guildId, req.params.pluginId));
    }

    private async putPluginConfig(req: DashRequest<GuildPluginParams>, res: Response): Promise<void> {
        if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'bad_request', 'Body must be a config object.');
        await setServerPluginConfig(this.heart, req.params.guildId, req.params.pluginId, req.body);
        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'server.plugin.config.save',
            target: req.params.pluginId,
            guildId: req.params.guildId,
        });
        ok(res, await getServerPluginConfig(this.heart, req.params.guildId, req.params.pluginId));
    }

    private async members(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const guild = getGuild(this.heart, req.params.guildId);
        const all = [...guild.members.cache.values()];
        const page = all.slice(p.offset, p.offset + p.limit).map(serializeMember);
        ok(res, paginated(page, all.length, p));
    }

    private async memberDetail(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const member = await getMember(this.heart, req.params.guildId, req.params.userId);
        ok(res, serializeMember(member));
    }

    private async memberInfractions(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const col = await infractionsCollection(this.heart);
        const prefix = `infr_${req.params.guildId}_${req.params.userId}_`;
        const all: Record<string, unknown>[] = [];
        for await (const doc of col.scan(prefix, prefix + '\uffff')) all.push(doc);
        all.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
        ok(res, paginated(all.slice(p.offset, p.offset + p.limit), all.length, p));
    }

    private async kick(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const { guildId, userId } = req.params;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        await kickMember(this.heart, guildId, userId, reason);
        await this.logInfraction(guildId, userId, 'kick', reason, req.dashSession!.payload.userId);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.member.kick', target: userId, guildId, meta: { reason } });
        ok(res, { userId, kicked: true });
    }

    private async ban(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const { guildId, userId } = req.params;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const deleteMessageDays = Number(req.body?.deleteMessageDays ?? 0);
        await banMember(this.heart, guildId, userId, reason, deleteMessageDays * 86400);
        await this.logInfraction(guildId, userId, 'ban', reason, req.dashSession!.payload.userId, { deleteMessageDays });
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.member.ban', target: userId, guildId, meta: { reason, deleteMessageDays } });
        ok(res, { userId, banned: true });
    }

    private async mute(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const { guildId, userId } = req.params;
        const duration = Number(req.body?.duration);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        if (!Number.isFinite(duration) || duration <= 0) throw new HttpError(400, 'bad_request', 'duration (ms) must be a positive number.');
        await muteMember(this.heart, guildId, userId, duration, reason);
        await this.logInfraction(guildId, userId, 'mute', reason, req.dashSession!.payload.userId, { duration });
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.member.mute', target: userId, guildId, meta: { duration, reason } });
        ok(res, { userId, muted: true });
    }

    private async removeInfraction(req: DashRequest<GuildUserInfractionParams>, res: Response): Promise<void> {
        const col = await infractionsCollection(this.heart);
        const existing = await col.get(req.params.id).catch(() => null);
        if (!existing || existing.guildId !== req.params.guildId) {
            throw new HttpError(404, 'not_found', 'Infraction not found in this server.');
        }
        await col.delete(req.params.id);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.infraction.delete', target: req.params.userId, guildId: req.params.guildId, meta: { infractionId: req.params.id } });
        ok(res, { deleted: true });
    }

    private async getNotes(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const dbN = await ensureDashboardAdapter();
        let rows: unknown[];
        if (dbN.engine === 'mongo') {
            const parts = [req.params.userId, req.params.guildId];
            rows = await (await dashMongo('dash_member_notes')).find({ userId: parts[0], guildId: parts[1] });
        } else {
            rows = await dashAll(`SELECT id, content, authorId, createdAt FROM dash_member_notes WHERE userId = ? AND guildId = ? ORDER BY createdAt DESC`, [req.params.userId, req.params.guildId]);
        }
        ok(res, rows);
    }

    private async addNote(req: DashRequest<GuildUserParams>, res: Response): Promise<void> {
        const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
        if (!content) throw new HttpError(400, 'bad_request', 'content is required.');
        const id = newId('note');
        const dbI = await ensureDashboardAdapter();
        const _args = [id, req.params.userId, req.params.guildId, content, req.dashSession!.payload.userId, Date.now()];
        if (dbI.engine === 'mongo') {
            await (await dashMongo('dash_member_notes')).insertOne({ _id: _args[0], id: _args[0], userId: _args[1], guildId: _args[2], content: _args[3], authorId: _args[4], createdAt: _args[5] });
        } else {
            await dashRun(`INSERT INTO dash_member_notes (id, userId, guildId, content, authorId, createdAt) VALUES (?, ?, ?, ?, ?, ?)`, _args);
        }
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.member.note.add', target: req.params.userId, guildId: req.params.guildId, meta: { noteId: id } });
        ok(res, { id, content }, 201);
    }

    private async listRoles(req: DashRequest<GuildRoleParams>, res: Response): Promise<void> {
        ok(res, await permissions(this.heart).listServerRoles(req.params.guildId));
    }

    private async createRole(req: DashRequest<GuildRoleParams>, res: Response): Promise<void> {
        const body = requireBody<{ name: string; color: string; bits?: string[] }>(req.body, ['name', 'color']);
        const role = await permissions(this.heart).createServerRole(req.params.guildId, {
            name: body.name,
            color: body.color,
            bits: toStringArray(body.bits ?? []),
            createdBy: req.dashSession!.payload.userId,
        });
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.role.create', target: role._id, guildId: req.params.guildId });
        ok(res, role, 201);
    }

    private async updateRole(req: DashRequest<GuildRoleParams>, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { name?: string; color?: string; bits?: string[] };
        const role = await permissions(this.heart).updateServerRole(req.params.guildId, req.params.roleId, {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(body.bits !== undefined ? { bits: toStringArray(body.bits) } : {}),
        });
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.role.update', target: req.params.roleId, guildId: req.params.guildId });
        ok(res, role);
    }

    private async deleteRole(req: DashRequest<GuildRoleParams>, res: Response): Promise<void> {
        await permissions(this.heart).deleteServerRole(req.params.guildId, req.params.roleId);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.role.delete', target: req.params.roleId, guildId: req.params.guildId });
        ok(res, { deleted: true });
    }

    private async assignRole(req: DashRequest<GuildRoleParams>, res: Response): Promise<void> {
        const userIds = toStringArray(req.body?.userIds);
        if (userIds.length === 0) throw new HttpError(400, 'bad_request', 'userIds must be a non-empty array.');
        await permissions(this.heart).assignServerRole(req.params.guildId, req.params.roleId, userIds);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.role.assign', target: req.params.roleId, guildId: req.params.guildId, meta: { userIds } });
        ok(res, { roleId: req.params.roleId, assigned: userIds });
    }

    private async revokeRole(req: DashRequest<GuildRoleParams>, res: Response): Promise<void> {
        const userIds = toStringArray(req.body?.userIds);
        if (userIds.length === 0) throw new HttpError(400, 'bad_request', 'userIds must be a non-empty array.');
        await permissions(this.heart).revokeServerRole(req.params.guildId, req.params.roleId, userIds);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.role.revoke', target: req.params.roleId, guildId: req.params.guildId, meta: { userIds } });
        ok(res, { roleId: req.params.roleId, revoked: userIds });
    }

    private async getLang(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const dbL = await ensureDashboardAdapter();
        let row: { overrides: string; updatedAt: number } | undefined;
        if (dbL.engine === 'mongo') {
            const doc = await (await dashMongo('dash_lang_overrides')).findOne({ $or: [{ guildId: req.params.guildId }, { _id: req.params.guildId }] });
            if (doc) row = { overrides: String(doc.overrides ?? '{}'), updatedAt: Number(doc.updatedAt ?? 0) };
        } else {
            row = (await dashGet(`SELECT overrides, updatedAt FROM dash_lang_overrides WHERE guildId = ?`, [req.params.guildId])) as typeof row;
        }
        ok(res, row ? { overrides: JSON.parse(row.overrides), updatedAt: row.updatedAt } : { overrides: {}, updatedAt: null });
    }

    private async putLang(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'bad_request', 'Body must be an overrides object.');
        const dbU = await ensureDashboardAdapter();
        const _u = [req.params.guildId, JSON.stringify(req.body), Date.now()];
        if (dbU.engine === 'mongo') {
            await (await dashMongo('dash_lang_overrides')).updateOne(
                { _id: _u[0] },
                { $set: { _id: _u[0], guildId: _u[0], overrides: _u[1], updatedAt: _u[2] } },
                { upsert: true },
            );
        } else if (dbU.engine === 'postgres') {
            await dashRun(`INSERT INTO dash_lang_overrides (guildId, overrides, updatedAt) VALUES (?, ?, ?)
             ON CONFLICT (guildId) DO UPDATE SET overrides = EXCLUDED.overrides, updatedAt = EXCLUDED.updatedAt`, _u);
        } else {
            await dashRun(`INSERT INTO dash_lang_overrides (guildId, overrides, updatedAt) VALUES (?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET overrides = excluded.overrides, updatedAt = excluded.updatedAt`, _u);
        }
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'server.lang.save', guildId: req.params.guildId });
        ok(res, { saved: true });
    }

    private async logs(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const col = await auditCollection(this.heart);
        const all: Record<string, unknown>[] = [];
        const prefix = `log_${req.params.guildId}_`;
        for await (const doc of col.scan(prefix, prefix + '\uffff')) all.push(doc);
        all.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
        ok(res, paginated(all.slice(p.offset, p.offset + p.limit), all.length, p));
    }

    private async analytics(req: DashRequest<GuildParams>, res: Response): Promise<void> {
        const guild = getGuild(this.heart, req.params.guildId);
        ok(res, {
            guildId: guild.id,
            memberCount: guild.memberCount,
        });
    }

    private async logInfraction(
        guildId: string,
        userId: string,
        type: string,
        reason: string | undefined,
        moderatorId: string,
        meta: Record<string, unknown> = {},
    ): Promise<void> {
        const col = await infractionsCollection(this.heart);
        const ts = Date.now();
        await col.upsert({
            _id: `infr_${guildId}_${userId}_${ts}_${Math.random().toString(36).slice(2, 6)}`,
            guildId,
            userId,
            type,
            reason: reason ?? null,
            moderatorId,
            meta,
            createdAt: ts,
        });
    }
}
