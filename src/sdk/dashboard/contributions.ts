import { getSdkBridge, assertBridgeAuthorized } from '../bridge.js';
import type { ContributionId, PluginId } from '../types.js';
import { SdkError } from '../types.js';
import type { SdkDashboardContributionInput, SdkDashboardContributionView } from '../bridge.js';

export type DashboardContributionKind =
    | 'page'
    | 'nav'
    | 'settings'
    | 'widget'
    | 'api_route'
    | 'realtime'
    | 'action'
    | 'privacy';

export type DashboardScope =
    | 'user'
    | 'guild'
    | 'server'
    | 'plugin'
    | 'global'
    | 'system';

export type DashboardContribution = SdkDashboardContributionView;

const OWNERSHIP_KEYS = new Set(['pluginId', 'runtimeId', 'generation']);

function stripOwnership(
    contribution: SdkDashboardContributionInput & Record<string, unknown>,
): SdkDashboardContributionInput {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(contribution)) {
        if (OWNERSHIP_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out as unknown as SdkDashboardContributionInput;
}

export function registerDashboardContribution(
    pluginId: PluginId,
    contribution: SdkDashboardContributionInput,
): string {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'dashboard.contribute');
    if (!contribution.contributionId || contribution.contributionId.length === 0) {
        throw new SdkError({
            code: 'DASH_CONTRIB_INVALID',
            message: 'contributionId is required',
        });
    }
    return bridge.dashboard.contribute(
        stripOwnership(
            contribution as SdkDashboardContributionInput & Record<string, unknown>,
        ),
    );
}

export function revokeDashboardContribution(
    pluginId: PluginId,
    contributionId: ContributionId,
): void {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'dashboard.revoke');
    bridge.dashboard.revoke(contributionId);
}

export function listDashboardContributions(
    pluginId: PluginId,
): readonly DashboardContribution[] {
    const bridge = getSdkBridge(pluginId);
    assertBridgeAuthorized(bridge, 'dashboard.list');
    return bridge.dashboard.list().map((c) => ({
        contributionId: c.contributionId,
        pluginId: c.pluginId,
        kind: c.kind as DashboardContributionKind,
        scope: c.scope as DashboardScope,
        title: c.title,
        route: c.route,
        apiPath: c.apiPath,
        permissionBits: c.permissionBits,
        capability: c.capability,
        order: c.order,
        payload: c.payload,
        runtimeId: c.runtimeId,
        generation: c.generation,
    }));
}
