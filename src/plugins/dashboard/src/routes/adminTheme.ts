import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireAuthedBit, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, requireBody } from '../lib/http.js';
import { isEnvOwnerUser } from '../lib/owner.js';
import { dashGet, dashAll, dashRun, dashMongo, ensureDashboardAdapter, writeAudit, newId } from '../lib/db.js';
import { BITS } from '../lib/bits.js';

type PresetParams = { presetId: string };


function assertEnvOwner(req: DashRequest): void {
    if (!isEnvOwnerUser(req.dashSession!.payload.userId)) {
        throw new HttpError(403, 'forbidden', 'Theme and landing writes require env BotOwnerIds');
    }
}

export default class AdminThemeRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin';

    
    /**
     * @openapi
     * /api/dash/admin/theme:
     *   get:
     *     tags: [DashboardTheme]
     *     summary: Get theme
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Theme }
     *   put:
     *     tags: [DashboardTheme]
     *     summary: Set theme
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Updated }
     * /api/dash/admin/theme/presets:
     *   get:
     *     tags: [DashboardTheme]
     *     summary: List presets
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Presets }
     *   post:
     *     tags: [DashboardTheme]
     *     summary: Create preset
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '201': { description: Created }
     * /api/dash/admin/theme/presets/{presetId}:
     *   delete:
     *     tags: [DashboardTheme]
     *     summary: Delete preset
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: presetId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200': { description: Deleted }
     * /api/dash/admin/public/landing-config:
     *   get:
     *     tags: [DashboardTheme]
     *     summary: Admin get landing config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Config }
     *   put:
     *     tags: [DashboardTheme]
     *     summary: Admin set landing config
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Saved }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const theme = requireAuthedBit(this.heart, BITS.BOT_THEME_MANAGE);
        const pages = requireAuthedBit(this.heart, BITS.BOT_DASH_PAGES_MANAGE);

        this.router.get('/theme', ...theme, this.asyncHandler(guarded(this.heart, this.getTheme.bind(this))));
        this.router.put('/theme', ...theme, this.asyncHandler(guarded(this.heart, this.putTheme.bind(this))));
        this.router.get('/theme/presets', ...theme, this.asyncHandler(guarded(this.heart, this.listPresets.bind(this))));
        this.router.post('/theme/presets', ...theme, this.asyncHandler(guarded(this.heart, this.savePreset.bind(this))));
        this.router.delete('/theme/presets/:presetId', ...theme, this.asyncHandler(guarded(this.heart, this.deletePreset.bind(this))));

        this.router.get('/public/landing-config', ...pages, this.asyncHandler(guarded(this.heart, this.getLandingConfig.bind(this))));
        this.router.put('/public/landing-config', ...pages, this.asyncHandler(guarded(this.heart, this.putLandingConfig.bind(this))));
    }

    private async getTheme(_req: DashRequest, res: Response): Promise<void> {
        const db = await ensureDashboardAdapter();
        let row: { tokens: string; updatedAt: number } | null = null;
        if (db.engine === 'mongo') {
            const doc = await (await dashMongo('dash_theme')).findOne({ $or: [{ id: 'current' }, { _id: 'current' }] });
            if (doc) row = { tokens: String(doc.tokens ?? '{}'), updatedAt: Number(doc.updatedAt ?? 0) };
        } else {
            row = (await dashGet(`SELECT tokens, updatedAt FROM dash_theme WHERE id = 'current'`)) as {
                tokens: string;
                updatedAt: number;
            } | null;
        }
        if (!row) throw new HttpError(404, 'not_found', 'Theme not initialized.');
        ok(res, { tokens: JSON.parse(row.tokens), updatedAt: row.updatedAt });
    }

    private async putTheme(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'bad_request', 'Body must be a token map object.');
        const payload = JSON.stringify(req.body);
        const at = Date.now();
        const db = await ensureDashboardAdapter();
        if (db.engine === 'mongo') {
            await (await dashMongo('dash_theme')).updateOne(
                { _id: 'current' },
                { $set: { _id: 'current', id: 'current', tokens: payload, updatedAt: at } },
                { upsert: true },
            );
        } else {
            await dashRun(`UPDATE dash_theme SET tokens = ?, updatedAt = ? WHERE id = 'current'`, [payload, at]);
        }
        await writeAudit(this.heart, { actorId: req.dashSession!.payload.userId, action: 'theme.save' });
        ok(res, { saved: true });
    }

    private async listPresets(_req: DashRequest, res: Response): Promise<void> {
        const db = await ensureDashboardAdapter();
        let rows: Array<{ id: string; name: string; tokens: string; createdAt: number }> = [];
        if (db.engine === 'mongo') {
            const docs = await (await dashMongo('dash_theme_presets')).find({});
            rows = docs.map((r) => ({
                id: String(r.id ?? r._id),
                name: String(r.name),
                tokens: String(r.tokens),
                createdAt: Number(r.createdAt),
            }));
        } else {
            rows = (await dashAll(
                `SELECT id, name, tokens, createdAt FROM dash_theme_presets ORDER BY createdAt DESC`,
            )) as typeof rows;
        }
        ok(
            res,
            rows.map((r) => ({ ...r, tokens: JSON.parse(r.tokens) })),
        );
    }

    private async savePreset(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        const body = requireBody<{ name: string }>(req.body, ['name']);
        const db = await ensureDashboardAdapter();
        let tokens = '{}';
        if (db.engine === 'mongo') {
            const cur = await (await dashMongo('dash_theme')).findOne({ $or: [{ id: 'current' }, { _id: 'current' }] });
            tokens = String(cur?.tokens ?? '{}');
        } else {
            const currentTheme = await dashGet(`SELECT tokens FROM dash_theme WHERE id = 'current'`);
            tokens = String(currentTheme?.tokens ?? '{}');
        }

        const id = newId('preset');
        const at = Date.now();
        if (db.engine === 'mongo') {
            await (await dashMongo('dash_theme_presets')).insertOne({
                _id: id,
                id,
                name: body.name,
                tokens,
                createdAt: at,
            });
        } else {
            await dashRun(`INSERT INTO dash_theme_presets (id, name, tokens, createdAt) VALUES (?, ?, ?, ?)`, [
                id,
                body.name,
                tokens,
                at,
            ]);
        }

        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'theme.preset.save',
            target: id,
            meta: { name: body.name },
        });
        ok(res, { id, name: body.name }, 201);
    }

    private async deletePreset(req: DashRequest<PresetParams>, res: Response): Promise<void> {
        assertEnvOwner(req);
        const db = await ensureDashboardAdapter();
        let changed = false;
        if (db.engine === 'mongo') {
            const n = await (await dashMongo('dash_theme_presets')).deleteOne({
                $or: [{ _id: req.params.presetId }, { id: req.params.presetId }],
            });
            changed = n > 0;
        } else {
            const before = await dashGet(`SELECT id FROM dash_theme_presets WHERE id = ?`, [req.params.presetId]);
            await dashRun(`DELETE FROM dash_theme_presets WHERE id = ?`, [req.params.presetId]);
            changed = !!before;
        }
        if (!changed) throw new HttpError(404, 'not_found', 'Preset not found.');
        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'theme.preset.delete',
            target: req.params.presetId,
        });
        ok(res, { deleted: true });
    }

    private async getLandingConfig(_req: DashRequest, res: Response): Promise<void> {
        const db = await ensureDashboardAdapter();
        let row: { config: string; updatedAt: number } | null = null;
        if (db.engine === 'mongo') {
            const doc = await (await dashMongo('dash_landing_config')).findOne({
                $or: [{ id: 'current' }, { _id: 'current' }],
            });
            if (doc) row = { config: String(doc.config ?? '{}'), updatedAt: Number(doc.updatedAt ?? 0) };
        } else {
            row = (await dashGet(`SELECT config, updatedAt FROM dash_landing_config WHERE id = 'current'`)) as {
                config: string;
                updatedAt: number;
            } | null;
        }
        if (!row) throw new HttpError(404, 'not_found', 'Landing config not initialized.');
        ok(res, { config: JSON.parse(row.config), updatedAt: row.updatedAt });
    }

    private async putLandingConfig(req: DashRequest, res: Response): Promise<void> {
        assertEnvOwner(req);
        if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'bad_request', 'Body must be a config object.');
        const payload = JSON.stringify(req.body);
        const at = Date.now();
        const db = await ensureDashboardAdapter();
        if (db.engine === 'mongo') {
            await (await dashMongo('dash_landing_config')).updateOne(
                { _id: 'current' },
                { $set: { _id: 'current', id: 'current', config: payload, updatedAt: at } },
                { upsert: true },
            );
        } else {
            await dashRun(`UPDATE dash_landing_config SET config = ?, updatedAt = ? WHERE id = 'current'`, [
                payload,
                at,
            ]);
        }
        await writeAudit(this.heart, {
            actorId: req.dashSession!.payload.userId,
            action: 'landing-config.save',
        });
        ok(res, { saved: true });
    }
}
