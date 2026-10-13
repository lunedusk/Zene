import { BaseRoute } from '#core/bases/Route.js';
import { type Response } from 'express';
import { applyGateway, requireSession, type DashRequest } from '../lib/authz.js';
import { ok, guarded, HttpError, requireBody } from '../lib/http.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';
import { isBotOwnerFromBits } from '../lib/owner.js';
import type { Bit } from '#core/manager/token.js';
import { tryTokens } from '../lib/tokens.js';
import { buildRegistrySnapshot } from '../lib/dashRegistry.js';
import { computeSurfaceGrants, hasCapability } from '../lib/brokerGrants.js';
import { assertPathAllowed, PathAllowError } from '../lib/brokerPath.js';
import {
    BROKER_LIMITS,
    isSurfaceDisposed,
    recordBrokerMessage,
    disposeSurface,
} from '../lib/brokerLimits.js';
import { issueFrameNonce, bindFrameOnReady, getBoundFrame, revokeFrame } from '../lib/brokerNonce.js';

function resolveBits(req: DashRequest, _heart: DashRequest['dashSession'] extends never ? never : import('#core/heart/index.js').IHeart): Set<string> {
    const session = req.dashSession!;
    const bits = new Set<string>((session.payload.bits ?? []).map(String));
    return bits;
}

export default class BrokerRoute extends BaseRoute {
    public readonly basePath = '/api/dash/broker';

    
    /**
     * @openapi
     * /api/dash/broker/session:
     *   post:
     *     tags: [DashboardBroker]
     *     summary: Create broker session
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Session }
     * /api/dash/broker/ready:
     *   post:
     *     tags: [DashboardBroker]
     *     summary: Mark session ready
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: OK }
     * /api/dash/broker/proxy:
     *   post:
     *     tags: [DashboardBroker]
     *     summary: Proxy request through broker
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Proxied response }
     * /api/dash/broker/dispose:
     *   post:
     *     tags: [DashboardBroker]
     *     summary: Dispose broker session
     *     security: [{ bearerAuth: [] }]
     *     responses:
     *       '200': { description: Disposed }
     */

protected register(): void {
        applyGateway(this.heart, this.router);
        const sess = requireSession(this.heart);

        this.router.post(
            '/session',
            sess,
            this.asyncHandler(guarded(this.heart, this.openSession.bind(this))),
        );
        this.router.post(
            '/ready',
            sess,
            this.asyncHandler(guarded(this.heart, this.ready.bind(this))),
        );
        this.router.post(
            '/proxy',
            sess,
            this.asyncHandler(guarded(this.heart, this.proxy.bind(this))),
        );
        this.router.post(
            '/dispose',
            sess,
            this.asyncHandler(guarded(this.heart, this.dispose.bind(this))),
        );
    }

    private bitsFor(req: DashRequest): Set<string> {
        const bits = resolveBits(req, this.heart);
        const t = tryTokens(this.heart);
        if (t?.hasBit(req.dashSession!, BOT_OWNER_BIT as Bit)) {
            bits.add(BOT_OWNER_BIT);
        }
        return bits;
    }

    private meta(req: DashRequest): {
        userId: string;
        jti: string;
        bits: Set<string>;
        isEnvOwner: boolean;
    } {
        const session = req.dashSession!;
        const userId = session.payload.userId;
        const bits = this.bitsFor(req);
        return {
            userId,
            jti: String(session.payload.jti),
            bits,
            isEnvOwner: isBotOwnerFromBits(userId, bits),
        };
    }

    private async openSession(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ pluginId: string; surfaceId: string }>(req.body, [
            'pluginId',
            'surfaceId',
        ]);
        const pluginId = String(body.pluginId);
        const surfaceId = String(body.surfaceId);
        const meta = this.meta(req);

        const snap = await buildRegistrySnapshot({
            bits: meta.bits,
            userId: meta.userId,
            isEnvOwner: meta.isEnvOwner,
        });
        const plugin = snap.plugins.find((p) => p.pluginId === pluginId);
        const surface = plugin?.surfaces.find((s) => s.id === surfaceId);
        if (!surface) {
            throw new HttpError(404, 'not_found', 'surface not in registry for this session');
        }

        const grants = computeSurfaceGrants({
            bits: meta.bits,
            userId: meta.userId,
            isEnvOwner: meta.isEnvOwner,
            pluginId,
            surface,
        });
        if (grants.capabilities.length === 0) {
            throw new HttpError(403, 'forbidden', 'no capabilities for surface');
        }

        const frame = issueFrameNonce({
            sessionJti: meta.jti,
            userId: meta.userId,
            pluginId,
            surfaceId,
        });

        ok(res, {
            nonce: frame.nonce,
            expiresAt: frame.expiresAt,
            capabilities: grants.capabilities,
            pathPatterns: grants.pathPatterns,
            limits: {
                maxMessagesPerWindow: BROKER_LIMITS.maxMessagesPerWindow,
                windowMs: BROKER_LIMITS.windowMs,
                maxPayloadBytes: BROKER_LIMITS.maxPayloadBytes,
                strikesToDispose: BROKER_LIMITS.strikesToDispose,
            },
        });
    }

    private async ready(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ nonce: string; pluginId: string; surfaceId: string }>(req.body, [
            'nonce',
            'pluginId',
            'surfaceId',
        ]);
        const meta = this.meta(req);
        const binding = bindFrameOnReady(String(body.nonce), {
            sessionJti: meta.jti,
            pluginId: String(body.pluginId),
            surfaceId: String(body.surfaceId),
        });
        if (!binding) {
            throw new HttpError(403, 'forbidden', 'nonce bind failed');
        }
        ok(res, { bound: true, pluginId: binding.pluginId, surfaceId: binding.surfaceId });
    }

    private async proxy(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{
            nonce: string;
            method?: string;
            path: string;
            capability?: string;
        }>(req.body, ['nonce', 'path']);
        const nonce = String(body.nonce);
        const method = String(body.method ?? 'GET').toUpperCase();
        const rawPath = String(body.path);
        const capability = body.capability !== undefined ? String(body.capability) : '';

        const frame = getBoundFrame(nonce);
        if (!frame) {
            throw new HttpError(403, 'forbidden', 'frame not bound or nonce invalid');
        }
        const meta = this.meta(req);
        if (frame.sessionJti !== meta.jti) {
            throw new HttpError(403, 'forbidden', 'frame session mismatch');
        }
        if (isSurfaceDisposed(frame.sessionJti, frame.pluginId, frame.surfaceId)) {
            throw new HttpError(403, 'forbidden', 'surface disposed');
        }

        const payloadBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
        const rate = recordBrokerMessage(
            frame.sessionJti,
            frame.pluginId,
            frame.surfaceId,
            payloadBytes,
        );
        if (!rate.ok) {
            throw new HttpError(429, rate.code, `broker limit: ${rate.code}`, {
                strike: rate.strike,
                disposed: isSurfaceDisposed(frame.sessionJti, frame.pluginId, frame.surfaceId),
            });
        }

        const snap = await buildRegistrySnapshot({
            bits: meta.bits,
            userId: meta.userId,
            isEnvOwner: meta.isEnvOwner,
        });
        const plugin = snap.plugins.find((p) => p.pluginId === frame.pluginId);
        const surface = plugin?.surfaces.find((s) => s.id === frame.surfaceId);
        if (!surface) {
            throw new HttpError(404, 'not_found', 'surface gone from registry');
        }
        const grants = computeSurfaceGrants({
            bits: meta.bits,
            userId: meta.userId,
            isEnvOwner: meta.isEnvOwner,
            pluginId: frame.pluginId,
            surface,
        });

        if (capability && !hasCapability(grants.capabilities, capability)) {
            throw new HttpError(403, 'forbidden', 'missing capability');
        }
        if (method !== 'GET' && method !== 'HEAD' && !hasCapability(grants.capabilities, 'api.write')) {
            throw new HttpError(403, 'forbidden', 'missing capability api.write');
        }
        if ((method === 'GET' || method === 'HEAD') && !hasCapability(grants.capabilities, 'api.read')) {
            throw new HttpError(403, 'forbidden', 'missing capability api.read');
        }

        let normalized: string;
        try {
            normalized = assertPathAllowed(rawPath, grants.pathPatterns);
        } catch (e) {
            if (e instanceof PathAllowError) {
                throw new HttpError(403, e.code, e.message);
            }
            throw e;
        }

        ok(res, {
            allowed: true,
            method,
            path: normalized,
            pluginId: frame.pluginId,
            surfaceId: frame.surfaceId,
            note: 'BFF may forward this path under session auth; bot re-checks bits',
        });
    }

    private async dispose(req: DashRequest, res: Response): Promise<void> {
        const body = requireBody<{ nonce: string }>(req.body, ['nonce']);
        const frame = getBoundFrame(String(body.nonce));
        if (frame) {
            disposeSurface(frame.sessionJti, frame.pluginId, frame.surfaceId);
            revokeFrame(String(body.nonce));
        }
        ok(res, { disposed: true });
    }
}
