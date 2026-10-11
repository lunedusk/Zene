import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response, NextFunction } from 'express';
import { secrets } from '#core/helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DashboardStatic');

export type DashboardMode = 'auto' | 'true' | 'false';

const MODE_VALUES = new Set<string>(['auto', 'true', 'false']);

/** Sentinel filenames under a candidate UI root that prove a completed Vite build. */
const INDEX_SENTINEL = 'index.html';

/**
 * Resolve DashboardMode from env/defaults.
 * Invalid values fail closed with a clear configuration error (never treated as false).
 */
export function parseDashboardMode(raw: string | undefined): DashboardMode {
    const source = (raw ?? secrets.getOptional('DashboardMode', 'auto') ?? 'auto').trim().toLowerCase();
    if (!MODE_VALUES.has(source)) {
        throw new Error(
            `Invalid DashboardMode "${raw ?? ''}". Expected exactly one of: auto, true, false.`,
        );
    }
    return source as DashboardMode;
}

/**
 * Candidate absolute roots for the compiled SPA (must contain index.html).
 * Production image places assets at apps/web/dist; local builds use the same path.
 */
export function listDashboardAssetCandidates(cwd: string = process.cwd()): string[] {
    return [
        path.resolve(cwd, 'apps', 'web', 'dist'),
        path.resolve(cwd, 'web', 'dist'),
        path.resolve(cwd, 'dashboard-ui'),
    ];
}

export function resolveDashboardAssetRoot(cwd: string = process.cwd()): string | null {
    for (const root of listDashboardAssetCandidates(cwd)) {
        const indexPath = path.join(root, INDEX_SENTINEL);
        try {
            if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
                return root;
            }
        } catch {
            continue;
        }
    }
    return null;
}

export function isDashboardBackendPresent(registryHasDashboard: boolean): boolean {
    return registryHasDashboard;
}

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};

/** Paths that must never be served from the SPA root. */
function isForbiddenRel(rel: string): boolean {
    const n = rel.replace(/\\/g, '/').toLowerCase();
    if (n.includes('..')) return true;
    if (n.startsWith('.env') || n.includes('/.env')) return true;
    if (n.endsWith('.ts') || n.endsWith('.tsx') || n.endsWith('.mts') || n.endsWith('.cts')) return true;
    if (n.includes('node_modules/')) return true;
    if (n.includes('.git/')) return true;
    return false;
}

function safeJoin(root: string, urlPath: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(urlPath.split('?')[0] ?? '');
    } catch {
        return null;
    }
    if (decoded.includes('\0')) return null;
    const rel = decoded.replace(/^\/+/, '');
    if (isForbiddenRel(rel)) return null;
    const abs = path.normalize(path.join(root, rel));
    const rootNorm = path.normalize(root);
    if (abs !== rootNorm && !abs.startsWith(rootNorm + path.sep)) {
        return null;
    }
    return abs;
}

export interface MountDashboardResult {
    readonly mode: DashboardMode;
    readonly mounted: boolean;
    readonly assetRoot: string | null;
    readonly backendPresent: boolean;
    readonly reason: string;
}

/**
 * Mount same-origin SPA static hosting on the Core Express app.
 * Must run after API routers are registered and before finalize()'s catch-all.
 * Never handles /api/* — those remain exclusive to API routers / JSON 404.
 */
export function mountDashboardStatic(
    app: Express,
    options: {
        readonly registryHasDashboard: boolean;
        readonly cwd?: string;
    },
): MountDashboardResult {
    const mode = parseDashboardMode(undefined);
    const assetRoot = resolveDashboardAssetRoot(options.cwd);
    const backendPresent = isDashboardBackendPresent(options.registryHasDashboard);

    if (mode === 'false') {
        log.info('DashboardMode=false — integrated UI not mounted (API plugins unaffected).');
        return {
            mode,
            mounted: false,
            assetRoot,
            backendPresent,
            reason: 'explicitly disabled',
        };
    }

    if (mode === 'true') {
        if (!assetRoot) {
            throw new Error(
                'DashboardMode=true but compiled UI assets were not found. ' +
                    'Build apps/web (expect apps/web/dist/index.html) and include them in the runtime image.',
            );
        }
        if (!backendPresent) {
            throw new Error(
                'DashboardMode=true but the dashboard plugin is not loaded. ' +
                    'Ensure the dashboard plugin and its dependencies (dash-data, api, permissions, token) boot successfully.',
            );
        }
    }

    if (mode === 'auto') {
        if (!assetRoot) {
            log.info(
                'DashboardMode=auto — no apps/web/dist/index.html (or equivalent); integrated UI skipped.',
            );
            return {
                mode,
                mounted: false,
                assetRoot: null,
                backendPresent,
                reason: 'assets missing',
            };
        }
        if (!backendPresent) {
            log.info(
                'DashboardMode=auto — UI assets present but dashboard plugin not loaded; integrated UI skipped.',
            );
            return {
                mode,
                mounted: false,
                assetRoot,
                backendPresent: false,
                reason: 'dashboard plugin not loaded',
            };
        }
    }

    if (!assetRoot) {
        return {
            mode,
            mounted: false,
            assetRoot: null,
            backendPresent,
            reason: 'assets missing',
        };
    }

    const root = assetRoot;

    app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
        }
        const urlPath = req.path || '/';
        if (urlPath === '/api' || urlPath.startsWith('/api/')) {
            next();
            return;
        }
        if (urlPath === '/health' || urlPath.startsWith('/health/')) {
            next();
            return;
        }

        const filePath = safeJoin(root, urlPath === '/' ? INDEX_SENTINEL : urlPath);
        if (!filePath) {
            next();
            return;
        }

        try {
            const st = fs.statSync(filePath);
            if (st.isFile()) {
                const ext = path.extname(filePath).toLowerCase();
                res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
                if (ext === '.html') {
                    res.setHeader('Cache-Control', 'no-cache');
                } else if (urlPath.startsWith('/assets/')) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else {
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                }
                res.setHeader('X-Content-Type-Options', 'nosniff');
                if (req.method === 'HEAD') {
                    res.status(200).end();
                    return;
                }
                fs.createReadStream(filePath).pipe(res);
                return;
            }
        } catch {
            // fall through to SPA index for client routes
        }

        // SPA fallback: only for document navigations without a file match
        const indexFile = path.join(root, INDEX_SENTINEL);
        try {
            if (!fs.existsSync(indexFile)) {
                next();
                return;
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            if (req.method === 'HEAD') {
                res.status(200).end();
                return;
            }
            fs.createReadStream(indexFile).pipe(res);
        } catch (err: unknown) {
            log.warn(
                `Dashboard static serve failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            next();
        }
    });

    log.info(`Integrated dashboard UI mounted from ${root}`);
    return {
        mode,
        mounted: true,
        assetRoot: root,
        backendPresent,
        reason: 'mounted',
    };
}
