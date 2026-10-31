import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { ok, guarded, HttpError } from '../lib/http.js';
import { isEnvOwnerUser, envOwnerIds } from '../lib/owner.js';
import type { DashRequest } from '../lib/authz.js';
import { establishCoreSessionFromLogin } from '#core/dashboard/index.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';

/**
 * Development-only session bootstrap.
 *
 * Purpose: exercise the real dashboard (real session cookie, real CSRF, real
 * authorization) without an interactive Discord OAuth round trip.
 *
 * Hard gates:
 *  - NODE_ENV must be exactly `development`
 *  - DASH_DEV_LOGIN must be `1`
 *  - the requested user must be listed in BotOwnerIds
 *  - the request must be same-origin
 *
 * This route deliberately does not call applyGateway: the generic dashboard
 * mutation guard requires an existing session cookie, which is the very thing
 * this endpoint establishes. The origin check below replaces CSRF for this
 * single development-only bootstrap call. In production the route is 404.
 */
export default class DevSessionRoute extends BaseRoute {
    public readonly basePath = '/api/dash/dev';

    protected register(): void {
        this.router.post(
            '/session',
            this.asyncHandler(guarded(this.heart, this.createSession.bind(this))),
        );
    }

    private enabled(): boolean {
        return (
            (process.env['NODE_ENV'] ?? '').trim().toLowerCase() === 'development' &&
            (process.env['DASH_DEV_LOGIN'] ?? '').trim() === '1'
        );
    }

    private assertSameOrigin(req: DashRequest): void {
        const origin = req.header('origin');
        const host = req.get('host');
        if (!host) throw new HttpError(400, 'bad_request', 'Host header required');
        if (!origin) {
            throw new HttpError(403, 'origin_failure', 'Origin header required');
        }
        let parsed: URL;
        try {
            parsed = new URL(origin);
        } catch {
            throw new HttpError(403, 'origin_failure', 'Invalid Origin header');
        }
        if (parsed.host !== host) {
            throw new HttpError(403, 'origin_failure', 'Cross-origin development login is not allowed');
        }
    }

    private async createSession(req: DashRequest, res: Response): Promise<void> {
        if (!this.enabled()) {
            // Behave as if the route does not exist.
            throw new HttpError(404, 'not_found', 'Not found');
        }
        this.assertSameOrigin(req);

        const requested =
            req.body && typeof req.body === 'object' && typeof req.body.userId === 'string'
                ? req.body.userId
                : envOwnerIds()[0];
        if (!requested || !isEnvOwnerUser(requested)) {
            throw new HttpError(403, 'forbidden', 'Development sessions require an env BotOwnerIds user');
        }

        const perms = this.heart.system.handler.$get('permissions', 'manager') as
            | PermissionsHandler
            | undefined;
        let bits: string[] = [];
        if (perms) {
            try {
                const resolved = await perms.resolve(requested, undefined, undefined);
                bits = [...resolved.bits];
            } catch {
                bits = [];
            }
        }

        const login = establishCoreSessionFromLogin({
            userId: requested,
            providerUserId: requested,
            bits,
            guildIds: [],
            isEnvOwner: true,
            authorizedScopes: ['identify', 'guilds'],
        });

        res.setHeader('Set-Cookie', login.setCookie);
        res.setHeader('Cache-Control', 'no-store');
        ok(res, {
            devSession: true,
            userId: requested,
            envOwner: true,
            bits,
            expiresAt: Math.floor(login.record.expiresAt / 1000),
        });
    }
}
