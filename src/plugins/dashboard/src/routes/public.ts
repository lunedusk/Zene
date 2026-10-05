import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { applyGateway } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { dashGet, dashMongo, ensureDashboardAdapter, cmdCounterCollection } from '../lib/db.js';
import { getPublishedOverride } from '../../../dash-data/src/repositories/ownerOverrideRepository.js';
import { normalizePublicSite, PUBLIC_SITE_TARGET, defaultPublicSite } from '../lib/publicSite.js';
import { buildPublicCommandCatalog } from '../lib/publicCommands.js';

export default class PublicRoute extends BaseRoute {
    public readonly basePath = '/api/dash/public';

    /**
     * @openapi
     * /api/dash/public/site:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Published public site configuration
     *     responses:
     *       '200': { description: Public site }
     * /api/dash/public/commands:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Public command catalog from CommandRegistry
     *     responses:
     *       '200': { description: Commands }
     * /api/dash/public/landing-config:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Public landing config
     * /api/dash/public/stats:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Public stats
     * /api/dash/public/bot-info:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Public bot info
     * /api/dash/public/changelog:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Public changelog
     * /api/dash/public/telemetry:
     *   post:
     *     tags: [DashboardPublic]
     *     summary: Best-effort public telemetry intake
     * /api/dash/public/auth-capabilities:
     *   get:
     *     tags: [DashboardPublic]
     *     summary: Auth feature capability flags (not authorization)
     */

    protected register(): void {
        applyGateway(this.heart, this.router);

        this.router.get('/landing-config', this.asyncHandler(guarded(this.heart, this.landingConfig.bind(this))));
        this.router.get('/stats', this.asyncHandler(guarded(this.heart, this.stats.bind(this))));
        this.router.get('/bot-info', this.asyncHandler(guarded(this.heart, this.botInfo.bind(this))));
        this.router.get('/site', this.asyncHandler(guarded(this.heart, this.site.bind(this))));
        this.router.get('/commands', this.asyncHandler(guarded(this.heart, this.commands.bind(this))));
        this.router.get('/changelog', this.asyncHandler(guarded(this.heart, this.changelog.bind(this))));
        this.router.post('/telemetry', this.asyncHandler(guarded(this.heart, this.telemetry.bind(this))));
        this.router.get('/auth-capabilities', this.asyncHandler(guarded(this.heart, this.authCapabilities.bind(this))));
        this.router.get('/pages/:slug', this.asyncHandler(guarded(this.heart, this.publicPage.bind(this))));
    }

    private async site(_req: Request, res: Response): Promise<void> {
        const published = await getPublishedOverride(
            PUBLIC_SITE_TARGET.targetKind,
            PUBLIC_SITE_TARGET.targetKey,
        );
        const config = published
            ? normalizePublicSite(published.payload)
            : defaultPublicSite();
        ok(res, {
            ...config,
            publishedVersion: published?.version ?? null,
            publishedAt: published?.updatedAt ?? null,
        });
    }

    private async commands(_req: Request, res: Response): Promise<void> {
        const catalog = buildPublicCommandCatalog();
        ok(res, catalog);
    }

    private async changelog(_req: Request, res: Response): Promise<void> {
        // Published changelog via owner override if present; never invent releases
        const published = await getPublishedOverride('changelog', 'default');
        const items =
            published && published.payload && typeof published.payload === 'object'
                ? (published.payload as { items?: unknown }).items
                : [];
        ok(res, { items: Array.isArray(items) ? items : [] });
    }

    private async telemetry(req: Request, res: Response): Promise<void> {
        // Accept-only; do not echo secrets; rate-limit is outer middleware responsibility
        const body = req.body;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            const event = typeof (body as { event?: unknown }).event === 'string' ? (body as { event: string }).event : 'unknown';
            if (event.length > 64) throw new HttpError(400, 'bad_request', 'event too long');
        }
        ok(res, { accepted: true }, 202);
    }

    private async authCapabilities(_req: Request, res: Response): Promise<void> {
        // Reflect what this deployment actually exposes — no fake Better Auth claims
        const hasBetterAuthPkg = true; // declared in package.json; runtime server may still be deferred
        ok(res, {
            supportsDiscordOAuth: true,
            supportsPassword: false,
            supportsTotp: false,
            supportsPasskeys: false,
            supportsRecovery: false,
            supportsOidc: false,
            supportsSaml: false,
            betterAuthPackageDeclared: hasBetterAuthPkg,
            betterAuthSessionAuthority: false,
            migrationPhase: 1,
        });
    }

    private async landingConfig(_req: Request, res: Response): Promise<void> {
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
        ok(res, {
            config: JSON.parse(row?.config ?? '{}'),
            updatedAt: row?.updatedAt ?? 0,
        });
    }

    private async stats(_req: Request, res: Response): Promise<void> {
        const client = this.heart.client;
        ok(res, {
            servers: client.guilds.cache.size,
            users: client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0),
            uptimeMs: client.uptime ?? 0,
            commandsExecuted: await this.commandsAllTime(),
        });
    }

    private async botInfo(_req: Request, res: Response): Promise<void> {
        const client = this.heart.client;
        ok(res, {
            name: client.user?.username ?? null,
            avatarUrl: client.user?.displayAvatarURL({ size: 256 }) ?? null,
            inviteUrl: client.user
                ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands`
                : null,
        });
    }

    private async commandsAllTime(): Promise<number> {
        const col = await cmdCounterCollection(this.heart);
        let total = 0;
        for await (const doc of col.scan('', '\uffff')) {
            total += (doc.count as number) ?? 0;
        }
        return total;
    }

    private async publicPage(req: Request, res: Response): Promise<void> {
        const slug = typeof req.params.slug === 'string' ? req.params.slug : '';
        if (!slug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
            throw new HttpError(400, 'bad_request', 'Invalid page slug');
        }
        const reserved = new Set(['login', 'docs', 'changelog', 'commands', 'preview', 'dashboard', 'owner', 'servers', 'account', 'api']);
        if (reserved.has(slug)) {
            throw new HttpError(404, 'not_found', 'Page not found');
        }
        const published = await getPublishedOverride('public_page', slug);
        if (!published) {
            throw new HttpError(404, 'not_found', 'Page not found');
        }
        ok(res, {
            slug,
            payload: published.payload,
            version: published.version,
            updatedAt: published.updatedAt,
        });
    }

}
