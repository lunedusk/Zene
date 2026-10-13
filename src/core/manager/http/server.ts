import express, { type Express, type Router, type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import { getLogger } from '#core/utils/logger.js';
import { performance } from 'node:perf_hooks';
import { secrets } from '#core/helpers/secretManager.js';
import { NovaError } from '#core/errors/NovaError.js';
import { errors } from '#core/errors/index.js';
import {
    mountDashboardStatic,
    parseDashboardMode,
    type MountDashboardResult,
} from '#core/manager/http/dashboardStatic.js';

const log = getLogger('HttpServer');

type MountState = { active: boolean };

export class HttpServer {
    private app: Express | null = null;
    private server: http.Server | null = null;
    private isRunning = false;
    private readonly mounts = new Map<string, MountState>();
    private dashboardMount: MountDashboardResult | null = null;

    public init(): void {
        if (this.app) return;

        log.info('Initializing REST API Server...');
        this.app = express();

        this.app.use(express.json({
            limit: '500kb',
            verify: (req, _res, buf) => {
                (req as Request & { rawBody?: Buffer }).rawBody = buf;
            }
        }));
        this.app.use(express.urlencoded({ extended: true, limit: '500kb' }));

        this.app.use((req: Request, res: Response, next: NextFunction) => {
            const start = performance.now();
            res.on('finish', () => {
                const duration = performance.now() - start;
                const status = res.statusCode;
                const cleanUrl = req.originalUrl.split('?')[0];
                const msg = `[${req.method}] ${cleanUrl} - ${status} (${duration.toFixed(2)}ms)`;

                if (status >= 500) log.error(msg);
                else if (status >= 400) log.warn(msg);
                else log.debug(msg);
            });
            next();
        });

        this.app.get('/health', (_req: Request, res: Response) => {
            // Integrated dashboard state (same-origin static mount), not a child process.
            let mode: string;
            try {
                mode = parseDashboardMode(undefined);
            } catch {
                mode = 'invalid';
            }
            const mount = this.dashboardMount;
            const required = mode === 'true';
            const mounted = mount?.mounted === true;
            const backendPresent = mount?.backendPresent === true;
            const dashOk = required ? mounted && backendPresent : true;
            const body = {
                ok: dashOk,
                core: true,
                dashboard: {
                    mode,
                    desired: required || mode === 'auto',
                    mounted,
                    backendPresent,
                    assetRoot: mount?.assetRoot ?? null,
                    reason: mount?.reason ?? (mode === 'false' ? 'explicitly disabled' : 'not mounted yet'),
                },
            };
            res.status(dashOk ? 200 : 503).json(body);
        });
    }

    public registerRouter(basePath: string, router: Router): void {
        if (!this.app) throw new Error("HttpServer not initialized.");

        this.unregisterRouter(basePath);

        const state: MountState = { active: true };
        const gate: express.RequestHandler = (req, res, next) => {
            if (!state.active) {
                next();
                return;
            }
            router(req, res, next);
        };
        this.app.use(basePath, gate);
        this.mounts.set(basePath, state);

        log.debug(`Mounted Router: ${basePath}`);
    }

    public unregisterRouter(basePath: string): void {
        const state = this.mounts.get(basePath);
        if (!state) return;
        state.active = false;
        this.mounts.delete(basePath);
        log.debug(`Unmounted API Router: ${basePath}`);
    }

    public listMounts(): string[] {
        return Array.from(this.mounts.keys()).sort();
    }

    public async start(
        port: number = parseInt(secrets.getOptional('APIPort') || '3000', 10),
        host: string = secrets.getOptional('APIHost') || '0.0.0.0',
    ): Promise<void> {
        if (this.isRunning) return;
        if (!this.app) {
            throw new Error('HttpServer not initialized.');
        }

        return new Promise((resolve, reject) => {
            try {
                this.server = this.app!.listen(port, host, () => {
                    this.isRunning = true;
                    log.info(`REST API active on http://${host}:${port}`);
                    void import('#core/manager/event.js')
                        .then(({ eventBus }) =>
                            eventBus.emitConcurrent('system.http.ready', { host, port }),
                        )
                        .catch(() => undefined);
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Mount the optional integrated SPA after plugin routes are registered
     * and before finalize()'s JSON catch-all. See DashboardMode.
     */
    public mountDashboardUI(registryHasDashboard: boolean): MountDashboardResult {
        if (!this.app) {
            throw new Error('HttpServer not initialized.');
        }
        const result = mountDashboardStatic(this.app, { registryHasDashboard });
        this.dashboardMount = result;
        return result;
    }

    /** Last integrated dashboard mount outcome (null before mount attempt). */
    public getDashboardMountState(): MountDashboardResult | null {
        return this.dashboardMount;
    }

    public finalize(): void {
        if (!this.app) return;

        this.app.use((req: Request, res: Response) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.method} ${req.originalUrl} does not exist.`
            });
        });

        this.app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
            try {
                const isNova = NovaError.isNovaError(err);
                const status = isNova
                    ? (err.statusCode && err.statusCode >= 400 && err.statusCode < 600
                        ? err.statusCode
                        : 500)
                    : 500;
                const code = isNova ? err.code : 'INTERNAL.UNKNOWN';
                const clientMessage = isNova
                    ? err.userMessage
                    : 'An unexpected error occurred.';
                const clientError = isNova ? err.code : 'Internal Server Error';

                if (isNova) {
                    log.error(`API Exception [${err.code}]: ${err.message}`, {
                        stack: err.stack,
                        category: err.category,
                        severity: err.severity,
                    });
                } else {
                    const e = err instanceof Error ? err : new Error(String(err));
                    log.error(`API Exception: ${e.message}`, { stack: e.stack });
                }

                const routePattern =
                    typeof req.route?.path === 'string'
                        ? `${req.baseUrl || ''}${req.route.path}`
                        : (req.originalUrl || req.path || '/').split('?')[0] || '/';
                const method = typeof req.method === 'string' ? req.method : 'UNKNOWN';

                const auth = res.locals.gatewayAuth as
                    | { isMaster?: boolean; label?: string }
                    | undefined;
                let actorId: string | null = null;
                let actorType: string | null = null;
                if (auth) {
                    actorType = 'api_key';
                    actorId = auth.isMaster ? 'master' : (auth.label?.trim() || 'api_key');
                }

                void errors
                    .record({
                        code,
                        category: isNova ? err.category : 'http',
                        severity: isNova ? err.severity : 'error',
                        message: isNova ? err.userMessage : 'Internal request failure',
                        context: {
                            method,
                            path: routePattern,
                            code,
                            status,
                            actorId,
                            actorType,
                        },
                    })
                    .catch(() => {});

                if (!res.headersSent) {
                    res.status(status).json({
                        error: clientError,
                        code,
                        message: clientMessage,
                    });
                }
            } catch (formatErr: unknown) {
                const e = formatErr instanceof Error ? formatErr : new Error(String(formatErr));
                log.error(`Error boundary failed: ${e.message}`);
                if (!res.headersSent) {
                    try {
                        res.status(500).json({
                            error: 'Internal Server Error',
                            code: 'INTERNAL.BOUNDARY',
                            message: 'An unexpected error occurred.',
                        });
                    } catch {

                    }
                }
            }
        });

        log.info('HttpServer pipeline finalized and locked.');
    }

    public async stop(timeoutMs: number = 10_000): Promise<void> {
        if (!this.server) return;
        const srv = this.server;
        await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                this.isRunning = false;
                log.info('REST API shut down.');
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('system.http.stopped', { at: Date.now() }),
            )
            .catch(() => undefined);
                resolve();
            };
            const timer = setTimeout(() => {
                log.warn(`HTTP server.close timed out after ${timeoutMs}ms – forcing`);
                try {
                    const closer = srv as http.Server & { closeAllConnections?: () => void };
                    closer.closeAllConnections?.();
                } catch {
                    /* closeAllConnections may be unavailable on older Node */
                }
                done();
            }, timeoutMs);
            timer.unref();
            srv.close(() => {
                clearTimeout(timer);
                done();
            });
        });
        this.server = null;
    }
}

export const httpServer = new HttpServer();
