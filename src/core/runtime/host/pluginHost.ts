/**
 * Shared runtime host for Worker and Process.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import type { CoreToHostMessage, HostToCoreMessage } from '../protocol.js';
import { RUNTIME_PROTOCOL_VERSION } from '../protocol.js';
import { errorMessage } from '../errors.js';
import { resolvePluginEntryArtifact } from '../hostResolve.js';

export type HostSend = (msg: HostToCoreMessage) => void;

export interface IsolatedPluginModule {
    onSetup?: () => void | Promise<void>;
    onEnable?: () => void | Promise<void>;
    onDisable?: () => void | Promise<void>;
    onUnload?: () => void | Promise<void>;
    getEvidence?: () => Record<string, string | number | boolean>;
    registerWithHost?: (
        register: (
            kind:
                | 'event'
                | 'handler'
                | 'route'
                | 'command'
                | 'interaction'
                | 'provider'
                | 'resource',
            name: string,
            meta?: Record<string, string | number | boolean>,
        ) => void,
    ) => void | Promise<void>;
    forceThrow?: () => void;
}

function assertInsideRoot(pluginDir: string, entryRelative: string): string {
    const root = path.resolve(pluginDir);
    const resolved = path.resolve(root, entryRelative);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Entrypoint outside pluginDir: ${entryRelative}`);
    }
    return resolved;
}


function adaptPluginModule(mod: {
    default?: unknown;
    onSetup?: IsolatedPluginModule['onSetup'];
    onEnable?: IsolatedPluginModule['onEnable'];
    onDisable?: IsolatedPluginModule['onDisable'];
    onUnload?: IsolatedPluginModule['onUnload'];
    getEvidence?: IsolatedPluginModule['getEvidence'];
    registerWithHost?: IsolatedPluginModule['registerWithHost'];
}): IsolatedPluginModule {
    const candidate = mod.default ?? mod;
    // Fixture / plain module shape
    if (
        candidate &&
        typeof candidate === 'object' &&
        (typeof (candidate as IsolatedPluginModule).onEnable === 'function' ||
            typeof (candidate as IsolatedPluginModule).onSetup === 'function' ||
            typeof (candidate as IsolatedPluginModule).registerWithHost === 'function')
    ) {
        return candidate as IsolatedPluginModule;
    }
    // Normal Zene compiled entry: default export is a BasePlugin subclass (no-arg ctor + hooks)
    if (typeof candidate === 'function') {
        const Ctor = candidate as new () => {
            onSetup?: () => void | Promise<void>;
            onEnable?: () => void | Promise<void>;
            onDisable?: () => void | Promise<void>;
            _injectCore?: (heart: unknown) => void;
            _setState?: (s: string) => void;
        };
        const instance = new Ctor();
        // Minimal isolated heart: log only; Discord client remains Core-resident.
        if (typeof instance._injectCore === 'function') {
            const log = {
                info: (...a: unknown[]) => console.log('[iso-plugin]', ...a),
                warn: (...a: unknown[]) => console.warn('[iso-plugin]', ...a),
                error: (...a: unknown[]) => console.error('[iso-plugin]', ...a),
                debug: (...a: unknown[]) => console.debug('[iso-plugin]', ...a),
            };
            try {
                instance._injectCore({
                    id: 'isolated',
                    log,
                    get client(): never {
                        throw new Error(
                            'Isolated runtime: Discord client is Core-resident; use host registration bridge for Core-side APIs.',
                        );
                    },
                });
            } catch {
                /* inject optional */
            }
        }
        return {
            onSetup: async () => {
                if (typeof instance.onSetup === 'function') await instance.onSetup();
            },
            onEnable: async () => {
                if (typeof instance.onEnable === 'function') await instance.onEnable();
            },
            onDisable: async () => {
                if (typeof instance.onDisable === 'function') await instance.onDisable();
            },
        };
    }
    // Named exports on module itself
    if (typeof mod.onEnable === 'function' || typeof mod.onSetup === 'function') {
        return mod as IsolatedPluginModule;
    }
    throw new Error('Plugin entry did not export a recognized plugin module or BasePlugin class');
}

export class PluginRuntimeHost {
    readonly runtimeId: string;
    readonly pluginId: string;
    readonly isolation: 'worker' | 'process';
    readonly #send: HostSend;
    #plugin: IsolatedPluginModule | null = null;
    #terminated = false;
    #setupRan = false;
    #enableRan = false;
    #disableRan = false;
    #unloadRan = false;
    readonly #invokeHandlers = new Map<
        string,
        (args: unknown) => unknown | Promise<unknown>
    >();

    constructor(
        runtimeId: string,
        pluginId: string,
        isolation: 'worker' | 'process',
        send: HostSend,
    ) {
        this.runtimeId = runtimeId;
        this.pluginId = pluginId;
        this.isolation = isolation;
        this.#send = send;
    }

    #base(requestId: string): Pick<
        HostToCoreMessage,
        'v' | 'runtimeId' | 'pluginId' | 'requestId' | 'direction'
    > {
        return {
            v: RUNTIME_PROTOCOL_VERSION,
            runtimeId: this.runtimeId,
            pluginId: this.pluginId,
            requestId,
            direction: 'host→core',
        };
    }

    async handle(msg: CoreToHostMessage): Promise<void> {
        if (this.#terminated) return;
        if (msg.runtimeId !== this.runtimeId || msg.pluginId !== this.pluginId) {
            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.error',
                payload: { message: 'runtimeId/pluginId mismatch', fatal: false },
            });
            return;
        }

        switch (msg.type) {
            case 'core.init':
                await this.#onInit(msg);
                break;
            case 'core.lifecycle':
                await this.#onLifecycle(msg);
                break;
            case 'core.ping':
                this.#send({
                    ...this.#base(msg.requestId),
                    type: 'host.pong',
                    payload: { t: msg.payload.t },
                });
                break;
            case 'core.getIdentity':
                this.#send({
                    ...this.#base(msg.requestId),
                    type: 'host.identity',
                    payload: {
                        pid: process.pid,
                        isMainThread,
                        pluginModuleLoaded: this.#plugin !== null,
                        envKeys: Object.keys(process.env).sort(),
                    },
                });
                break;
            case 'core.invoke':
                await this.#onInvoke(msg);
                break;
            case 'core.terminate':
                this.#terminated = true;
                try {
                    if (this.#plugin?.onUnload) await this.#plugin.onUnload();
                } catch {
                    /* ignore */
                }
                break;
            default: {
                const _x: never = msg;
                void _x;
            }
        }
    }

    async #onInit(
        msg: Extract<CoreToHostMessage, { type: 'core.init' }>,
    ): Promise<void> {
        try {
            if (msg.payload.approvedEnv) {
                for (const [k, v] of Object.entries(msg.payload.approvedEnv)) {
                    process.env[k] = v;
                }
            }
            const abs = resolvePluginEntryArtifact(
                msg.payload.pluginDir,
                msg.payload.entryRelative,
            );
            const mod = (await import(pathToFileURL(abs).href)) as {
                default?: unknown;
                onSetup?: IsolatedPluginModule['onSetup'];
                onEnable?: IsolatedPluginModule['onEnable'];
                onDisable?: IsolatedPluginModule['onDisable'];
                onUnload?: IsolatedPluginModule['onUnload'];
                getEvidence?: IsolatedPluginModule['getEvidence'];
                registerWithHost?: IsolatedPluginModule['registerWithHost'];
            };
            this.#plugin = adaptPluginModule(mod);
            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.ready',
                payload: {
                    pid: process.pid,
                    isMainThread,
                    isolation: this.isolation,
                    setupRan: this.#setupRan,
                },
            });
        } catch (err: unknown) {
            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.error',
                payload: {
                    message: errorMessage(err),
                    fatal: true,
                    phase: 'startup',
                    code: 'plugin_import_failed',
                },
            });
            this.#terminated = true;
            // Deterministic exit for process backend so no orphan after fatal init
            if (this.isolation === 'process') {
                setTimeout(() => process.exit(1), 50);
            }
        }
    }

    async #onLifecycle(
        msg: Extract<CoreToHostMessage, { type: 'core.lifecycle' }>,
    ): Promise<void> {
        const op = msg.payload.op;
        try {
            if (!this.#plugin) throw new Error('Plugin not loaded');
            if (op === 'setup') {
                if (this.#plugin.onSetup) await this.#plugin.onSetup();
                this.#setupRan = true;
            }
            if (op === 'enable') {
                if (this.#plugin.onEnable) await this.#plugin.onEnable();
                this.#enableRan = true;
                if (this.#plugin.registerWithHost) {
                    await this.#plugin.registerWithHost((kind, name, meta) => {
                        const key = `${kind}:${name}`;
                        this.#invokeHandlers.set(key, async (args: unknown) => {
                            return {
                                handled: true,
                                kind,
                                name,
                                args,
                                pid: process.pid,
                                isMainThread: isMainThread,
                            };
                        });
                        this.#send({
                            ...this.#base(`${msg.requestId}:reg:${kind}:${name}`),
                            type: 'host.register',
                            payload: {
                                kind,
                                name,
                                componentId: `${this.pluginId}:${name}`,
                                meta,
                            },
                        });
                    });
                }
            }
            if (op === 'disable') {
                if (this.#plugin.onDisable) await this.#plugin.onDisable();
                this.#disableRan = true;
            }
            if (op === 'unload') {
                if (this.#plugin.onUnload) await this.#plugin.onUnload();
                this.#unloadRan = true;
            }

            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.lifecycle.result',
                payload: {
                    op,
                    ok: true,
                    evidence: {
                        setupRan: this.#setupRan,
                        enableRan: this.#enableRan,
                        disableRan: this.#disableRan,
                        unloadRan: this.#unloadRan,
                        ...(this.#plugin.getEvidence?.() ?? {}),
                    },
                },
            });
        } catch (err: unknown) {
            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.lifecycle.result',
                payload: { op, ok: false, error: errorMessage(err) },
            });
        }
    }

    async #onInvoke(
        msg: Extract<CoreToHostMessage, { type: 'core.invoke' }>,
    ): Promise<void> {
        const key = `${msg.payload.kind}:${msg.payload.name}`;
        try {
            const fn = this.#invokeHandlers.get(key);
            if (!fn) {
                this.#send({
                    ...this.#base(msg.requestId),
                    type: 'host.invoke.result',
                    payload: {
                        ok: false,
                        error: `No isolated handler for ${key}`,
                    },
                });
                return;
            }
            const result = await fn(msg.payload.args);
            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.invoke.result',
                payload: { ok: true, result },
            });
        } catch (err: unknown) {
            this.#send({
                ...this.#base(msg.requestId),
                type: 'host.invoke.result',
                payload: { ok: false, error: errorMessage(err) },
            });
        }
    }
}
