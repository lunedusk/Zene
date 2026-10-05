/**
 * Phase 4 — Unified integrity gate for all privileged plugin contribution execution paths.
 */

import { assertPluginMayExecute, getPluginRuntimeIntegrity, setPluginRuntimeIntegrity, listRuntimeIntegrity } from './pluginRuntimeGate.js';
import type { PluginIntegrityInput } from './pluginIntegrity.js';

export type ContributionKind =
    | 'route'
    | 'page'
    | 'widget'
    | 'navigation'
    | 'realtime'
    | 'job'
    | 'search_provider'
    | 'tsx'
    | 'event_handler'
    | 'api'
    | 'lifecycle';

export type ContributionGateResult =
    | { ok: true; pluginId: string; kind: ContributionKind }
    | { ok: false; pluginId: string; kind: ContributionKind; state: string; reasons: readonly string[] };

/**
 * Must be called before any privileged plugin contribution executes.
 */
export function gatePluginContribution(pluginId: string, kind: ContributionKind): ContributionGateResult {
    const r = assertPluginMayExecute(pluginId);
    if (!r.ok) {
        return {
            ok: false,
            pluginId,
            kind,
            state: r.state,
            reasons: r.reasons,
        };
    }
    return { ok: true, pluginId, kind };
}

/**
 * Re-evaluate integrity (e.g. after hot reload / hash change).
 */
export function refreshPluginIntegrity(pluginId: string, input: PluginIntegrityInput): ContributionGateResult {
    setPluginRuntimeIntegrity(pluginId, input);
    return gatePluginContribution(pluginId, 'lifecycle');
}

export function requirePluginContribution(pluginId: string, kind: ContributionKind): void {
    const r = gatePluginContribution(pluginId, kind);
    if (!r.ok) {
        throw new Error(`plugin_contribution_denied:${pluginId}:${kind}:${r.state}:${r.reasons.join(',')}`);
    }
}

/** Audit helper: list known runtime integrity states */
export function auditPluginIntegrityStates(): Array<{
    pluginId: string;
    state: string;
    acceptContributions: boolean;
}> {
    return listRuntimeIntegrity().map(({ pluginId, result }) => ({
        pluginId,
        state: result.state,
        acceptContributions: result.acceptContributions,
    }));
}

export function isPluginContributionAllowed(pluginId: string): boolean {
    return assertPluginMayExecute(pluginId).ok;
}

export function getContributionIntegritySnapshot(pluginId: string): ReturnType<typeof getPluginRuntimeIntegrity> {
    return getPluginRuntimeIntegrity(pluginId);
}
