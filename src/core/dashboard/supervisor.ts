import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import {
    parseDashboardMode,
    type DashboardMode,
} from '#core/manager/http/dashboardStatic.js';
import {
    clearDashboardServiceCredentialFile,
    DASHBOARD_SERVICE_LABEL,
    issueDashboardServiceCredential,
} from '#core/dashboard/serviceCredential.js';

const log = getLogger('DashboardSupervisor');

export type DashboardAvailability = {
    readonly mode: DashboardMode;
    readonly sourcePresent: boolean;
    readonly distPresent: boolean;
    readonly canStartDev: boolean;
    readonly canStartProd: boolean;
    /** NODE_ENV === 'development' only — unset defaults to production behavior. */
    readonly explicitDevelopment: boolean;
};

export type DashboardSupervisorStatus = {
    readonly mode: DashboardMode;
    readonly desired: boolean;
    readonly running: boolean;
    readonly generation: number;
    readonly pid: number | null;
    readonly lastExitCode: number | null;
    readonly lastExitSignal: string | null;
    readonly reason: string;
};

let child: ChildProcess | null = null;
let stopping = false;
let startedGeneration = 0;
let activeMode: DashboardMode = 'auto';
let desiredRunning = false;
let lastReason = 'not started';
let lastExitCode: number | null = null;
let lastExitSignal: string | null = null;
let startInFlight = false;

function webRoot(cwd: string): string {
    return path.resolve(cwd, 'apps', 'web');
}

/**
 * Explicit development only when NODE_ENV is the string "development".
 * Unset NODE_ENV and any other value use production dashboard hosting rules.
 */
export function isExplicitDevelopmentMode(): boolean {
    const raw = (process.env.NODE_ENV ?? secrets.getOptional('NODE_ENV') ?? '').trim().toLowerCase();
    return raw === 'development';
}

export function inspectDashboardAvailability(cwd: string = process.cwd()): DashboardAvailability {
    const mode = parseDashboardMode(undefined);
    const root = webRoot(cwd);
    const pkg = path.join(root, 'package.json');
    const indexHtml = path.join(root, 'index.html');
    const distIndex = path.join(root, 'dist', 'index.html');
    const sourcePresent = fs.existsSync(pkg) && fs.existsSync(indexHtml);
    const distPresent = fs.existsSync(distIndex);
    const explicitDevelopment = isExplicitDevelopmentMode();
    return {
        mode,
        sourcePresent,
        distPresent,
        canStartDev: sourcePresent && explicitDevelopment,
        canStartProd: distPresent,
        explicitDevelopment,
    };
}

export function getDashboardSupervisorStatus(): DashboardSupervisorStatus {
    const running = Boolean(child && child.pid && !child.killed);
    return {
        mode: activeMode,
        desired: desiredRunning,
        running,
        generation: startedGeneration,
        pid: running && child?.pid ? child.pid : null,
        lastExitCode,
        lastExitSignal,
        reason: lastReason,
    };
}

/**
 * Core /health helper: when dashboard is required and not running, report unhealthy.
 * When dashboard is optional/disabled, status is informational only.
 */
export function isDashboardHealthOk(): boolean {
    const st = getDashboardSupervisorStatus();
    if (!st.desired) return true;
    return st.running;
}

export async function registerDashboardServiceKeyWithGateway(key: string): Promise<void> {
    const { getGatewayRuntimeKeyRegistrar } = await import('#core/dashboard/gatewayKeyBridge.js');
    const reg = getGatewayRuntimeKeyRegistrar();
    if (!reg) {
        throw new Error(
            'Gateway runtime key registrar is not bound. Ensure the api plugin is enabled before starting the dashboard.',
        );
    }
    reg.revokeRuntimeKey(DASHBOARD_SERVICE_LABEL);
    reg.registerRuntimeKey({
        key,
        label: DASHBOARD_SERVICE_LABEL,
        enabled: true,
        bits: [],
    });
}

export async function revokeDashboardServiceKeyFromGateway(): Promise<void> {
    try {
        const { getGatewayRuntimeKeyRegistrar } = await import('#core/dashboard/gatewayKeyBridge.js');
        getGatewayRuntimeKeyRegistrar()?.revokeRuntimeKey(DASHBOARD_SERVICE_LABEL);
    } catch {
        /* gateway may already be down */
    }
}

function resolveDashboardPort(): number {
    const raw = secrets.getOptional('DashboardPort', '5173') ?? '5173';
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid DashboardPort "${raw}"`);
    }
    return n;
}

/**
 * Start the dashboard child process when DashboardMode requires it.
 */
/**
 * Development-only optional Vite/HMR child process.
 * Production dashboard UI is served in-process by Core HTTP (mountDashboardUI).
 * This supervisor must never start a production child host or issue service keys
 * outside explicit NODE_ENV=development.
 */
export async function startDashboardSupervisor(options?: {
    readonly cwd?: string;
    readonly registerKey?: boolean;
}): Promise<{ started: boolean; mode: DashboardMode; reason: string }> {
    if (startInFlight) {
        throw new Error('Dashboard supervisor start already in progress.');
    }
    startInFlight = true;
    try {
        const cwd = options?.cwd ?? process.cwd();
        const availability = inspectDashboardAvailability(cwd);
        const { mode } = availability;
        activeMode = mode;

        if (mode === 'false') {
            desiredRunning = false;
            lastReason = 'explicitly disabled';
            log.info('DashboardMode=false — dashboard process not started.');
            return { started: false, mode, reason: lastReason };
        }

        // Production path: never spawn a child host or issue service credentials.
        // Embedded static serving on Core HTTP is the only production UI path.
        if (!availability.explicitDevelopment) {
            desiredRunning = false;
            lastReason =
                'production uses embedded Core HTTP static serving; child supervisor is development-only';
            log.info(
                'Dashboard supervisor skipped in production — use mountDashboardUI on Core HTTP.',
            );
            return { started: false, mode, reason: lastReason };
        }

        const explicitDev = true;
        const canStart = availability.canStartDev;

        if (!canStart) {
            const msg = 'apps/web source is missing for development Vite HMR';
            lastReason = msg;
            desiredRunning = false;
            log.info(`DashboardMode=${mode} — dev dashboard not started (${msg}).`);
            return { started: false, mode, reason: msg };
        }

        if (child && !child.killed) {
            lastReason = 'already running';
            log.warn('Dashboard supervisor already has a live child; skipping duplicate start.');
            return { started: true, mode, reason: lastReason };
        }

        // Service credentials are development-only (Vite proxy → Core API). Never used by the browser.
        const credential = issueDashboardServiceCredential(cwd);
        if (options?.registerKey !== false) {
            try {
                await registerDashboardServiceKeyWithGateway(credential.key);
            } catch (err: unknown) {
                clearDashboardServiceCredentialFile(cwd);
                throw new Error(
                    `Failed to register dashboard service API key with gateway: ${err instanceof Error ? err.message : String(err)}`,
                    { cause: err },
                );
            }
        }

        const port = resolveDashboardPort();
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            DASHBOARD_PORT: String(port),
            PORT: String(port),
            CORE_API_BASE_URL: credential.coreApiBaseUrl,
            VITE_API_PROXY: credential.coreApiBaseUrl,
            DASHBOARD_SERVICE_CREDENTIAL_FILE: path.resolve(
                cwd,
                '.data',
                'dashboard',
                'service-credential.json',
            ),
            // Force child NODE_ENV: development only when explicitly selected.
            NODE_ENV: explicitDev ? 'development' : 'production',
        };

        const web = webRoot(cwd);
        let command: string;
        let args: string[];
        let childCwd: string;

        // Vite HMR only — production child host path removed (embedded Core static serving).
        if (!(explicitDev && availability.canStartDev)) {
            await revokeDashboardServiceKeyFromGateway();
            clearDashboardServiceCredentialFile(cwd);
            lastReason = 'development Vite source unavailable';
            desiredRunning = false;
            return { started: false, mode, reason: lastReason };
        }
        command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        args = ['run', 'dev', '--', '--port', String(port), '--host', '0.0.0.0'];
        childCwd = web;

        startedGeneration = credential.generation;
        stopping = false;
        desiredRunning = true;
        lastExitCode = null;
        lastExitSignal = null;
        lastReason = 'started';

        child = spawn(command, args, {
            cwd: childCwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        const gen = startedGeneration;
        child.stdout?.on('data', (buf: Buffer) => {
            log.info(`[dashboard:${gen}] ${buf.toString('utf8').trimEnd()}`);
        });
        child.stderr?.on('data', (buf: Buffer) => {
            log.warn(`[dashboard:${gen}] ${buf.toString('utf8').trimEnd()}`);
        });
        child.on('exit', (code, signal) => {
            if (child && startedGeneration === gen) {
                child = null;
            }
            lastExitCode = code;
            lastExitSignal = signal;
            if (!stopping) {
                lastReason = `exited unexpectedly code=${code} signal=${signal ?? 'none'}`;
                log.error(`Dashboard process ${lastReason}`);
                // Required dashboard: mark unhealthy; primary process exits so orchestrators restart cleanly.
                if (activeMode === 'true') {
                    log.error('DashboardMode=true — Core will exit because the dashboard child died.');
                    process.exitCode = 1;
                    setTimeout(() => {
                        try {
                            process.exit(1);
                        } catch {
                            /* ignore */
                        }
                    }, 250).unref?.();
                }
            } else {
                lastReason = `stopped code=${code} signal=${signal ?? 'none'}`;
                log.info(`Dashboard process ${lastReason}`);
            }
        });

        log.info(
            `Dashboard process started mode=${mode} explicitDev=${explicitDev} port=${port} generation=${gen} pid=${child.pid}`,
        );
        return { started: true, mode, reason: lastReason };
    } finally {
        startInFlight = false;
    }
}

export async function stopDashboardSupervisor(): Promise<void> {
    stopping = true;
    desiredRunning = false;
    const proc = child;
    child = null;
    if (proc && !proc.killed) {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                } catch {
                    /* ignore */
                }
                resolve();
            }, 8_000);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
            try {
                proc.kill('SIGTERM');
            } catch {
                clearTimeout(timer);
                resolve();
            }
        });
    }
    await revokeDashboardServiceKeyFromGateway();
    clearDashboardServiceCredentialFile(process.cwd());
    lastReason = 'stopped by supervisor';
}
