/**
 * Operational plugin/runtime status — no sensitive material.
 */

import { runtimeManager } from '#core/runtime/manager.js';
import { listActivePluginRuntimeRecords } from '#core/runtime/pluginRuntimeRecord.js';
import { getAuthenticatedPluginContext } from '#core/helpers/integrity/authenticatedContext.js';

export interface PluginOperationalStatus {
    readonly pluginId: string;
    readonly trust: 'trusted' | 'bypassed' | 'legacy' | 'unknown' | 'none';
    readonly running: boolean;
    readonly health: string;
    readonly runtimeType: string | null;
    readonly generation: number | null;
    readonly runtimeId: string | null;
    readonly artifactDigest: string | null;
    readonly lifecyclePhase: string | null;
    readonly lastError?: string;
}

export function getPluginOperationalStatus(
    pluginId: string,
): PluginOperationalStatus {
    const handle = runtimeManager.get(pluginId);
    const rec = listActivePluginRuntimeRecords().find((r) => r.pluginId === pluginId);
    const ctx = getAuthenticatedPluginContext(pluginId);
    let trust: PluginOperationalStatus['trust'] = 'none';
    if (ctx) {
        if (ctx.trustOutcome === 'trusted') trust = 'trusted';
        else if (ctx.trustOutcome === 'bypassed') trust = 'bypassed';
        else if (ctx.profile === 'legacy-signed') trust = 'legacy';
        else trust = 'unknown';
    }
    return {
        pluginId,
        trust,
        running: !!handle && handle.health === 'ready',
        health: handle?.health ?? rec?.runtimeHealth ?? 'stopped',
        runtimeType: handle?.level ?? rec?.runtimeLevel ?? null,
        generation: rec?.runtimeGeneration ?? null,
        runtimeId: handle?.id ?? rec?.runtimeId ?? null,
        artifactDigest: rec?.artifactDigest
            ? rec.artifactDigest.slice(0, 16)
            : null,
        lifecyclePhase: rec?.lifecyclePhase ?? null,
    };
}

export function listOperationalStatus(): readonly PluginOperationalStatus[] {
    const ids = new Set<string>();
    for (const h of runtimeManager.list()) ids.add(h.pluginId);
    for (const r of listActivePluginRuntimeRecords()) ids.add(r.pluginId);
    return [...ids].map(getPluginOperationalStatus);
}
