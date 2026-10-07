/**
 * Phase 2D — Runtime backends: in-process + real Worker/Process hosts.
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fork, type ChildProcess } from 'node:child_process';
import { getLogger } from '#core/utils/logger.js';
import { clearBridgeResources, handleHostMessage, countOwned } from './bridge.js';
import { errorMessage } from './errors.js';
import { resolveHostArtifact } from './hostResolve.js';
import {
    RUNTIME_PROTOCOL_VERSION,
    type CoreToHostMessage,
    type HostToCoreMessage,
    isHostToCore,
} from './protocol.js';
import type {
    InProcessLifecycleHooks,
    IsolationLevel,
    RuntimeHandle,
    RuntimeHealth,
    RuntimeLaunchRequest,
    RuntimeMessage,
} from './types.js';

export type CoreRequestPartial = {
    requestId?: string;
    type: CoreToHostMessage['type'];
    payload: CoreToHostMessage['payload'];
};

const log = getLogger('PluginRuntime');
let handleSeq = 0;

function nextId(pluginId: string, level: IsolationLevel): string {
    return `rt_${pluginId}_${level}_${++handleSeq}`;
}

export interface IsolatedRuntimeHandle extends RuntimeHandle {
    readonly level: IsolationLevel;
    request(
        partial: CoreRequestPartial,
        timeoutMs?: number,
    ): Promise<HostToCoreMessage>;
    waitReady(timeoutMs?: number): Promise<HostToCoreMessage>;
}

type Pending = {
    resolve: (m: HostToCoreMessage) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

type ReadyWaiter = {
    resolve: (m: HostToCoreMessage) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

function createChannelState() {
    return {
        pending: new Map<string, Pending>(),
        ready: null as HostToCoreMessage | null,
        readyWaiters: [] as ReadyWaiter[],
        fatal: null as Error | null,
        settled: false,
    };
}

function rejectAllPending(
    state: ReturnType<typeof createChannelState>,
    err: Error,
): void {
    state.fatal = err;
    state.settled = true;
    for (const [id, p] of state.pending) {
        clearTimeout(p.timer);
        p.reject(err);
        state.pending.delete(id);
    }
    for (const w of state.readyWaiters) {
        clearTimeout(w.timer);
        w.reject(err);
    }
    state.readyWaiters.length = 0;
}

function onHostMessage(
    state: ReturnType<typeof createChannelState>,
    msg: HostToCoreMessage,
    handle: IsolatedRuntimeHandle,
): void {
    try {
        handleHostMessage(msg);
    } catch (err: unknown) {
        // Registration failures must not hang the runtime channel; mark failed if during enable flood
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[${handle.pluginId}] bridge message handling error: ${message}`);
    }

    if (msg.type === 'host.error' && msg.payload.fatal) {
        handle.health = 'failed';
        const err = new Error(
            msg.payload.message || 'Fatal host error',
        );
        // Settle correlated request if present
        const pending = state.pending.get(msg.requestId);
        if (pending) {
            clearTimeout(pending.timer);
            state.pending.delete(msg.requestId);
            pending.reject(err);
        }
        // Always reject readiness waiters on fatal — never hang
        rejectAllPending(state, err);
        return;
    }

    if (msg.type === 'host.ready') {
        if (state.fatal || handle.health === 'failed') {
            return; // ignore ready after fatal
        }
        state.ready = msg;
        state.settled = true;
        handle.health = 'ready';
        for (const w of state.readyWaiters) {
            clearTimeout(w.timer);
            w.resolve(msg);
        }
        state.readyWaiters.length = 0;
    }

    const p = state.pending.get(msg.requestId);
    if (p) {
        clearTimeout(p.timer);
        state.pending.delete(msg.requestId);
        p.resolve(msg);
    }
}

function buildCoreMessage(
    runtimeId: string,
    pluginId: string,
    partial: CoreRequestPartial,
    reqCounter: { n: number },
): CoreToHostMessage {
    const requestId = partial.requestId || `req_${++reqCounter.n}`;
    return {
        v: RUNTIME_PROTOCOL_VERSION,
        runtimeId,
        pluginId,
        requestId,
        direction: 'core→host',
        type: partial.type,
        payload: partial.payload,
    } as CoreToHostMessage;
}

class InProcessHandle implements IsolatedRuntimeHandle {
    health: RuntimeHealth = 'ready';
    readonly level = 'in-process' as const;
    readonly #hooks: InProcessLifecycleHooks | undefined;
    constructor(
        readonly id: string,
        readonly pluginId: string,
        hooks?: InProcessLifecycleHooks,
    ) {
        this.#hooks = hooks;
    }
    async post(_message: RuntimeMessage): Promise<void> {}
    async terminate(): Promise<void> {
        this.health = 'stopped';
    }
    async request(partial: CoreRequestPartial, timeoutMs = 5000): Promise<HostToCoreMessage> {
        if (this.health === 'stopped' || this.health === 'failed') {
            throw new Error(`Runtime ${this.id} is ${this.health}`);
        }
        if (partial.type === 'core.lifecycle') {
            const op = (partial.payload as { op: 'setup' | 'enable' | 'disable' | 'unload' }).op;
            if (!this.#hooks) throw new Error('in-process hooks missing');
            try {
                if (op === 'setup') await this.#hooks.setup();
                if (op === 'enable') await this.#hooks.enable();
                if (op === 'disable') await this.#hooks.disable();
                if (op === 'unload') await this.#hooks.unload();
                return {
                    v: RUNTIME_PROTOCOL_VERSION,
                    runtimeId: this.id,
                    pluginId: this.pluginId,
                    requestId: partial.requestId ?? 'ip',
                    direction: 'host→core',
                    type: 'host.lifecycle.result',
                    payload: { op, ok: true, evidence: { inProcess: true } },
                };
            } catch (err: unknown) {
                return {
                    v: RUNTIME_PROTOCOL_VERSION,
                    runtimeId: this.id,
                    pluginId: this.pluginId,
                    requestId: partial.requestId ?? 'ip',
                    direction: 'host→core',
                    type: 'host.lifecycle.result',
                    payload: { op, ok: false, error: errorMessage(err) },
                };
            }
        }
        if (partial.type === 'core.getIdentity') {
            return {
                v: RUNTIME_PROTOCOL_VERSION,
                runtimeId: this.id,
                pluginId: this.pluginId,
                requestId: partial.requestId ?? 'ip',
                direction: 'host→core',
                type: 'host.identity',
                payload: {
                    pid: process.pid,
                    isMainThread: true,
                    pluginModuleLoaded: true,
                },
            };
        }
        void timeoutMs;
        throw new Error(`in-process unsupported op ${partial.type}`);
    }
    async waitReady(): Promise<HostToCoreMessage> {
        return {
            v: RUNTIME_PROTOCOL_VERSION,
            runtimeId: this.id,
            pluginId: this.pluginId,
            requestId: 'ready',
            direction: 'host→core',
            type: 'host.ready',
            payload: {
                pid: process.pid,
                isMainThread: true,
                isolation: 'worker',
            },
        };
    }
}

export async function launchInProcess(
    request: RuntimeLaunchRequest,
): Promise<IsolatedRuntimeHandle> {
    const handle = new InProcessHandle(
        nextId(request.pluginId, 'in-process'),
        request.pluginId,
        request.inProcessHooks,
    );
    log.debug(`[${request.pluginId}] in-process runtime via RuntimeManager`);
    return handle;
}

export async function launchWorker(
    request: RuntimeLaunchRequest,
): Promise<IsolatedRuntimeHandle> {
    if (!request.pluginDir || !request.entryRelative) {
        throw new Error('Worker runtime requires pluginDir and entryRelative');
    }
    const id = nextId(request.pluginId, 'worker');
    const artifact = resolveHostArtifact('workerEntry');
    const state = createChannelState();
    const reqCounter = { n: 0 };

    const worker = new Worker(artifact.absolutePath, {
        execArgv: [...artifact.execArgv],
        workerData: { runtimeId: id, pluginId: request.pluginId },
    });

    const handle: IsolatedRuntimeHandle = {
        id,
        pluginId: request.pluginId,
        level: 'worker',
        health: 'starting',
        async post(message: RuntimeMessage): Promise<void> {
            worker.postMessage(message);
        },
        async request(partial: CoreRequestPartial, timeoutMs = 8000): Promise<HostToCoreMessage> {
            if (handle.health === 'stopped' || handle.health === 'failed') {
                throw new Error(`Runtime ${id} is ${handle.health}`);
            }
            const msg = buildCoreMessage(id, request.pluginId, partial, reqCounter);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    state.pending.delete(msg.requestId);
                    handle.health = 'unresponsive';
                    reject(new Error(`RPC timeout ${timeoutMs}ms for ${partial.type}`));
                }, timeoutMs);
                state.pending.set(msg.requestId, { resolve, reject, timer });
                worker.postMessage(msg);
            });
        },
        async waitReady(timeoutMs = 15000): Promise<HostToCoreMessage> {
            if (state.fatal) throw state.fatal;
            if (state.ready) return state.ready;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    const i = state.readyWaiters.findIndex((w) => w.timer === timer);
                    if (i >= 0) state.readyWaiters.splice(i, 1);
                    handle.health = 'failed';
                    reject(new Error(`Worker ready timeout ${timeoutMs}ms`));
                }, timeoutMs);
                state.readyWaiters.push({ resolve, reject, timer });
            });
        },
        async terminate(reason?: string): Promise<void> {
            handle.health = 'stopping';
            try {
                await handle
                    .request(
                        {
                            requestId: `term_${Date.now()}`,
                            type: 'core.terminate',
                            payload: { reason: reason ?? 'terminate' },
                        },
                        2000,
                    )
                    .catch(() => undefined);
            } catch (err: unknown) {
                log.debug(`terminate signal: ${errorMessage(err)}`);
            }
            await worker.terminate();
            clearBridgeResources(request.pluginId, id);
            handle.health = 'stopped';
        },
    };

    worker.on('message', (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return;
        const msg = raw as HostToCoreMessage;
        if (!isHostToCore(msg)) return;
        if (msg.runtimeId !== id || msg.pluginId !== request.pluginId) return;
        onHostMessage(state, msg, handle);
    });
    worker.on('error', (err: Error) => {
        handle.health = 'failed';
        log.warn(`[${request.pluginId}] worker error: ${err.message}`);
        rejectAllPending(state, err);
    });
    worker.on('exit', (code: number) => {
        // Expected terminate path sets health stopping/stopped — do not mark failed
        if (handle.health === 'stopping' || handle.health === 'stopped') {
            handle.health = 'stopped';
            return;
        }
        if (handle.health === 'ready' || handle.health === 'starting') {
            handle.health = 'failed';
            log.warn(`[${request.pluginId}] unexpected worker exit code=${code}`);
            clearBridgeResources(request.pluginId, id);
            rejectAllPending(
                state,
                new Error(`Worker exited unexpectedly (code=${code})`),
            );
        }
    });

    try {
        const initResult = await handle.request(
            {
                requestId: 'init',
                type: 'core.init',
                payload: {
                    pluginDir: request.pluginDir,
                    entryRelative: request.entryRelative,
                    isolation: 'worker',
                    approvedEnv: request.env,
                },
            },
            10000,
        );
        if (initResult.type === 'host.error' && initResult.payload.fatal) {
            throw new Error(initResult.payload.message);
        }
        if (initResult.type !== 'host.ready' && !state.ready) {
            await handle.waitReady(5000);
        } else if (initResult.type === 'host.ready') {
            handle.health = 'ready';
            state.ready = initResult;
        }
        if (handle.health !== 'ready') {
            throw new Error('Worker failed to become ready after init');
        }
        return handle;
    } catch (err: unknown) {
        handle.health = 'failed';
        const message = err instanceof Error ? err.message : String(err);
        try {
            await worker.terminate();
        } catch {
            /* ignore */
        }
        clearBridgeResources(request.pluginId, id);
        handle.health = 'stopped';
        throw new Error(`Worker establish failed: ${message}`);
    }
}

export async function launchProcess(
    request: RuntimeLaunchRequest,
): Promise<IsolatedRuntimeHandle> {
    if (!request.pluginDir || !request.entryRelative) {
        throw new Error('Process runtime requires pluginDir and entryRelative');
    }
    const id = nextId(request.pluginId, 'process');
    const artifact = resolveHostArtifact('processMain');
    const state = createChannelState();
    const reqCounter = { n: 0 };

    const childEnv: Record<string, string> = {
        PATH: process.env.PATH ?? '',
        NODE_ENV: process.env.NODE_ENV ?? 'production',
        ZENE_RUNTIME_ID: id,
        ZENE_PLUGIN_ID: request.pluginId,
    };
    if (request.env) {
        for (const [k, v] of Object.entries(request.env)) {
            if (k.startsWith('ZENE_') || k === 'NODE_OPTIONS') childEnv[k] = v;
        }
    }

    const child: ChildProcess = fork(artifact.absolutePath, [], {
        env: childEnv,
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        execArgv: [...artifact.execArgv],
    });

    const handle: IsolatedRuntimeHandle = {
        id,
        pluginId: request.pluginId,
        level: 'process',
        health: 'starting',
        async post(message: RuntimeMessage): Promise<void> {
            if (!child.connected) throw new Error('IPC disconnected');
            child.send(message);
        },
        async request(partial: CoreRequestPartial, timeoutMs = 10000): Promise<HostToCoreMessage> {
            if (handle.health === 'stopped' || handle.health === 'failed') {
                throw new Error(`Runtime ${id} is ${handle.health}`);
            }
            const msg = buildCoreMessage(id, request.pluginId, partial, reqCounter);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    state.pending.delete(msg.requestId);
                    handle.health = 'unresponsive';
                    reject(new Error(`RPC timeout ${timeoutMs}ms for ${partial.type}`));
                }, timeoutMs);
                state.pending.set(msg.requestId, { resolve, reject, timer });
                if (!child.connected) {
                    clearTimeout(timer);
                    reject(new Error('IPC disconnected'));
                    return;
                }
                child.send(msg);
            });
        },
        async waitReady(timeoutMs = 15000): Promise<HostToCoreMessage> {
            if (state.fatal) throw state.fatal;
            if (state.ready) return state.ready;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    const i = state.readyWaiters.findIndex((w) => w.timer === timer);
                    if (i >= 0) state.readyWaiters.splice(i, 1);
                    handle.health = 'failed';
                    reject(new Error(`Process ready timeout ${timeoutMs}ms`));
                }, timeoutMs);
                state.readyWaiters.push({ resolve, reject, timer });
            });
        },
        async terminate(reason?: string): Promise<void> {
            handle.health = 'stopping';
            try {
                await handle
                    .request(
                        {
                            requestId: `term_${Date.now()}`,
                            type: 'core.terminate',
                            payload: { reason: reason ?? 'terminate' },
                        },
                        2000,
                    )
                    .catch(() => undefined);
            } catch (err: unknown) {
                log.debug(`process terminate: ${errorMessage(err)}`);
            }
            if (!child.killed) child.kill('SIGTERM');
            clearBridgeResources(request.pluginId, id);
            handle.health = 'stopped';
        },
    };

    child.on('message', (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return;
        const msg = raw as HostToCoreMessage;
        if (!isHostToCore(msg)) return;
        if (msg.runtimeId !== id || msg.pluginId !== request.pluginId) return;
        onHostMessage(state, msg, handle);
    });
    child.on('error', (err: Error) => {
        handle.health = 'failed';
        log.warn(`[${request.pluginId}] process error: ${err.message}`);
        rejectAllPending(state, err);
    });
    child.on('exit', (code: number | null) => {
        if (handle.health === 'stopping' || handle.health === 'stopped') {
            handle.health = 'stopped';
            return;
        }
        if (handle.health === 'ready' || handle.health === 'starting') {
            handle.health = 'failed';
            log.warn(`[${request.pluginId}] unexpected process exit code=${code}`);
            clearBridgeResources(request.pluginId, id);
            rejectAllPending(
                state,
                new Error(`Process exited unexpectedly (code=${code})`),
            );
        }
    });

    try {
        const initResult = await handle.request(
            {
                requestId: 'init',
                type: 'core.init',
                payload: {
                    pluginDir: request.pluginDir,
                    entryRelative: request.entryRelative,
                    isolation: 'process',
                    approvedEnv: request.env,
                },
            },
            10000,
        );
        if (initResult.type === 'host.error' && initResult.payload.fatal) {
            throw new Error(initResult.payload.message);
        }
        if (initResult.type !== 'host.ready' && !state.ready) {
            await handle.waitReady(5000);
        } else if (initResult.type === 'host.ready') {
            handle.health = 'ready';
            state.ready = initResult;
        }
        if (handle.health !== 'ready') {
            throw new Error('Process failed to become ready after init');
        }
        return handle;
    } catch (err: unknown) {
        handle.health = 'failed';
        const message = err instanceof Error ? err.message : String(err);
        try {
            if (!child.killed) child.kill('SIGTERM');
        } catch {
            /* ignore */
        }
        clearBridgeResources(request.pluginId, id);
        handle.health = 'stopped';
        throw new Error(`Process establish failed: ${message}`);
    }
}

export async function launchContainer(
    request: RuntimeLaunchRequest,
): Promise<IsolatedRuntimeHandle> {
    throw new Error(
        `[${request.pluginId}] Container runtime unavailable (not configured/implemented).`,
    );
}

export async function launchExternal(
    request: RuntimeLaunchRequest,
): Promise<IsolatedRuntimeHandle> {
    throw new Error(
        `[${request.pluginId}] External/Pterodactyl runtime unavailable (optional backend not configured).`,
    );
}

export async function launchRuntime(
    level: IsolationLevel,
    request: RuntimeLaunchRequest,
): Promise<IsolatedRuntimeHandle> {
    switch (level) {
        case 'in-process':
            return launchInProcess(request);
        case 'worker':
            return launchWorker(request);
        case 'process':
            return launchProcess(request);
        case 'container':
            return launchContainer(request);
        case 'external':
            return launchExternal(request);
        default: {
            const _e: never = level;
            throw new Error(`Unknown isolation: ${String(_e)}`);
        }
    }
}

export { countOwned };
