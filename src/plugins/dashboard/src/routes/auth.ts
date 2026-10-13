import { BaseRoute } from '#core/bases/Route.js';
import { type Request, type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError } from '../lib/http.js';
import { isGloballyBanned } from '../lib/db.js';
import { isBotOwnerFromBits, isEnvOwnerUser } from '../lib/owner.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';
import {
    establishCoreSessionFromLogin,
    logoutCoreDashboardSession,
    invalidateRealtimeForSession,
    beginOAuthTransaction,
    consumeOAuthCallback,
    exchangeAuthorizationCode,
    DashboardAuthError,
} from '#core/dashboard/index.js';
import { secrets } from '#core/helpers/secretManager.js';
import { rateLimit } from '#core/dashboard/rateLimit.js';

interface DiscordMeResponse {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
}

interface DiscordGuildPartial {
    id: string;
    name?: string;
    owner?: boolean;
    permissions?: string;
}

function readAllowedRedirectUris(): string[] {
    const raw =
        secrets.getOptional('DashboardOAuthRedirectUris') ??
        secrets.getOptional('DiscordOAuthRedirectUri') ??
        '';
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function readOAuthClient(): { clientId: string; clientSecret: string } {
    const clientId =
        secrets.getOptional('DiscordOAuthClientId') ??
        secrets.getOptional('DiscordClientId') ??
        secrets.getOptional('ClientID') ??
        '';
    const clientSecret =
        secrets.getOptional('DiscordOAuthClientSecret') ??
        secrets.getOptional('DiscordClientSecret') ??
        '';
    return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

async function fetchDiscordIdentity(accessToken: string): Promise<{
    me: DiscordMeResponse;
    guildIds: string[];
}> {
    const meRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
        throw new HttpError(401, 'invalid_discord_token', 'Could not verify Discord identity.');
    }
    const me = (await meRes.json()) as DiscordMeResponse;

    const guildIds: string[] = [];
    let after: string | undefined;
    // Paginate /users/@me/guilds completely.
    for (let page = 0; page < 20; page++) {
        const url = new URL('https://discord.com/api/v10/users/@me/guilds');
        url.searchParams.set('limit', '200');
        if (after) url.searchParams.set('after', after);
        const gRes = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!gRes.ok) break;
        const batch = (await gRes.json()) as DiscordGuildPartial[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const g of batch) {
            if (typeof g.id === 'string') guildIds.push(g.id);
        }
        after = batch[batch.length - 1]?.id;
        if (batch.length < 200) break;
    }

    return { me, guildIds };
}

export default class AuthRoute extends BaseRoute {
    public readonly basePath = '/api/dash/auth';

    private get permissions(): PermissionsHandler | undefined {
        return this.heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
    }

    /**
     * @openapi
     * /api/dash/auth/oauth/start:
     *   get:
     *     tags: [DashboardAuth]
     *     summary: Begin Discord OAuth authorization-code + PKCE
     * /api/dash/auth/oauth/callback:
     *   get:
     *     tags: [DashboardAuth]
     *     summary: Complete OAuth callback; sets HttpOnly session cookie
     * /api/dash/auth/permissions:
     *   get:
     *     tags: [DashboardAuth]
     *     summary: Current session permission bits
     * /api/dash/auth/session-check:
     *   get:
     *     tags: [DashboardAuth]
     *     summary: Validate Core session cookie
     * /api/dash/auth/logout:
     *   post:
     *     tags: [DashboardAuth]
     *     summary: Revoke session and clear cookie
     */
    protected register(): void {
        applyGateway(this.heart, this.router);

        this.router.get(
            '/oauth/start',
            this.asyncHandler(guarded(this.heart, this.oauthStart.bind(this))),
        );
        this.router.get(
            '/oauth/callback',
            this.asyncHandler(guarded(this.heart, this.oauthCallback.bind(this))),
        );
        this.router.get(
            '/permissions',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.permissionsFor.bind(this))),
        );
        this.router.get(
            '/session-check',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.sessionCheck.bind(this))),
        );
        this.router.get(
            '/csrf',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.csrfToken.bind(this))),
        );
        this.router.post(
            '/logout',
            requireSession(this.heart),
            this.asyncHandler(guarded(this.heart, this.logout.bind(this))),
        );
    }

    private async csrfToken(req: DashRequest, res: Response): Promise<void> {
        const { getDashboardSessionRecord, issueCsrfToken } = await import(
            '#core/dashboard/index.js'
        );
        const coreId = req.coreSessionId;
        if (!coreId) {
            throw new HttpError(401, 'core_session_required', 'Core dashboard session required');
        }
        const rec = getDashboardSessionRecord(coreId);
        if (!rec || rec.revoked) {
            throw new HttpError(401, 'unauthorized', 'Session invalid');
        }
        ok(res, {
            csrfToken: issueCsrfToken(rec.csrfSecret, rec.sessionId),
        });
    }

    private async oauthStart(req: Request, res: Response): Promise<void> {
        const rl = rateLimit({
            key: `dash-oauth-start:${req.ip ?? 'unknown'}`,
            windowMs: 60_000,
            limit: 20,
        });
        if (!rl.allowed) {
            throw new HttpError(429, 'rate_limited', 'Too many login attempts. Try again later.');
        }

        const { clientId, clientSecret } = readOAuthClient();
        if (!clientId || !clientSecret) {
            throw new HttpError(
                503,
                'oauth_not_configured',
                'Discord OAuth is not configured (DiscordOAuthClientId / DiscordOAuthClientSecret).',
            );
        }

        const allowed = readAllowedRedirectUris();
        if (allowed.length === 0) {
            throw new HttpError(
                503,
                'oauth_not_configured',
                'No DashboardOAuthRedirectUris / DiscordOAuthRedirectUri configured.',
            );
        }

        const requested =
            typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : allowed[0]!;
        if (!allowed.includes(requested)) {
            throw new HttpError(400, 'invalid_redirect', 'Redirect URI is not pre-registered.');
        }

        try {
            const tx = beginOAuthTransaction({
                redirectUri: requested,
                allowedRedirectUris: allowed,
                scopes: ['identify', 'guilds'],
            });
            const params = new URLSearchParams({
                client_id: clientId,
                response_type: 'code',
                scope: tx.scopes.join(' '),
                state: tx.state,
                code_challenge: tx.codeChallenge,
                code_challenge_method: 'S256',
                redirect_uri: tx.redirectUri,
                prompt: 'none',
            });
            // prompt=none can fail for first login; use consent-friendly default without forcing none
            params.delete('prompt');
            const authorizationUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
            ok(res, {
                authorizationUrl,
                state: tx.state,
                redirectUri: tx.redirectUri,
            });
        } catch (e: unknown) {
            if (e instanceof DashboardAuthError) {
                throw new HttpError(400, e.code, e.message);
            }
            throw e;
        }
    }

    private async oauthCallback(req: Request, res: Response): Promise<void> {
        const rl = rateLimit({
            key: `dash-oauth-callback:${req.ip ?? 'unknown'}`,
            windowMs: 60_000,
            limit: 30,
        });
        if (!rl.allowed) {
            throw new HttpError(429, 'rate_limited', 'Too many callback attempts. Try again later.');
        }

        const state = typeof req.query.state === 'string' ? req.query.state : '';
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const redirectUri =
            typeof req.query.redirect_uri === 'string'
                ? req.query.redirect_uri
                : readAllowedRedirectUris()[0] ?? '';

        if (!state || !code) {
            throw new HttpError(400, 'bad_request', 'Missing OAuth state or code.');
        }

        const { clientId, clientSecret } = readOAuthClient();
        if (!clientId || !clientSecret) {
            throw new HttpError(
                503,
                'oauth_not_configured',
                'Discord OAuth is not configured.',
            );
        }

        let codeVerifier: string;
        let scopes: readonly string[];
        try {
            const consumed = consumeOAuthCallback({ state, code, redirectUri });
            codeVerifier = consumed.codeVerifier;
            scopes = consumed.scopes;
        } catch (e: unknown) {
            if (e instanceof DashboardAuthError) {
                throw new HttpError(400, e.code, e.message);
            }
            throw e;
        }

        let tokenRes;
        try {
            tokenRes = await exchangeAuthorizationCode({
                code,
                codeVerifier,
                redirectUri,
                clientId,
                clientSecret,
            });
        } catch (e: unknown) {
            if (e instanceof DashboardAuthError) {
                throw new HttpError(401, e.code, e.message);
            }
            throw e;
        }

        const { me, guildIds } = await fetchDiscordIdentity(tokenRes.access_token);

        if (await isGloballyBanned(this.heart, me.id)) {
            throw new HttpError(403, 'banned', 'This account is banned from the dashboard.');
        }

        const perms = this.permissions;
        let bits: string[] = [];
        if (perms) {
            try {
                const resolved = await perms.resolve(me.id, undefined, undefined);
                bits = [...resolved.bits];
            } catch {
                bits = [];
            }
        }

        const sessionCfg = this.heart.assets.config.get('session') as { ttlSeconds?: number } | undefined;
        const ttlMs =
            typeof sessionCfg?.ttlSeconds === 'number' && sessionCfg.ttlSeconds > 0
                ? sessionCfg.ttlSeconds * 1000
                : undefined;

        const coreLogin = establishCoreSessionFromLogin({
            userId: me.id,
            providerUserId: me.id,
            bits,
            guildIds,
            isEnvOwner: isEnvOwnerUser(me.id),
            authorizedScopes: [...scopes],
            ttlMs,
        });

        res.setHeader('Set-Cookie', coreLogin.setCookie);
        // Never return coreSessionId, service keys, or Discord tokens to the browser.
        ok(res, {
            profile: {
                id: me.id,
                username: me.username,
                displayName: me.global_name ?? me.username,
                avatarUrl: me.avatar
                    ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
                    : null,
            },
            bits,
            isBotOwner: isBotOwnerFromBits(me.id, bits),
            envOwner: isEnvOwnerUser(me.id),
            expiresAt: Math.floor(coreLogin.record.expiresAt / 1000),
            guildCount: guildIds.length,
        });
    }

    private async permissionsFor(req: DashRequest, res: Response): Promise<void> {
        const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
        const perms = this.permissions;
        if (!perms) throw new HttpError(500, 'internal', 'Permissions handler unavailable.');

        const userId = req.dashSession!.payload.userId;
        // Guild selector is validated against authoritative membership on the Core session.
        if (guildId) {
            const { getDashboardSessionRecord } = await import('#core/dashboard/index.js');
            const core = req.coreSessionId
                ? getDashboardSessionRecord(req.coreSessionId)
                : undefined;
            const membership = core?.principal.guildIds ?? [];
            if (!membership.includes(guildId)) {
                throw new HttpError(403, 'forbidden', 'Not a member of the requested guild.');
            }
        }
        const guildOwnerId = guildId
            ? this.heart.client.guilds.cache.get(guildId)?.ownerId
            : undefined;
        const resolved = await perms.resolve(userId, guildId, guildOwnerId);
        ok(res, {
            ...resolved,
            bits: [...resolved.bits],
            envOwner: isEnvOwnerUser(userId),
        });
    }

    private async sessionCheck(req: DashRequest, res: Response): Promise<void> {
        const banned = await isGloballyBanned(this.heart, req.dashSession!.payload.userId);
        if (banned) throw new HttpError(403, 'banned', 'This account is banned from the dashboard.');
        ok(res, {
            valid: true,
            userId: req.dashSession!.payload.userId,
            expiresAt: req.dashSession!.payload.exp,
        });
    }

    private async logout(req: Request, res: Response): Promise<void> {
        const cookie = req.headers.cookie;
        let coreId: string | undefined;
        if (typeof cookie === 'string') {
            for (const part of cookie.split(';')) {
                const [k, ...rest] = part.trim().split('=');
                if (k === '__Host-zene_dash_session' || k === 'dash_session') {
                    coreId = decodeURIComponent(rest.join('=') || '');
                }
            }
        }
        if (coreId) {
            invalidateRealtimeForSession(coreId);
            logoutCoreDashboardSession(coreId);
        }
        const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
        const clear =
            isProd
                ? '__Host-zene_dash_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
                : 'dash_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
        res.setHeader('Set-Cookie', clear);
        ok(res, { loggedOut: true });
    }
}
