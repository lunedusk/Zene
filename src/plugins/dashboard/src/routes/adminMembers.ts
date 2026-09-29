import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, parsePagination, paginated, toStringArray } from '../lib/http.js';
import { dashGet, dashAll, dashRun, dashMongo, ensureDashboardAdapter, writeAudit, infractionsCollection, banGlobal, unbanGlobal, newId, GLOBAL_BAN_SENTINEL } from '../lib/db.js';
import { kickMember, banMember, unbanMember, muteMember, unmuteMember, serializeMember } from '../lib/discord.js';
import { BITS } from '../lib/bits.js';
import { resolveActorPermissions } from '#core/permissions/capabilities.js';
import { canActOnMember } from '#core/permissions/hierarchy.js';

type UserParams = { userId: string };
type UserNoteParams = { userId: string; noteId: string };

export default class AdminMembersRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/members';

    
    /**
     * @openapi
     * /api/dash/admin/members:
     *   get:
     *     tags: [DashboardMembers]
     *     summary: List members (admin)
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Members }
     * /api/dash/admin/members/{userId}:
     *   get:
     *     tags: [DashboardMembers]
     *     summary: Member detail
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: userId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200': { description: Member }
     * /api/dash/admin/members/{userId}/infractions:
     *   get:
     *     tags: [DashboardMembers]
     *     summary: Member infractions
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Infractions }
     * /api/dash/admin/members/{userId}/kick:
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Kick member
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/admin/members/{userId}/ban:
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Ban member
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/admin/members/{userId}/ban-global:
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Global ban
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/admin/members/{userId}/unban:
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Unban member
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/admin/members/{userId}/mute:
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Mute / timeout
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/admin/members/{userId}/unmute:
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Unmute
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Result }
     * /api/dash/admin/members/{userId}/notes:
     *   get:
     *     tags: [DashboardMembers]
     *     summary: List notes
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Notes }
     *   post:
     *     tags: [DashboardMembers]
     *     summary: Add note
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '201': { description: Created }
     * /api/dash/admin/members/{userId}/notes/{noteId}:
     *   delete:
     *     tags: [DashboardMembers]
     *     summary: Delete note
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Deleted }
     */

protected register(): void {
        applyGateway(this.heart, this.router);

        const view = requireAuthedBit(this.heart, BITS.BOT_MEMBERS_VIEW);
        const kickBit = requireAuthedBit(this.heart, BITS.BOT_MEMBERS_KICK);
        const banBit = requireAuthedBit(this.heart, BITS.BOT_MEMBERS_BAN);
        const banGlobalBit = requireAuthedBit(this.heart, BITS.BOT_MEMBERS_BAN_GLOBAL);
        const muteBit = requireAuthedBit(this.heart, BITS.BOT_MEMBERS_MUTE);
        const notesWrite = requireAuthedBit(this.heart, BITS.PLUGIN_DASHBOARD_MEMBERS_NOTES);

        this.router.get('/', ...view, this.asyncHandler(guarded(this.heart, this.search.bind(this))));
        this.router.get('/:userId', ...view, this.asyncHandler(guarded(this.heart, this.detail.bind(this))));
        this.router.get('/:userId/infractions', ...view, this.asyncHandler(guarded(this.heart, this.infractions.bind(this))));

        this.router.post('/:userId/kick', ...kickBit, this.asyncHandler(guarded(this.heart, this.kick.bind(this))));
        this.router.post('/:userId/ban', ...banBit, this.asyncHandler(guarded(this.heart, this.ban.bind(this))));
        this.router.post('/:userId/ban-global', ...banGlobalBit, this.asyncHandler(guarded(this.heart, this.banGlobalHandler.bind(this))));
        this.router.post('/:userId/unban', ...banBit, this.asyncHandler(guarded(this.heart, this.unban.bind(this))));
        this.router.post('/:userId/mute', ...muteBit, this.asyncHandler(guarded(this.heart, this.mute.bind(this))));
        this.router.post('/:userId/unmute', ...muteBit, this.asyncHandler(guarded(this.heart, this.unmute.bind(this))));

        this.router.get('/:userId/notes', ...view, this.asyncHandler(guarded(this.heart, this.getNotes.bind(this))));
        this.router.post('/:userId/notes', ...notesWrite, this.asyncHandler(guarded(this.heart, this.addNote.bind(this))));
        this.router.delete('/:userId/notes/:noteId', ...notesWrite, this.asyncHandler(guarded(this.heart, this.deleteNote.bind(this))));
    }

    private async search(req: DashRequest, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const query = typeof req.query.query === 'string' ? req.query.query.toLowerCase() : undefined;
        const seen = new Map<string, ReturnType<typeof serializeMember>>();
        for (const guild of this.heart.client.guilds.cache.values()) {
            for (const member of guild.members.cache.values()) {
                if (seen.has(member.id)) continue;
                if (query && !member.user.username.toLowerCase().includes(query) && member.id !== query) continue;
                seen.set(member.id, serializeMember(member));
            }
        }

        const all = [...seen.values()];
        const page = all.slice(p.offset, p.offset + p.limit);
        ok(res, paginated(page, all.length, p));
    }

    private async detail(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const guilds: Record<string, ReturnType<typeof serializeMember>> = {};
        for (const guild of this.heart.client.guilds.cache.values()) {
            const member = guild.members.cache.get(userId);
            if (member) guilds[guild.id] = serializeMember(member);
        }
        if (Object.keys(guilds).length === 0) {
            throw new HttpError(404, 'not_found', `No cached membership found for user ${userId}.`);
        }

        const db = await ensureDashboardAdapter();
        let globalBan: unknown = null;
        if (db.engine === 'mongo') {
            globalBan = await (await dashMongo('dash_global_member_bans')).findOne({ $or: [{ userId }, { _id: userId }] });
        } else {
            globalBan = await dashGet(`SELECT reason, bannedBy, bannedAt FROM dash_global_member_bans WHERE userId = ?`, [userId]);
        }

        ok(res, { userId, guilds, globalBan: globalBan ?? null });
    }

    private async infractions(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const pagination = this.heart.assets.config.get('pagination') as { defaultLimit: number; maxLimit: number };
        const p = parsePagination(req, pagination);
        const col = await infractionsCollection(this.heart);

        const prefix = `infr_`;
        const all: Record<string, unknown>[] = [];
        for await (const doc of col.scan(prefix, prefix + '\uffff')) {
            if (doc.userId === req.params.userId) all.push(doc);
        }
        all.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));

        const page = all.slice(p.offset, p.offset + p.limit);
        ok(res, paginated(page, all.length, p));
    }

    /**
     * Target hierarchy check — capability/bits alone are not enough.
     * Uses PermissionsManager + hierarchy.ts (no second hierarchy system).
     */
    private async assertCanActOnTarget(actorUserId: string, targetUserId: string, guildId?: string): Promise<void> {
        if (actorUserId === targetUserId) {
            throw new HttpError(403, 'forbidden', 'Cannot act on yourself.');
        }
        const actor = await resolveActorPermissions(actorUserId, guildId);
        const target = await resolveActorPermissions(targetUserId, guildId);
        const decision = canActOnMember({
            actorUserId,
            targetUserId,
            actor: actor.resolved,
            target: target.resolved,
            scope: guildId ? 'server' : 'any',
        });
        if (!decision.allowed) {
            throw new HttpError(403, 'forbidden', decision.code ?? 'hierarchy_denied');
        }
    }

    private async kick(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const guildIds = toStringArray(req.body?.guildIds);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        if (guildIds.length === 0) throw new HttpError(400, 'bad_request', 'guildIds must be a non-empty array.');

        const actorId = req.dashSession!.payload.userId;
        for (const gid of guildIds) {
            await this.assertCanActOnTarget(actorId, userId, gid);
        }

        const results = await this.forEachGuild(guildIds, (gid) => kickMember(this.heart, gid, userId, reason));
        await this.logInfraction(userId, 'kick', reason, actorId, guildIds);
        await writeAudit(this.heart, { actorId, action: 'member.kick', target: userId, meta: { guildIds, reason } });
        ok(res, { userId, results });
    }

    private async ban(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const guildIds = toStringArray(req.body?.guildIds);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const deleteMessageDays = Number(req.body?.deleteMessageDays ?? 0);
        if (guildIds.length === 0) throw new HttpError(400, 'bad_request', 'guildIds must be a non-empty array.');

        const actorId = req.dashSession!.payload.userId;
        for (const gid of guildIds) {
            await this.assertCanActOnTarget(actorId, userId, gid);
        }

        const results = await this.forEachGuild(guildIds, (gid) =>
            banMember(this.heart, gid, userId, reason, deleteMessageDays * 86400),
        );
        await this.logInfraction(userId, 'ban', reason, actorId, guildIds);
        await writeAudit(this.heart, { actorId, action: 'member.ban', target: userId, meta: { guildIds, reason, deleteMessageDays } });
        ok(res, { userId, results });
    }

    private async banGlobalHandler(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const actorId = req.dashSession!.payload.userId;
        await this.assertCanActOnTarget(actorId, userId);

        await banGlobal(this.heart, userId, reason, actorId);
        await this.logInfraction(userId, 'ban-global', reason, req.dashSession!.payload.userId, []);
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'member.ban-global', target: userId, meta: { reason } });
        ok(res, { userId, globallyBanned: true });
    }

    private async unban(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const guildIds = toStringArray(req.body?.guildIds);
        if (guildIds.length === 0) throw new HttpError(400, 'bad_request', 'guildIds must be a non-empty array.');

        const targetGuilds = guildIds.filter((g) => g !== GLOBAL_BAN_SENTINEL);
        const results = await this.forEachGuild(targetGuilds, (gid) => unbanMember(this.heart, gid, userId));

        let globallyUnbanned = false;
        if (guildIds.includes(GLOBAL_BAN_SENTINEL)) {
            await unbanGlobal(this.heart, userId);
            globallyUnbanned = true;
        }

        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'member.unban', target: userId, meta: { guildIds } });
        ok(res, { userId, results, globallyUnbanned });
    }

    private async mute(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const guildIds = toStringArray(req.body?.guildIds);
        const duration = Number(req.body?.duration);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        if (guildIds.length === 0) throw new HttpError(400, 'bad_request', 'guildIds must be a non-empty array.');
        if (!Number.isFinite(duration) || duration <= 0) throw new HttpError(400, 'bad_request', 'duration (ms) must be a positive number.');

        const actorId = req.dashSession!.payload.userId;
        for (const gid of guildIds) {
            await this.assertCanActOnTarget(actorId, userId, gid);
        }

        const results = await this.forEachGuild(guildIds, (gid) => muteMember(this.heart, gid, userId, duration, reason));
        await this.logInfraction(userId, 'mute', reason, actorId, guildIds, { duration });
        await writeAudit(this.heart, { actorId, action: 'member.mute', target: userId, meta: { guildIds, duration, reason } });
        ok(res, { userId, results });
    }

    private async unmute(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const { userId } = req.params;
        const guildIds = toStringArray(req.body?.guildIds);
        if (guildIds.length === 0) throw new HttpError(400, 'bad_request', 'guildIds must be a non-empty array.');

        const results = await this.forEachGuild(guildIds, (gid) => unmuteMember(this.heart, gid, userId));
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'member.unmute', target: userId, meta: { guildIds } });
        ok(res, { userId, results });
    }

    private async getNotes(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const db = await ensureDashboardAdapter();
        let rows: unknown[] = [];
        if (db.engine === 'mongo') {
            rows = await (await dashMongo('dash_member_notes')).find({ userId: req.params.userId, guildId: null });
        } else {
            rows = await dashAll(
                `SELECT id, content, authorId, createdAt FROM dash_member_notes WHERE userId = ? AND guildId IS NULL ORDER BY createdAt DESC`,
                [req.params.userId],
            );
        }
        ok(res, rows);
    }

    private async addNote(req: DashRequest<UserParams>, res: Response): Promise<void> {
        const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
        if (!content) throw new HttpError(400, 'bad_request', 'content is required.');

        const id = newId('note');
        const at = Date.now();
        const db = await ensureDashboardAdapter();
        if (db.engine === 'mongo') {
            await (await dashMongo('dash_member_notes')).insertOne({
                _id: id,
                id,
                userId: req.params.userId,
                guildId: null,
                content,
                authorId: req.dashSession!.payload.userId,
                createdAt: at,
            });
        } else {
            await dashRun(
                `INSERT INTO dash_member_notes (id, userId, guildId, content, authorId, createdAt) VALUES (?, ?, NULL, ?, ?, ?)`,
                [id, req.params.userId, content, req.dashSession!.payload.userId, at],
            );
        }

        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'member.note.add', target: req.params.userId, meta: { noteId: id } });
        ok(res, { id, content }, 201);
    }

    private async deleteNote(req: DashRequest<UserNoteParams>, res: Response): Promise<void> {
        const db = await ensureDashboardAdapter();
        let changed = false;
        if (db.engine === 'mongo') {
            const n = await (await dashMongo('dash_member_notes')).deleteOne({
                $and: [
                    { $or: [{ _id: req.params.noteId }, { id: req.params.noteId }] },
                    { userId: req.params.userId },
                    { guildId: null },
                ],
            });
            changed = n > 0;
        } else {
            const before = await dashGet(
                `SELECT id FROM dash_member_notes WHERE id = ? AND userId = ? AND guildId IS NULL`,
                [req.params.noteId, req.params.userId],
            );
            await dashRun(
                `DELETE FROM dash_member_notes WHERE id = ? AND userId = ? AND guildId IS NULL`,
                [req.params.noteId, req.params.userId],
            );
            changed = !!before;
        }
        if (!changed) throw new HttpError(404, 'not_found', 'Note not found.');

        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'member.note.delete', target: req.params.userId, meta: { noteId: req.params.noteId } });
        ok(res, { deleted: true });
    }

    private async forEachGuild(
        guildIds: string[],
        fn: (guildId: string) => Promise<void>,
    ): Promise<Record<string, { ok: boolean; error?: string }>> {
        const results: Record<string, { ok: boolean; error?: string }> = {};
        for (const gid of guildIds) {
            try {
                await fn(gid);
                results[gid] = { ok: true };
            } catch (e) {
                results[gid] = { ok: false, error: (e as Error).message };
            }
        }
        return results;
    }

    private async logInfraction(
        userId: string,
        type: string,
        reason: string | undefined,
        moderatorId: string,
        guildIds: string[],
        meta: Record<string, unknown> = {},
    ): Promise<void> {
        const col = await infractionsCollection(this.heart);
        const ts = Date.now();
        for (const guildId of guildIds.length > 0 ? guildIds : ['global']) {
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
}
