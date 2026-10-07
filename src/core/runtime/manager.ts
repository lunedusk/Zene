/**
 * Phase 2D — RuntimeManager is the runtime orchestration boundary for ALL backends.
 */

import { getLogger } from '#core/utils/logger.js';
import { resourceRegistry } from '#core/lifecycle/resourceRegistry.js';
import { probeRuntimeAvailability } from './availability.js';
import { selectRuntime } from './selector.js';
import { launchRuntime, type IsolatedRuntimeHandle } from './backends.js';
import {
    DEFAULT_RUNTIME_POLICY,
    ISOLATION_RANK,
    type IsolationLevel,
    type RuntimeLaunchRequest,
    type RuntimePolicy,
    type RuntimeSelectionResult,
} from './types.js';
import type { HostToCoreMessage } from './protocol.js';
import { setIsolatedInvoker } from './invokeBinding.js';
import { effectiveRuntimePolicy } from './authenticatedPolicy.js';
import { invalidateBindingsForRuntime } from '#core/provider/binding.js';

const log = getLogger('RuntimeManager');

export class RuntimeManager {
    readonly #handles = new Map<string, IsolatedRuntimeHandle>();
    #bound = false;

    #ensureInvokerBound(): void {
        if (this.#bound) return;
        this.#bound = true;
        setIsolatedInvoker(async (pluginId, kind, name, args) => {
            const handle = this.#handles.get(pluginId);
            if (!handle || handle.health !== 'ready') {
                throw new Error(`Isolated runtime not ready for ${pluginId}/${kind}/${name}`);
            }
            const res = await handle.request(
                {
                    requestId: `inv_${kind}_${name}_${Date.now()}`,
                    type: 'core.invoke',
                    payload: {
                        kind: kind as import('./protocol.js').BridgeRegisterKind,
                        name,
                        args,
                    },
                },
                8000,
            );
            if (res.type !== 'host.invoke.result') {
                throw new Error(`Unexpected invoke response: ${res.type}`);
            }
            if (!res.payload.ok) {
                throw new Error(res.payload.error ?? 'invoke failed');
            }
            return res.payload.result;
        });
    }

    get(pluginId: string): IsolatedRuntimeHandle | undefined {
        return this.#handles.get(pluginId);
    }

    select(
        policy: RuntimePolicy = DEFAULT_RUNTIME_POLICY,
        env: NodeJS.ProcessEnv = process.env,
    ): RuntimeSelectionResult {
        return selectRuntime(policy, probeRuntimeAvailability(env));
    }

    async establish(
        request: Omit<RuntimeLaunchRequest, 'policy'> & {
            readonly policy?: RuntimePolicy;
        },
    ): Promise<{ selection: RuntimeSelectionResult; handle?: IsolatedRuntimeHandle }> {
        this.#ensureInvokerBound();
        const policy = request.policy ?? DEFAULT_RUNTIME_POLICY;
        const selection = this.select(policy);
        if (!selection.ok) {
            log.warn(`[${request.pluginId}] runtime rejected: ${selection.message}`);
            return { selection };
        }

        if (selection.level === 'in-process' && !request.inProcessHooks) {
            return {
                selection: {
                    ok: false,
                    code: 'rejected_policy',
                    message:
                        'in-process runtime requires inProcessHooks provided by the loader.',
                },
            };
        }

        const full: RuntimeLaunchRequest = {
            pluginId: request.pluginId,
            entryUrl: request.entryUrl,
            pluginDir: request.pluginDir,
            entryRelative: request.entryRelative,
            policy,
            env: request.env,
            inProcessHooks: request.inProcessHooks,
        };

        const handle = await launchRuntime(selection.level, full);
        this.#handles.set(request.pluginId, handle);

        resourceRegistry.track({
            pluginId: request.pluginId,
            kind: 'custom',
            releaseOn: 'unload',
            label: `runtime:${handle.level}:${handle.id}`,
            id: `runtime_handle_${handle.id}`,
            dispose: async () => {
                await this.terminate(request.pluginId, 'resource-release');
            },
        });

        log.info(
            `[${request.pluginId}] runtime established level=${handle.level} id=${handle.id}`,
        );
        return { selection, handle };
    }

    async lifecycle(
        pluginId: string,
        op: 'setup' | 'enable' | 'disable' | 'unload',
        timeoutMs = 10000,
    ): Promise<HostToCoreMessage> {
        const handle = this.#handles.get(pluginId);
        if (!handle) throw new Error(`No runtime for plugin ${pluginId}`);
        return handle.request(
            {
                requestId: `life_${op}_${Date.now()}`,
                type: 'core.lifecycle',
                payload: { op },
            },
            timeoutMs,
        );
    }

    async getIdentity(pluginId: string): Promise<HostToCoreMessage> {
        const handle = this.#handles.get(pluginId);
        if (!handle) throw new Error(`No runtime for plugin ${pluginId}`);
        return handle.request({
            requestId: `id_${Date.now()}`,
            type: 'core.getIdentity',
            payload: {},
        });
    }

    async terminate(pluginId: string, reason?: string): Promise<boolean> {
        const handle = this.#handles.get(pluginId);
        if (!handle) return false;
        const runtimeId = handle.id;
        await handle.terminate(reason);
        invalidateBindingsForRuntime(runtimeId);
        this.#handles.delete(pluginId);
        return true;
    }

    async reload(
        request: Omit<RuntimeLaunchRequest, 'policy'> & {
            readonly policy?: RuntimePolicy;
        },
    ): Promise<{ selection: RuntimeSelectionResult; handle?: IsolatedRuntimeHandle }> {
        await this.terminate(request.pluginId, 'reload');
        return this.establish(request);
    }

    list(): readonly IsolatedRuntimeHandle[] {
        return [...this.#handles.values()];
    }
}

export const runtimeManager = new RuntimeManager();

export function isolationAtLeast(
    actual: IsolationLevel,
    minimum: IsolationLevel,
): boolean {
    return ISOLATION_RANK[actual] >= ISOLATION_RANK[minimum];
}

export function resolvePluginRuntimePolicy(
    pluginId: string,
    env: NodeJS.ProcessEnv = process.env,
): RuntimePolicy {
    const key = `ZENE_PLUGIN_RUNTIME_${pluginId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
    const raw = (env[key] || env.ZENE_DEFAULT_RUNTIME || 'process').toLowerCase().trim();

    const levels: IsolationLevel[] = [
        'in-process',
        'worker',
        'process',
        'container',
        'external',
    ];
    const level = (levels as readonly string[]).includes(raw)
        ? (raw as IsolationLevel)
        : 'process';

    // Phase 2E: operator preference cannot weaken authenticated floor.
    return effectiveRuntimePolicy(pluginId, {
        preferred: level,
        minimum: level,
        allowed: [level],
        allowFallback: false,
    });
}
