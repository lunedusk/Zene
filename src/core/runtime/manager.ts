import path from 'node:path';
import { materializeVerifiedArtifact, disposeMaterialization, snapshotDirectoryForExecution } from '#core/helpers/integrity/artifactMaterialization.js';
import { createPluginRuntimeRecord, deactivatePluginRuntimeRecord } from './pluginRuntimeRecord.js';
import { getAuthenticatedPluginContext } from '#core/helpers/integrity/authenticatedContext.js';
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
import { effectiveRuntimePolicy, getAuthenticatedRuntimeFloor } from './authenticatedPolicy.js';
import { invalidateBindingsForRuntime } from '#core/provider/binding.js';

const log = getLogger('RuntimeManager');

/** Public establishment-boundary error. Primary message is stable and plugin-facing. */
export class RuntimeEstablishError extends Error {
    readonly pluginId: string;
    readonly code: string | undefined;
    readonly path: string | undefined;
    override readonly cause: unknown;

    constructor(
        pluginId: string,
        message: string,
        options?: {
            readonly cause?: unknown;
            readonly code?: string;
            readonly path?: string;
        },
    ) {
        super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'RuntimeEstablishError';
        this.pluginId = pluginId;
        this.cause = options?.cause;
        this.code = options?.code;
        this.path = options?.path;
    }
}

function extractFsCode(err: unknown): string | undefined {
    if (err && typeof err === 'object' && 'code' in err) {
        const c = (err as { code?: unknown }).code;
        return typeof c === 'string' ? c : undefined;
    }
    return undefined;
}

function extractFsPath(err: unknown): string | undefined {
    if (err && typeof err === 'object' && 'path' in err) {
        const pth = (err as { path?: unknown }).path;
        return typeof pth === 'string' ? pth : undefined;
    }
    return undefined;
}

function toEstablishError(pluginId: string, err: unknown): RuntimeEstablishError {
    if (err instanceof RuntimeEstablishError) return err;
    const code = extractFsCode(err);
    const pathDetail = extractFsPath(err);
    const base =
        err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : 'unknown error';
    const msg =
        `Runtime establish failed for plugin '${pluginId}'` +
        (code ? ` (${code})` : '') +
        (pathDetail ? `: path ${pathDetail}` : `: ${base}`);
    return new RuntimeEstablishError(pluginId, msg, {
        cause: err,
        code,
        path: pathDetail,
    });
}

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
        pluginId?: string,
    ): RuntimeSelectionResult {
        return selectRuntime(policy, probeRuntimeAvailability(env), {
            requiredCapabilities: pluginId
                ? (getAuthenticatedRuntimeFloor(pluginId)?.requiredCapabilities ?? [])
                : [],
            allowedRuntimes: pluginId
                ? getAuthenticatedPluginContext(pluginId)?.signedPayload?.runtimeRequirements
                      ?.allowedRuntimes
                : undefined,
        });
    }

    async establish(
        request: Omit<RuntimeLaunchRequest, 'policy'> & {
            readonly policy?: RuntimePolicy;
        },
    ): Promise<{ selection: RuntimeSelectionResult; handle?: IsolatedRuntimeHandle }> {
        this.#ensureInvokerBound();
        const policy = request.policy ?? DEFAULT_RUNTIME_POLICY;
        const selection = this.select(policy, process.env, request.pluginId);
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

        // Do not overwrite a live runtime without explicit terminate/reload.
        const existing = this.#handles.get(request.pluginId);
        if (existing && existing.health !== 'stopped' && existing.health !== 'failed') {
            return {
                selection: {
                    ok: false,
                    code: 'rejected_policy',
                    message:
                        `Active runtime already exists for ${request.pluginId} (id=${existing.id}). Terminate or reload first.`,
                },
            };
        }
        if (existing) {
            await this.terminate(request.pluginId, 'replace-stale');
        }

        let materialization: Awaited<ReturnType<typeof materializeVerifiedArtifact>> | null =
            null;
        let handle: IsolatedRuntimeHandle | undefined;
        let recordCreated = false;

        try {
            let pluginDir = request.pluginDir;
            const entryRelative = request.entryRelative ?? 'index.js';
            const ctx = getAuthenticatedPluginContext(request.pluginId);

            if (request.pluginDir) {
                const alreadyMaterialized =
                    request.pluginDir.includes(`${path.sep}verified-artifacts${path.sep}`) ||
                    request.pluginDir.includes('/verified-artifacts/') ||
                    request.pluginDir.includes('\\verified-artifacts\\');
                if (alreadyMaterialized) {
                    pluginDir = request.pluginDir;
                } else if (ctx?.signedPayload?.integrity.files?.length) {
                    materialization = await materializeVerifiedArtifact({
                        pluginId: request.pluginId,
                        sourceDir: request.pluginDir,
                        artifactDigest: ctx.signedPayload.integrity.rootDigest,
                        files: ctx.signedPayload.integrity.files,
                        entryRelative,
                    });
                    pluginDir = materialization.materializedRoot;
                } else {
                    materialization = await snapshotDirectoryForExecution({
                        pluginId: request.pluginId,
                        sourceDir: request.pluginDir,
                        entryRelative,
                    });
                    pluginDir = materialization.materializedRoot;
                }
            }

            const artifactDigest =
                ctx?.integrityRootDigest ??
                ctx?.signedPayload?.integrity.rootDigest ??
                materialization?.artifactDigest ??
                `unauthenticated:${request.pluginId}`;

            const full: RuntimeLaunchRequest = {
                pluginId: request.pluginId,
                entryUrl: request.entryUrl,
                pluginDir,
                entryRelative,
                policy,
                env: request.env,
                inProcessHooks: request.inProcessHooks,
            };

            handle = await launchRuntime(selection.level, full);
            this.#handles.set(request.pluginId, handle);

            const record = createPluginRuntimeRecord({
                pluginId: request.pluginId,
                artifactDigest,
                materialization,
                securityContext: ctx ?? null,
                runtimeId: handle.id,
                runtimeGeneration: materialization?.generation ?? 1,
                runtimeLevel: handle.level,
            });
            recordCreated = true;
            record.runtimeHandle = handle;
            record.runtimeHealth = handle.health;
            record.lifecyclePhase = 'setup';

            const establishedRuntimeId = handle.id;
            resourceRegistry.track({
                pluginId: request.pluginId,
                kind: 'custom',
                releaseOn: 'unload',
                label: `runtime:${handle.level}:${handle.id}`,
                id: `runtime_handle_${handle.id}`,
                dispose: async () => {
                    // Generation-safe: only terminate if this handle is still the live one
                    const live = this.#handles.get(request.pluginId);
                    if (live && live.id === establishedRuntimeId) {
                        await this.terminate(request.pluginId, 'resource-release');
                    }
                },
            });

            log.info(
                `[${request.pluginId}] runtime established level=${handle.level} id=${handle.id}`,
            );
            return { selection, handle };
        } catch (err: unknown) {
            // Cleanup partial establishment — leave no live handle/record/materialization
            if (handle) {
                try {
                    await handle.terminate('establish-failed');
                } catch {
                    /* ignore */
                }
                if (this.#handles.get(request.pluginId)?.id === handle.id) {
                    this.#handles.delete(request.pluginId);
                }
                try {
                    invalidateBindingsForRuntime(handle.id);
                } catch {
                    /* ignore */
                }
            }
            if (recordCreated) {
                try {
                    const recMod = await import('./pluginRuntimeRecord.js');
                    if (handle) {
                        recMod.deactivatePluginRuntimeRecord(request.pluginId, handle.id);
                    } else {
                        recMod.deactivatePluginRuntimeRecord(request.pluginId);
                    }
                } catch {
                    /* ignore */
                }
            }
            if (materialization) {
                try {
                    await disposeMaterialization(materialization);
                } catch {
                    /* ignore */
                }
            }
            // Clear any resource trackers keyed to a failed handle (without running dispose that would re-terminate)
            if (handle) {
                try {
                    resourceRegistry.untrack(
                        request.pluginId,
                        `runtime_handle_${handle.id}`,
                    );
                } catch {
                    /* ignore */
                }
            }

            const wrapped = toEstablishError(request.pluginId, err);
            log.warn(`[${request.pluginId}] ${wrapped.message}`);
            throw wrapped;
        }
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
        const recMod = await import('./pluginRuntimeRecord.js');
        const rec = recMod.getActivePluginRuntimeRecord(pluginId);
        // Only dispose materialization belonging to THIS runtime generation
        const mat =
            rec && rec.runtimeId === runtimeId ? rec.materialization : null;
        await handle.terminate(reason);
        invalidateBindingsForRuntime(runtimeId);
        if (this.#handles.get(pluginId)?.id === runtimeId) {
            this.#handles.delete(pluginId);
        }
        if (mat) {
            try {
                await disposeMaterialization(mat);
            } catch {
                /* ignore */
            }
        }
        // Generation-scoped deactivation — will not clear a newer active record
        recMod.deactivatePluginRuntimeRecord(pluginId, runtimeId);
        try {
            resourceRegistry.untrack(pluginId, `runtime_handle_${runtimeId}`);
        } catch {
            /* ignore */
        }
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
