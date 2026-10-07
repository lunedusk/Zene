/**
 * Authoritative Core-owned plugin runtime record.
 * Other maps (registry, handles, bootStatuses) are projections.
 */

import type { BasePlugin } from '#core/bases/Plugin.js';
import type { IsolationLevel, RuntimeHealth } from './types.js';
import type { IsolatedRuntimeHandle } from './backends.js';
import type { MaterializedArtifact } from '#core/helpers/integrity/artifactMaterialization.js';
import type { AuthenticatedPluginContext } from '#core/helpers/integrity/authenticatedContext.js';
import { PluginBootStatus } from '#core/loader/types.js';

export type LifecyclePhase =
    | 'discovered'
    | 'preloaded'
    | 'establishing'
    | 'setup'
    | 'enabled'
    | 'disabling'
    | 'disabled'
    | 'unloaded'
    | 'failed'
    | 'terminated';

export interface PluginRuntimeRecord {
    readonly pluginId: string;
    readonly artifactDigest: string;
    readonly materialization: MaterializedArtifact | null;
    securityContext: AuthenticatedPluginContext | null;
    readonly runtimeId: string;
    readonly runtimeGeneration: number;
    runtimeLevel: IsolationLevel;
    runtimeHealth: RuntimeHealth;
    lifecyclePhase: LifecyclePhase;
    bootStatus: PluginBootStatus;
    runtimeHandle: IsolatedRuntimeHandle | null;
    inProcessInstance: BasePlugin | null;
    active: boolean;
}

/** pluginId → active record (at most one active per pluginId). */
const activeByPlugin = new Map<string, PluginRuntimeRecord>();
/** runtimeId → record */
const byRuntimeId = new Map<string, PluginRuntimeRecord>();
/** historical generations retained briefly for stale rejection */
const byGeneration = new Map<string, PluginRuntimeRecord>();

function genKey(pluginId: string, generation: number): string {
    return `${pluginId}#${generation}`;
}

export function createPluginRuntimeRecord(input: {
    pluginId: string;
    artifactDigest: string;
    materialization: MaterializedArtifact | null;
    securityContext: AuthenticatedPluginContext | null;
    runtimeId: string;
    runtimeGeneration: number;
    runtimeLevel: IsolationLevel;
}): PluginRuntimeRecord {
    // Deactivate any previous active record for this plugin
    const prev = activeByPlugin.get(input.pluginId);
    if (prev && prev.active) {
        prev.active = false;
        prev.lifecyclePhase = 'terminated';
        prev.runtimeHealth = 'stopped';
    }

    const record: PluginRuntimeRecord = {
        pluginId: input.pluginId,
        artifactDigest: input.artifactDigest,
        materialization: input.materialization,
        securityContext: input.securityContext,
        runtimeId: input.runtimeId,
        runtimeGeneration: input.runtimeGeneration,
        runtimeLevel: input.runtimeLevel,
        runtimeHealth: 'starting',
        lifecyclePhase: 'establishing',
        bootStatus: PluginBootStatus.Pending,
        runtimeHandle: null,
        inProcessInstance: null,
        active: true,
    };
    activeByPlugin.set(input.pluginId, record);
    byRuntimeId.set(input.runtimeId, record);
    byGeneration.set(genKey(input.pluginId, input.runtimeGeneration), record);
    return record;
}

export function getActivePluginRuntimeRecord(
    pluginId: string,
): PluginRuntimeRecord | undefined {
    const r = activeByPlugin.get(pluginId);
    return r?.active ? r : undefined;
}

export function getPluginRuntimeRecordByRuntimeId(
    runtimeId: string,
): PluginRuntimeRecord | undefined {
    return byRuntimeId.get(runtimeId);
}

export function deactivatePluginRuntimeRecord(
    pluginId: string,
    runtimeId?: string,
): void {
    const r = activeByPlugin.get(pluginId);
    if (!r) return;
    if (runtimeId && r.runtimeId !== runtimeId) return;
    r.active = false;
    r.lifecyclePhase = 'terminated';
    r.runtimeHealth = 'stopped';
    r.runtimeHandle = null;
    r.inProcessInstance = null;
    r.securityContext = null;
}

export function listActivePluginRuntimeRecords(): readonly PluginRuntimeRecord[] {
    return [...activeByPlugin.values()].filter((r) => r.active);
}

export function countLoadedPluginRuntimeRecords(): number {
    return listActivePluginRuntimeRecords().filter(
        (r) =>
            r.bootStatus === PluginBootStatus.Success &&
            (r.lifecyclePhase === 'enabled' || r.lifecyclePhase === 'setup'),
    ).length;
}

export function getSecurityContextForRuntime(
    runtimeId: string,
): PluginRuntimeRecord['securityContext'] {
    return byRuntimeId.get(runtimeId)?.securityContext ?? null;
}

export function assertActiveGeneration(
    pluginId: string,
    runtimeId: string,
    generation?: number,
): PluginRuntimeRecord {
    const r = activeByPlugin.get(pluginId);
    if (!r || !r.active) {
        throw new Error(`No active runtime record for plugin '${pluginId}'`);
    }
    if (r.runtimeId !== runtimeId) {
        throw new Error(
            `Stale runtimeId for '${pluginId}': got ${runtimeId}, active=${r.runtimeId}`,
        );
    }
    if (generation !== undefined && r.runtimeGeneration !== generation) {
        throw new Error(
            `Stale generation for '${pluginId}': got ${generation}, active=${r.runtimeGeneration}`,
        );
    }
    return r;
}
