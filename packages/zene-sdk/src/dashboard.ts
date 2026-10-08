import { assertBridgeAuthorized, type SdkBridge } from './bridge.js';
import type { ContributionId } from './types.js';
import { SdkError } from './types.js';
import type {
    SdkDashboardContributionRegistration,
    SdkDashboardContributionView,
} from './bridge.js';

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
    contribution: SdkDashboardContributionRegistration & Record<string, unknown>,
): SdkDashboardContributionRegistration {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(contribution)) {
        if (OWNERSHIP_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out as unknown as SdkDashboardContributionRegistration;
}

export function registerDashboardContribution(
    bridge: SdkBridge,
    contribution: SdkDashboardContributionRegistration,
): string {
    assertBridgeAuthorized(bridge, 'dashboard.contribute');
    if (!contribution.contributionId || contribution.contributionId.length === 0) {
        throw new SdkError({
            code: 'DASH_CONTRIB_INVALID',
            message: 'contributionId is required',
        });
    }
    return bridge.dashboard.contribute(
        stripOwnership(
            contribution as SdkDashboardContributionRegistration & Record<string, unknown>,
        ),
    );
}

export function revokeDashboardContribution(
    bridge: SdkBridge,
    contributionId: ContributionId,
): void {
    assertBridgeAuthorized(bridge, 'dashboard.revoke');
    bridge.dashboard.revoke(contributionId);
}

export function listDashboardContributions(
    bridge: SdkBridge,
): readonly DashboardContribution[] {
    assertBridgeAuthorized(bridge, 'dashboard.list');
    return bridge.dashboard.list().map((c) => ({
        contributionId: c.contributionId,
        kind: c.kind as DashboardContributionKind,
        scope: c.scope as DashboardScope,
        title: c.title,
        route: c.route,
        apiPath: c.apiPath,
        permissionBits: c.permissionBits,
        capability: c.capability,
        order: c.order,
        payload: c.payload,
        pluginId: c.pluginId,
        runtimeId: c.runtimeId,
        generation: c.generation,
    }));
}
