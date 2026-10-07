/**
 * Core-side bridge: real subsystem registration + RPC invoke to isolated host.
 */

import express, { type Router } from 'express';
import { eventBus } from '#core/manager/event.js';
import { interactionRegistry } from '#core/manager/interaction/registry.js';
import { httpServer } from '#core/manager/http/server.js';
import { handlerRegistry } from '#core/manager/handler/registry.js';
import { resourceRegistry } from '#core/lifecycle/resourceRegistry.js';
import { providerRegistry } from '#core/provider/registry.js';
import { BaseHandler } from '#core/bases/Handler.js';
import type { IHeart } from '#core/heart/index.js';
import { getLogger, type Logger } from '#core/utils/logger.js';
import { errorMessage } from './errors.js';
import type { BridgeRegisterKind, HostToCoreMessage } from './protocol.js';
import { getIsolatedInvoker } from './invokeBinding.js';
import { createProviderBinding, assertProviderBindingUsable } from '#core/provider/binding.js';
import { assertProviderRegistrationAllowed } from '#core/provider/declarations.js';
import { assertProviderFullyAuthorized } from '#core/provider/authorization.js';

const log = getLogger('RuntimeBridge');

interface OwnedReg {
    readonly kind: BridgeRegisterKind;
    readonly name: string;
    readonly resourceId?: string;
    readonly componentId?: string;
    readonly providerCategory?: string;
    readonly unsubEvent?: () => void;
    readonly routeBase?: string;
    readonly handlerName?: string;
}

const owned = new Map<string, OwnedReg[]>();

/** Minimal Core-owned Heart sufficient for BaseHandler construction (no Discord client). */
function createHandlerProxyHeart(pluginId: string): IHeart {
    const logger: Logger = getLogger(`IsolatedHandlerProxy:${pluginId}`);
    const deny = (domain: string): never => {
        throw new Error(
            `Isolated handler proxy: domain '${domain}' is Core-resident; use registration/RPC bridge.`,
        );
    };
    // Principled: only id + log are used by BaseHandler constructor / log path.
    // Other domains throw if accessed — not empty stubs.
    return {
        id: pluginId,
        get client(): never {
            return deny('client');
        },
        log: logger,
        get assets(): never {
            return deny('assets');
        },
        get system(): never {
            return deny('system');
        },
        get discord(): never {
            return deny('discord');
        },
        get db(): never {
            return deny('db');
        },
        get net(): never {
            return deny('net');
        },
        get toolbox(): never {
            return deny('toolbox');
        },
        get control(): never {
            return deny('control');
        },
        get crossHost(): never {
            return deny('crossHost');
        },
        get permissions(): never {
            return deny('permissions');
        },
        get token(): never {
            return deny('token');
        },
        get cache(): never {
            return deny('cache');
        },
        get guild(): never {
            return deny('guild');
        },
        get registry(): never {
            return deny('registry');
        },
        get paginator(): never {
            return deny('paginator');
        },
    };
}

/**
 * Core-resident BaseHandler registered in HandlerRegistry.
 * Executable body stays in Worker/Process; dispatch goes through RPC.
 */
export class IsolatedHandlerProxy extends BaseHandler {
    public readonly name: string;
    readonly #pluginId: string;
    readonly #runtimeId: string;

    constructor(pluginId: string, runtimeId: string, name: string) {
        super(createHandlerProxyHeart(pluginId));
        this.name = name;
        this.#pluginId = pluginId;
        this.#runtimeId = runtimeId;
    }

    get runtimeId(): string {
        return this.#runtimeId;
    }

    /** Dispatch through existing HandlerRegistry path → RPC → isolated host. */
    async run(args?: unknown): Promise<unknown> {
        return getIsolatedInvoker()(this.#pluginId, 'handler', this.name, args);
    }

    override async onTeardown(): Promise<void> {
        /* no local resources */
    }
}

function pushOwned(runtimeId: string, reg: OwnedReg): void {
    const list = owned.get(runtimeId) ?? [];
    list.push(reg);
    owned.set(runtimeId, list);
}

async function invokeIsolated(
    pluginId: string,
    kind: BridgeRegisterKind,
    name: string,
    args: unknown,
): Promise<unknown> {
    return getIsolatedInvoker()(pluginId, kind, name, args);
}

function trackOwnership(
    msg: HostToCoreMessage & { type: 'host.register' },
    extra: Partial<OwnedReg> = {},
): string {
    const handle = resourceRegistry.track({
        pluginId: msg.pluginId,
        kind: 'custom',
        releaseOn: 'unload',
        label: `iso:${msg.payload.kind}:${msg.payload.name}:${msg.runtimeId}`,
        id: `iso_${msg.runtimeId}_${msg.payload.kind}_${msg.payload.name}`,
        dispose: () => {
            log.debug(
                `[${msg.pluginId}] dispose ownership ${msg.payload.kind}/${msg.payload.name}`,
            );
        },
    });
    pushOwned(msg.runtimeId, {
        kind: msg.payload.kind,
        name: msg.payload.name,
        resourceId: handle.id,
        componentId: msg.payload.componentId,
        ...extra,
    });
    return handle.id;
}

export function handleHostMessage(msg: HostToCoreMessage): void {
    switch (msg.type) {
        case 'host.register': {
            const { kind, name, meta } = msg.payload;
            try {
                switch (kind) {
                    case 'event': {
                        const unsub = eventBus.on(
                            name,
                            async (...args: unknown[]) => {
                                await invokeIsolated(msg.pluginId, 'event', name, args);
                            },
                            { owner: msg.pluginId },
                        );
                        trackOwnership(msg, { unsubEvent: unsub });
                        log.info(
                            `[${msg.pluginId}] EventBus registered isolated event "${name}" runtime=${msg.runtimeId}`,
                        );
                        break;
                    }
                    case 'command': {
                        interactionRegistry.chat.register(
                            name,
                            async () => {
                                await invokeIsolated(msg.pluginId, 'command', name, null);
                            },
                            msg.pluginId,
                        );
                        trackOwnership(msg);
                        log.info(
                            `[${msg.pluginId}] interaction.chat registered isolated command "${name}"`,
                        );
                        break;
                    }
                    case 'interaction': {
                        interactionRegistry.button.register(
                            name,
                            async () => {
                                await invokeIsolated(msg.pluginId, 'interaction', name, null);
                            },
                            msg.pluginId,
                        );
                        trackOwnership(msg);
                        log.info(
                            `[${msg.pluginId}] interaction.button registered "${name}"`,
                        );
                        break;
                    }
                    case 'route': {
                        // Concrete path only — path-to-regexp v8 rejects bare '*'.
                        const base =
                            typeof meta?.path === 'string' && String(meta.path).startsWith('/')
                                ? String(meta.path)
                                : name.startsWith('/')
                                  ? name
                                  : `/${name}`;
                        if (base.includes('*') || base.includes(':')) {
                            throw new Error(
                                `Isolated route path must be a concrete path without wildcards/params (got ${base})`,
                            );
                        }
                        httpServer.init();
                        const router: Router = express.Router();
                        // Concrete GET / under the mount — no wildcard route patterns
                        router.get('/', async (_req, res) => {
                            try {
                                const result = await invokeIsolated(
                                    msg.pluginId,
                                    'route',
                                    name,
                                    { method: 'GET', path: base },
                                );
                                res.status(200).json(result ?? { ok: true });
                            } catch (err: unknown) {
                                res.status(500).json({ error: errorMessage(err) });
                            }
                        });
                        httpServer.registerRouter(base, router);
                        trackOwnership(msg, { routeBase: base });
                        log.info(
                            `[${msg.pluginId}] HTTP route registered base=${base}`,
                        );
                        break;
                    }
                    case 'handler': {
                        const proxy = new IsolatedHandlerProxy(
                            msg.pluginId,
                            msg.runtimeId,
                            name,
                        );
                        handlerRegistry.register(msg.pluginId, name, proxy);
                        trackOwnership(msg, { handlerName: name });
                        log.info(
                            `[${msg.pluginId}] HandlerRegistry registered IsolatedHandlerProxy "${name}" runtime=${msg.runtimeId}`,
                        );
                        break;
                    }
                    case 'resource': {
                        trackOwnership(msg);
                        break;
                    }
                    case 'provider': {
                        const category =
                            typeof meta?.category === 'string'
                                ? String(meta.category)
                                : 'plugin.custom';
                        const priority =
                            typeof meta?.priority === 'number' ? meta.priority : 0;
                        const runtimeId = msg.runtimeId;
                        const pluginId = msg.pluginId;
                        const trustOutcome =
                            meta?.trustOutcome === 'bypassed' ||
                            meta?.trustOutcome === 'trusted' ||
                            meta?.trustOutcome === 'rejected' ||
                            meta?.trustOutcome === 'unknown-signer' ||
                            meta?.trustOutcome === 'untrusted'
                                ? meta.trustOutcome
                                : 'trusted';
                        assertProviderRegistrationAllowed({
                            pluginId,
                            category,
                            id: name,
                            priority: Number.isInteger(priority) ? priority : 0,
                            trustOutcome,
                        });
                        assertProviderFullyAuthorized({
                            pluginId,
                            category,
                            id: name,
                            priority: Number.isInteger(priority) ? priority : 0,
                        });
                        const binding = createProviderBinding({
                            pluginId,
                            providerId: name,
                            category,
                            runtimeId,
                        });
                        providerRegistry.register({
                            id: name,
                            category,
                            version: '0.0.0-isolated',
                            priority: Number.isInteger(priority) ? priority : 0,
                            pluginId,
                            trusted: true,
                            available: true,
                            implementation: {
                                runtimeId,
                                pluginId,
                                bindingId: binding.bindingId,
                                generation: binding.generation,
                                stale: false,
                                async invoke(args: unknown): Promise<unknown> {
                                    assertProviderBindingUsable(
                                        category,
                                        name,
                                        pluginId,
                                        runtimeId,
                                    );
                                    const handle = providerRegistry.get(category, name);
                                    if (!handle || !handle.available) {
                                        throw new Error(
                                            `Provider ${category}/${name} unavailable`,
                                        );
                                    }
                                    return invokeIsolated(pluginId, 'provider', name, args);
                                },
                            },
                        });
                        trackOwnership(msg, { providerCategory: category });
                        log.info(
                            `[${msg.pluginId}] ProviderRegistry ${category}/${name}`,
                        );
                        break;
                    }
                    default: {
                        const _x: never = kind;
                        void _x;
                    }
                }
            } catch (err: unknown) {
                // Surface failure — do not pretend registration succeeded
                log.error(
                    `[${msg.pluginId}] bridge register FAILED ${kind}/${name}: ${errorMessage(err)}`,
                );
                throw err instanceof Error ? err : new Error(errorMessage(err));
            }
            break;
        }
        case 'host.unregister': {
            releaseNamed(msg.runtimeId, msg.payload.kind, msg.payload.name, msg.pluginId);
            break;
        }
        case 'host.error':
            log.warn(`[${msg.pluginId}] host error: ${msg.payload.message}`);
            break;
        default:
            break;
    }
}

function releaseNamed(
    runtimeId: string,
    kind: BridgeRegisterKind,
    name: string,
    pluginId: string,
): void {
    const list = owned.get(runtimeId);
    if (!list) return;
    const next: OwnedReg[] = [];
    for (const reg of list) {
        if (reg.kind === kind && reg.name === name) {
            disposeReg(pluginId, reg);
        } else {
            next.push(reg);
        }
    }
    owned.set(runtimeId, next);
}

function disposeReg(pluginId: string, reg: OwnedReg): void {
    if (reg.unsubEvent) {
        try {
            reg.unsubEvent();
        } catch {
            /* ignore */
        }
    }
    if (reg.routeBase) {
        try {
            httpServer.unregisterRouter(reg.routeBase);
        } catch {
            /* ignore */
        }
    }
    if (reg.handlerName) {
        try {
            handlerRegistry.unregister(pluginId, reg.handlerName);
        } catch {
            /* ignore */
        }
    }
    if (reg.kind === 'command' || reg.kind === 'interaction') {
        try {
            interactionRegistry.unregisterPlugin(pluginId);
        } catch {
            /* ignore */
        }
    }
    if (reg.kind === 'event') {
        try {
            eventBus.unregisterByOwner(pluginId);
        } catch {
            /* ignore */
        }
    }
    if (reg.resourceId) {
        resourceRegistry.untrack(pluginId, reg.resourceId);
    }
    if (reg.kind === 'provider' && reg.providerCategory) {
        try {
            const existing = providerRegistry.get(reg.providerCategory, reg.name);
            if (existing) {
                const impl = existing.implementation as { stale?: boolean };
                if (impl && typeof impl === 'object') {
                    (impl as { stale: boolean }).stale = true;
                }
                providerRegistry.unregister(reg.providerCategory, reg.name);
            }
        } catch {
            /* ignore */
        }
    }
}

export function clearBridgeResources(pluginId: string, runtimeId?: string): void {
    if (runtimeId) {
        const list = owned.get(runtimeId) ?? [];
        for (const reg of list) disposeReg(pluginId, reg);
        owned.delete(runtimeId);
        return;
    }
    for (const rid of [...owned.keys()]) {
        clearBridgeResources(pluginId, rid);
    }
}

export function countOwned(runtimeId: string): number {
    return owned.get(runtimeId)?.length ?? 0;
}
