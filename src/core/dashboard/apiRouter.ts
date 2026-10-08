/**
 * Dashboard API contribution routing — ownership from contribution registry.
 */

import type { Request, Response, NextFunction, Router } from 'express';
import express from 'express';
import {
    listContributions,
    resolveContributionByApiPath,
    type DashboardContributionRecord,
} from './contributionRegistry.js';
import {
    getDashboardSessionRecord,
    DASHBOARD_SESSION_COOKIE,
    DashboardAuthError,
} from './authContext.js';
import { authorizeDashboardRequest } from './authorization.js';
import { validateCsrfToken, validateOrigin } from './csrf.js';

export type ContributionHandler = (
    req: Request,
    res: Response,
    contribution: DashboardContributionRecord,
) => void | Promise<void>;

const handlers = new Map<string, ContributionHandler>();

function contributionKey(pluginId: string, contributionId: string): string {
    return `${pluginId}::${contributionId}`;
}

export function registerContributionHandler(
    pluginId: string,
    contributionId: string,
    handler: ContributionHandler,
): void {
    handlers.set(contributionKey(pluginId, contributionId), handler);
}

export function clearContributionHandlers(): void {
    handlers.clear();
}

function readSessionId(req: Request): string | undefined {
    const cookie = req.headers.cookie;
    if (!cookie) return undefined;
    const parts = cookie.split(';').map((p) => p.trim());
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq < 0) continue;
        const name = p.slice(0, eq);
        if (name === DASHBOARD_SESSION_COOKIE.name || name === 'dash_session') {
            return decodeURIComponent(p.slice(eq + 1));
        }
    }
    return undefined;
}

export function createDashboardContributionRouter(options?: {
    allowedOrigins?: readonly string[];
}): Router {
    const router = express.Router();
    const allowedOrigins = options?.allowedOrigins ?? [];

    router.use((req: Request, res: Response, next: NextFunction) => {
        try {
            const apiPath = req.path.startsWith('/') ? req.path : `/${req.path}`;
            // Namespaced: /plugins/:pluginId/... still resolved by contribution path identity
            const contribution = resolveContributionByApiPath(apiPath);
            if (!contribution || contribution.state !== 'active') {
                res.status(404).json({ error: 'contribution_missing' });
                return;
            }
            const sessionId = readSessionId(req);
            const session = sessionId
                ? getDashboardSessionRecord(sessionId)
                : undefined;

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                if (!session) {
                    res.status(401).json({ error: 'unauthenticated' });
                    return;
                }
                if (allowedOrigins.length > 0) {
                    validateOrigin({
                        origin: req.headers.origin,
                        referer: req.headers.referer,
                        allowedOrigins,
                    });
                }
                validateCsrfToken({
                    csrfSecret: session.csrfSecret,
                    sessionId: session.sessionId,
                    token:
                        (req.headers['x-csrf-token'] as string | undefined) ??
                        (req.body as { csrfToken?: string } | undefined)?.csrfToken,
                });
            }

            const auth = authorizeDashboardRequest({
                session,
                apiPath,
                requestedGuildId:
                    typeof req.query.guildId === 'string'
                        ? req.query.guildId
                        : undefined,
                clientClaims: {
                    userId:
                        typeof req.headers['x-user-id'] === 'string'
                            ? req.headers['x-user-id']
                            : undefined,
                    guildId:
                        typeof req.headers['x-guild-id'] === 'string'
                            ? req.headers['x-guild-id']
                            : undefined,
                    pluginId:
                        typeof req.headers['x-plugin-id'] === 'string'
                            ? req.headers['x-plugin-id']
                            : undefined,
                    permissionBits:
                        typeof req.headers['x-permission-bits'] === 'string'
                            ? req.headers['x-permission-bits'].split(',')
                            : undefined,
                },
            });

            if (auth.contribution && auth.contribution.pluginId !== contribution.pluginId) {
                res.status(403).json({ error: 'forbidden' });
                return;
            }

            const handler = handlers.get(
                contributionKey(contribution.pluginId, contribution.contributionId),
            );
            if (!handler) {
                res.status(404).json({ error: 'contribution_disabled' });
                return;
            }
            void Promise.resolve(handler(req, res, contribution)).catch((err: unknown) => {
                const code =
                    err instanceof DashboardAuthError ? err.code : 'invalid_request';
                res.status(code === 'unauthenticated' ? 401 : 403).json({ error: code });
            });
        } catch (err: unknown) {
            if (err instanceof DashboardAuthError) {
                const status =
                    err.code === 'unauthenticated' || err.code === 'session_expired'
                        ? 401
                        : err.code === 'csrf_failure' || err.code === 'origin_failure'
                          ? 403
                          : 403;
                res.status(status).json({ error: err.code });
                return;
            }
            next(err);
        }
    });

    return router;
}

export function listApiContributionPaths(): readonly string[] {
    return listContributions({ kind: 'api_route' })
        .map((c) => c.apiPath ?? c.route)
        .filter((p): p is string => typeof p === 'string');
}
