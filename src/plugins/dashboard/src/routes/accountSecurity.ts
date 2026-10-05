/**
 * Phase 4 — Account security HTTP API (/api/dash/account/*).
 *
 * @openapi
 * tags:
 *   - name: DashboardAccount
 *     description: Session, device, MFA, and passkey management (auth via session; authz via Zene)
 */

import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, requireBody } from '../lib/http.js';
import { buildRequestContext, ServiceError, unwrapServiceResult } from '../lib/requestContext.js';
import { accountSecurityService } from '../services/accountSecurityService.js';
import { rateLimit } from '../lib/rateLimit/middleware.js';

function sendService(_res: Response, err: unknown): void {
    if (err instanceof ServiceError) {
        throw new HttpError(err.httpStatus, err.code.toLowerCase(), err.message);
    }
    throw err;
}

export default class AccountSecurityRoute extends BaseRoute {
    public readonly basePath = '/api/dash/account';

    /**
     * @openapi
     * /api/dash/account/sessions:
     *   get:
     *     tags: [DashboardAccount]
     *     summary: List sessions for the authenticated user
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Session list }
     *       '401': { description: Unauthenticated }
     * /api/dash/account/sessions/{sessionId}:
     *   delete:
     *     tags: [DashboardAccount]
     *     summary: Revoke a session
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/sessions/others:
     *   delete:
     *     tags: [DashboardAccount]
     *     summary: Revoke all sessions except current
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/devices:
     *   get:
     *     tags: [DashboardAccount]
     *     summary: List devices
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/mfa:
     *   get:
     *     tags: [DashboardAccount]
     *     summary: MFA status
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/mfa/totp/begin:
     *   post:
     *     tags: [DashboardAccount]
     *     summary: Begin TOTP enrollment
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/mfa/totp/confirm:
     *   post:
     *     tags: [DashboardAccount]
     *     summary: Confirm TOTP enrollment
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/passkeys:
     *   get:
     *     tags: [DashboardAccount]
     *     summary: List passkeys
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/passkeys/register/begin:
     *   post:
     *     tags: [DashboardAccount]
     *     summary: Begin WebAuthn registration
     *     security: [{ bearerAuth: [] }]
     * /api/dash/account/login-history:
     *   get:
     *     tags: [DashboardAccount]
     *     summary: Recent login history
     *     security: [{ bearerAuth: [] }]
     */
    protected register(): void {
        applyGateway(this.heart, this.router);
        const sess = requireSession(this.heart);
        const secure = rateLimit('sensitive_mutation');
        const authn = rateLimit('authentication');

        this.router.get('/sessions', sess, this.asyncHandler(guarded(this.heart, this.listSessions.bind(this))));
        this.router.delete(
            '/sessions/others',
            sess,
            secure,
            this.asyncHandler(guarded(this.heart, this.revokeOthers.bind(this))),
        );
        this.router.delete(
            '/sessions/:sessionId',
            sess,
            secure,
            this.asyncHandler(guarded(this.heart, this.revokeSession.bind(this))),
        );
        this.router.get('/devices', sess, this.asyncHandler(guarded(this.heart, this.listDevices.bind(this))));
        this.router.delete(
            '/devices/:deviceId',
            sess,
            secure,
            this.asyncHandler(guarded(this.heart, this.revokeDevice.bind(this))),
        );
        this.router.get('/mfa', sess, this.asyncHandler(guarded(this.heart, this.mfaStatus.bind(this))));
        this.router.post(
            '/mfa/totp/begin',
            sess,
            authn,
            this.asyncHandler(guarded(this.heart, this.totpBegin.bind(this))),
        );
        this.router.post(
            '/mfa/totp/confirm',
            sess,
            authn,
            this.asyncHandler(guarded(this.heart, this.totpConfirm.bind(this))),
        );
        this.router.post(
            '/mfa/disable',
            sess,
            secure,
            this.asyncHandler(guarded(this.heart, this.mfaDisable.bind(this))),
        );
        this.router.get('/passkeys', sess, this.asyncHandler(guarded(this.heart, this.listPasskeys.bind(this))));
        this.router.post(
            '/passkeys/register/begin',
            sess,
            authn,
            this.asyncHandler(guarded(this.heart, this.passkeyBegin.bind(this))),
        );
        this.router.post(
            '/passkeys/register/complete',
            sess,
            authn,
            this.asyncHandler(guarded(this.heart, this.passkeyComplete.bind(this))),
        );
        this.router.delete(
            '/passkeys/:credentialId',
            sess,
            secure,
            this.asyncHandler(guarded(this.heart, this.passkeyRevoke.bind(this))),
        );
        this.router.get(
            '/login-history',
            sess,
            this.asyncHandler(guarded(this.heart, this.loginHistory.bind(this))),
        );
    }

    private async listSessions(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.listSessions(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async revokeSession(req: DashRequest<{ sessionId: string }>, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.revokeSession(ctx, req.params.sessionId);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async revokeOthers(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const current = req.dashSession?.payload.jti ?? '';
            const result = await accountSecurityService.revokeOtherSessions(ctx, current);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async listDevices(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.listDevices(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async revokeDevice(req: DashRequest<{ deviceId: string }>, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.revokeDevice(ctx, req.params.deviceId);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async mfaStatus(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.getMfaStatus(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async totpBegin(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.beginTotpEnrollment(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async totpConfirm(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ enrollmentId: string; code: string }>(req.body, ['enrollmentId', 'code']);
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.confirmTotpEnrollment(
                ctx,
                body.enrollmentId,
                body.code,
            );
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async mfaDisable(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ code: string }>(req.body, ['code']);
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.disableMfa(ctx, body.code);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async listPasskeys(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.listPasskeys(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async passkeyBegin(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.beginPasskeyRegistration(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async passkeyComplete(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ challengeId: string; credentialId: string; name?: string }>(req.body, [
            'challengeId',
            'credentialId',
        ]);
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.completePasskeyRegistration(
                ctx,
                body.challengeId,
                body.credentialId,
                body.name,
            );
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async passkeyRevoke(req: DashRequest<{ credentialId: string }>, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.revokePasskey(ctx, req.params.credentialId);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }

    private async loginHistory(req: DashRequest, res: Response): Promise<void> {
        try {
            const ctx = await buildRequestContext(req);
            const result = await accountSecurityService.loginHistory(ctx);
            ok(res, unwrapServiceResult(result), 200, { requestId: ctx.requestId });
        } catch (e) {
            sendService(res, e);
        }
    }
}
