import type { IncomingMessage } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { Request, Response, NextFunction, Express } from 'express';
import { getLogger } from '#core/utils/logger.js';
import { extractGuildId, shardIdForGuild, classifyAffinity } from './affinity.js';
import type { MembershipRegistry } from '../orchestrator/membership.js';
import type { ShardMap } from '../orchestrator/shardMap.js';

const log = getLogger('CrossHost:ApiGateway');

const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
]);

export interface ApiGatewayDeps {
    membership: MembershipRegistry;
    shardMap: ShardMap;
    totalShards: () => number;
    proxyTimeoutMs?: number;
}

function pickAnyWorker(membership: MembershipRegistry): { machineId: string; apiBaseUrl: string } | null {
    const workers = membership.listWorkers().filter((w) => typeof w.apiBaseUrl === 'string' && w.apiBaseUrl.length > 0);
    if (workers.length === 0) return null;
    const idx = Math.floor(Date.now() / 1000) % workers.length;
    const w = workers[idx]!;
    return { machineId: w.machineId, apiBaseUrl: w.apiBaseUrl! };
}

function resolveTarget(
    deps: ApiGatewayDeps,
    req: Request,
):
    | { ok: true; machineId: string; apiBaseUrl: string; shardId: number | null; guildId: string | null }
    | { ok: false; status: number; error: string; code: string } {
    const guildId = extractGuildId({
        query: req.query as Record<string, unknown>,
        body: req.body,
        headers: req.headers as Record<string, unknown>,
        params: req.params as Record<string, unknown>,
    });
    const affinity = classifyAffinity(guildId);
    const total = deps.totalShards();

    if (affinity === 'guild' && guildId) {
        let shardId: number;
        try {
            shardId = shardIdForGuild(guildId, total);
        } catch {
            return { ok: false, status: 400, error: 'Invalid guildId', code: 'GATEWAY.BAD_GUILD' };
        }
        const owner = deps.shardMap.ownerOf(shardId);
        if (!owner) {
            return {
                ok: false,
                status: 503,
                error: `No worker owns shard ${shardId}`,
                code: 'GATEWAY.NO_OWNER',
            };
        }
        const worker = deps.membership.getWorker(owner);
        const url = worker?.apiBaseUrl;
        if (!url) {
            return {
                ok: false,
                status: 503,
                error: `Worker ${owner} has no apiBaseUrl`,
                code: 'GATEWAY.NO_API',
            };
        }
        return { ok: true, machineId: owner, apiBaseUrl: url, shardId, guildId };
    }

    const any = pickAnyWorker(deps.membership);
    if (!any) {
        return {
            ok: false,
            status: 503,
            error: 'No workers advertising API endpoints',
            code: 'GATEWAY.NO_WORKERS',
        };
    }
    return { ok: true, machineId: any.machineId, apiBaseUrl: any.apiBaseUrl, shardId: null, guildId };
}

function proxyRequest(
    deps: ApiGatewayDeps,
    req: Request,
    res: Response,
    target: { machineId: string; apiBaseUrl: string; shardId: number | null; guildId: string | null },
): void {
    const timeoutMs = deps.proxyTimeoutMs ?? 30_000;
    let dest: URL;
    try {
        dest = new URL(req.originalUrl || req.url, target.apiBaseUrl);
    } catch {
        res.status(500).json({ error: 'Bad upstream URL', code: 'GATEWAY.BAD_UPSTREAM' });
        return;
    }

    const isHttps = dest.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    for (const h of HOP_BY_HOP) {
        delete headers[h];
    }
    headers['x-zene-worker'] = target.machineId;
    if (target.shardId !== null) headers['x-zene-shard'] = String(target.shardId);
    if (target.guildId) headers['x-zene-guild-id'] = target.guildId;
    headers['x-forwarded-host'] = req.headers.host ?? '';
    headers['x-forwarded-proto'] = req.protocol;
    const prior = req.headers['x-forwarded-for'];
    headers['x-forwarded-for'] =
        typeof prior === 'string' && prior.length > 0
            ? `${prior}, ${req.socket.remoteAddress ?? 'unknown'}`
            : (req.socket.remoteAddress ?? 'unknown');

    const upstream = lib.request(
        {
            protocol: dest.protocol,
            hostname: dest.hostname,
            port: dest.port || (isHttps ? 443 : 80),
            path: dest.pathname + dest.search,
            method: req.method,
            headers,
            timeout: timeoutMs,
        },
        (upRes: IncomingMessage) => {
            const outHeaders = { ...upRes.headers };
            delete outHeaders['transfer-encoding'];
            res.status(upRes.statusCode ?? 502);
            for (const [k, v] of Object.entries(outHeaders)) {
                if (v !== undefined) res.setHeader(k, v);
            }
            res.setHeader('x-zene-worker', target.machineId);
            if (target.shardId !== null) res.setHeader('x-zene-shard', String(target.shardId));
            upRes.pipe(res);
        },
    );

    upstream.on('timeout', () => {
        upstream.destroy();
        if (!res.headersSent) {
            res.status(504).json({ error: 'Upstream timeout', code: 'GATEWAY.TIMEOUT' });
        }
    });
    upstream.on('error', (err) => {
        log.warn('Upstream proxy error', { machineId: target.machineId, err });
        if (!res.headersSent) {
            res.status(502).json({
                error: 'Bad gateway',
                code: 'GATEWAY.UPSTREAM',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    });

    if (req.method === 'GET' || req.method === 'HEAD') {
        upstream.end();
        return;
    }

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (raw && raw.length > 0) {
        upstream.end(raw);
        return;
    }
    if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
        const buf = Buffer.from(JSON.stringify(req.body));
        upstream.setHeader('content-type', 'application/json');
        upstream.setHeader('content-length', String(buf.length));
        upstream.end(buf);
        return;
    }
    req.pipe(upstream);
}

export function mountApiGateway(app: Express, deps: ApiGatewayDeps): void {
    const handler = (req: Request, res: Response, next: NextFunction): void => {
        if (req.path.startsWith('/cross-host') || req.path === '/health') {
            next();
            return;
        }

        const resolved = resolveTarget(deps, req);
        if (!resolved.ok) {
            res.status(resolved.status).json({
                error: resolved.error,
                code: resolved.code,
            });
            return;
        }

        log.debug('Proxy', {
            method: req.method,
            path: req.path,
            machineId: resolved.machineId,
            shardId: resolved.shardId,
            guildId: resolved.guildId,
        });
        proxyRequest(deps, req, res, resolved);
    };

    app.use(handler);
}
