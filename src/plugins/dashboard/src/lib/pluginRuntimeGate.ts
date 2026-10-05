/**
 * Phase 4 — Runtime integrity gate before privileged dashboard contribution execution.
 * Registry filtering is necessary but not sufficient; this blocks execution.
 */

import {
    evaluatePluginIntegrity,
    type PluginIntegrityInput,
    type PluginIntegrityResult,
    type PluginTrustState,
} from './pluginIntegrity.js';

const runtimeState = new Map<string, PluginIntegrityResult>();

export function setPluginRuntimeIntegrity(pluginId: string, input: PluginIntegrityInput): PluginIntegrityResult {
    const result = evaluatePluginIntegrity(input);
    runtimeState.set(pluginId, result);
    return result;
}

export function getPluginRuntimeIntegrity(pluginId: string): PluginIntegrityResult | null {
    return runtimeState.get(pluginId) ?? null;
}

export function clearPluginRuntimeIntegrity(pluginId: string): void {
    runtimeState.delete(pluginId);
}

/**
 * Throws / returns denial if plugin may not execute privileged contribution code.
 */
export function assertPluginMayExecute(
    pluginId: string,
): { ok: true } | { ok: false; state: PluginTrustState; reasons: readonly string[] } {
    const r = runtimeState.get(pluginId);
    if (!r) {
        // Unknown → deny privileged execution until integrity evaluated
        return { ok: false, state: 'invalid', reasons: ['integrity_not_evaluated'] };
    }
    if (!r.acceptContributions) {
        return { ok: false, state: r.state, reasons: r.reasons };
    }
    if (r.state === 'quarantined' || r.state === 'disabled' || r.state === 'invalid' || r.state === 'incompatible') {
        return { ok: false, state: r.state, reasons: r.reasons };
    }
    return { ok: true };
}

export function listRuntimeIntegrity(): Array<{ pluginId: string; result: PluginIntegrityResult }> {
    return [...runtimeState.entries()].map(([pluginId, result]) => ({ pluginId, result }));
}
