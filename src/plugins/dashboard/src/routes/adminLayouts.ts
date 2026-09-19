import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, requireBody } from '../lib/http.js';
import { writeAudit } from '../lib/db.js';
import type DashDataStoreHandler from '../../../dash-data/src/handlers/store.js';
import type { DashLayoutDoc, LayoutScope } from '../../../dash-data/src/lib/store.js';
import { isEnvOwnerUser, isBotOwnerUser } from '../lib/owner.js';

const SCOPES = new Set<LayoutScope>([
    'public_landing',
    'global_shell',
    'owner_home',
    'server_default',
    'server_guild',
]);

async function requireEnvOwner(req: DashRequest): Promise<void> {
    const userId = req.dashSession!.payload.userId;
    if (isEnvOwnerUser(userId)) {
        return;
    }
    throw new HttpError(403, 'forbidden', 'Layout authoring requires env BotOwnerIds');
}

function parseScope(raw: unknown): LayoutScope {
    if (typeof raw !== 'string' || !SCOPES.has(raw as LayoutScope)) {
        throw new HttpError(400, 'bad_request', 'Invalid layout scope');
    }
    return raw as LayoutScope;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateGrid(grid: unknown): Record<string, unknown> {
    if (!isRecord(grid)) throw new HttpError(400, 'bad_request', 'grid must be an object');
    const cols = grid.cols;
    const rowHeight = grid.rowHeight;
    const items = grid.items;
    if (typeof cols !== 'number' || cols < 1 || cols > 24) {
        throw new HttpError(400, 'bad_request', 'grid.cols must be 1–24');
    }
    if (typeof rowHeight !== 'number' || rowHeight < 8 || rowHeight > 400) {
        throw new HttpError(400, 'bad_request', 'grid.rowHeight invalid');
    }
    if (!Array.isArray(items)) throw new HttpError(400, 'bad_request', 'grid.items must be an array');
    for (const it of items) {
        if (!isRecord(it)) throw new HttpError(400, 'bad_request', 'invalid grid item');
        if (typeof it.id !== 'string' || typeof it.surfaceKey !== 'string') {
            throw new HttpError(400, 'bad_request', 'grid item needs id and surfaceKey');
        }
        for (const k of ['x', 'y', 'w', 'h'] as const) {
            if (typeof it[k] !== 'number' || !Number.isFinite(it[k] as number)) {
                throw new HttpError(400, 'bad_request', `grid item ${k} must be a number`);
            }
        }
    }
    return grid;
}

export default class AdminLayoutsRoute extends BaseRoute {
    public readonly basePath = '/api/dash/admin/layouts';

    private store(): DashDataStoreHandler {
        const h = this.heart.system.handler.$get('dash-data', 'store') as DashDataStoreHandler | undefined;
        if (!h) throw new HttpError(503, 'unavailable', 'dash-data store handler unavailable');
        return h;
    }

    
    /**
     * @openapi
     * /api/dash/admin/layouts:
     *   get:
     *     tags: [DashboardLayouts]
     *     summary: List layouts
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Layouts }
     *   put:
     *     tags: [DashboardLayouts]
     *     summary: Upsert layout
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Saved }
     * /api/dash/admin/layouts/can-author:
     *   get:
     *     tags: [DashboardLayouts]
     *     summary: Whether caller may author layouts
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Capability }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const sess = requireSession(this.heart);

        this.router.get('/', sess, this.asyncHandler(guarded(this.heart, this.get.bind(this))));
        this.router.put('/', sess, this.asyncHandler(guarded(this.heart, this.put.bind(this))));
        this.router.get('/can-author', sess, this.asyncHandler(guarded(this.heart, this.canAuthor.bind(this))));
    }

    private async canAuthor(req: DashRequest, res: Response): Promise<void> {
        const userId = req.dashSession!.payload.userId;
        ok(res, {
            canAuthor: isEnvOwnerUser(userId),
            envOwner: isEnvOwnerUser(userId),
            botOwner: await isBotOwnerUser(userId),
            userId,
        });
    }

    private async get(req: DashRequest, res: Response): Promise<void> {
        const scope = parseScope(req.query.scope);
        const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
        if (scope === 'server_guild' && !guildId) {
            throw new HttpError(400, 'bad_request', 'guildId required for server_guild scope');
        }
        const doc = await this.store().getLayout(scope, guildId);
        ok(res, doc);
    }

    private async put(req: DashRequest, res: Response): Promise<void> {
        await requireEnvOwner(req);
        const body = requireBody<{
            id: string;
            scope: string;
            name: string;
            grid: unknown;
            guildId?: string | null;
            version?: number;
            schemaVersion?: number;
            navOrder?: string[] | null;
            themeOverrideId?: string | null;
        }>(req.body, ['id', 'scope', 'name', 'grid']);

        const scope = parseScope(body.scope);
        const guildId =
            body.guildId === null || body.guildId === undefined || body.guildId === ''
                ? null
                : String(body.guildId);
        if (scope === 'server_guild' && !guildId) {
            throw new HttpError(400, 'bad_request', 'guildId required for server_guild scope');
        }

        const grid = validateGrid(body.grid);
        const userId = req.dashSession!.payload.userId;
        const now = Date.now();
        const existing = await this.store().getLayout(scope, guildId ?? undefined);
        const version =
            typeof body.version === 'number' && body.version > 0
                ? body.version
                : (existing?.version ?? 0) + 1;

        const doc: DashLayoutDoc = {
            id: String(body.id),
            scope,
            guildId,
            name: String(body.name),
            version,
            schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : 1,
            grid,
            navOrder: Array.isArray(body.navOrder) ? body.navOrder.map(String) : null,
            themeOverrideId:
                body.themeOverrideId === undefined || body.themeOverrideId === null
                    ? null
                    : String(body.themeOverrideId),
            updatedAt: now,
            updatedBy: userId,
        };

        await this.store().putLayout(doc);
        await writeAudit(this.heart, {
            actorId: userId,
            action: 'layout.put',
            target: doc.id,
            guildId: guildId ?? undefined,
            meta: { scope },
        });
        try {
            this.heart.system.events.emit('dash.layout.updated', {
                scope,
                guildId: guildId ?? undefined,
            });
        } catch {
        }
        ok(res, doc);
    }
}
