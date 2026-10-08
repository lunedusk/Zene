/**
 * Frontend-facing contribution composition — Core registry is authoritative.
 * Presentation metadata only; every mutation re-authorizes on the server.
 */

import {
    listContributions,
    getContribution,
    type DashboardContributionRecord,
    type DashboardContributionKind,
} from './contributionRegistry.js';
import {
    getDashboardSessionRecord,
    DashboardAuthError,
} from './authContext.js';
import { authorizeDashboardRequest } from './authorization.js';

export interface FrontendContributionView {
    readonly contributionId: string;
    readonly pluginId: string;
    readonly kind: DashboardContributionKind;
    readonly scope: string;
    readonly title: string;
    readonly route?: string;
    readonly apiPath?: string;
    readonly order: number;
    readonly capability?: string;
    /** Declarative payload only — never remote script URLs */
    readonly payload: Readonly<Record<string, unknown>>;
    readonly runtimeId?: string;
    readonly generation?: number;
    readonly permissionBits: readonly string[];
}

const FORBIDDEN_PAYLOAD_KEYS = new Set([
    'scriptUrl',
    'remoteScript',
    'componentUrl',
    'moduleUrl',
    'eval',
]);

function sanitizePayload(
    payload: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
    if (!payload) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
        if (FORBIDDEN_PAYLOAD_KEYS.has(k)) continue;
        if (typeof v === 'string' && /^https?:\/\//i.test(v) && /script|module/i.test(k)) {
            continue;
        }
        out[k] = v;
    }
    return out;
}

function toView(rec: DashboardContributionRecord): FrontendContributionView {
    return {
        contributionId: rec.contributionId,
        pluginId: rec.pluginId,
        kind: rec.kind,
        scope: rec.scope,
        title: rec.title,
        route: rec.route,
        apiPath: rec.apiPath,
        order: rec.order,
        capability: rec.capability,
        payload: sanitizePayload(rec.payload),
        runtimeId: rec.runtimeId,
        generation: rec.generation,
        permissionBits: rec.permissionBits,
    };
}

/**
 * List contributions for frontend composition. Requires Core session.
 * UI visibility is presentation-only; bits are informational.
 */
export function listFrontendContributions(input: {
    sessionId: string;
    kinds?: readonly DashboardContributionKind[];
    pluginId?: string;
}): readonly FrontendContributionView[] {
    const session = getDashboardSessionRecord(input.sessionId);
    if (!session) {
        throw new DashboardAuthError('unauthenticated', 'Session required');
    }
    authorizeDashboardRequest({ session });
    let rows = listContributions({
        pluginId: input.pluginId,
    }).filter((c) => c.state === 'active');
    if (input.kinds && input.kinds.length > 0) {
        const set = new Set(input.kinds);
        rows = rows.filter((c) => set.has(c.kind));
    }
    return rows.map(toView);
}

export function getFrontendContribution(input: {
    sessionId: string;
    pluginId: string;
    contributionId: string;
}): FrontendContributionView {
    const session = getDashboardSessionRecord(input.sessionId);
    if (!session) {
        throw new DashboardAuthError('unauthenticated', 'Session required');
    }
    const rec = getContribution(input.pluginId, input.contributionId);
    if (!rec || rec.state !== 'active') {
        throw new DashboardAuthError('contribution_missing', 'Contribution not found');
    }
    authorizeDashboardRequest({
        session,
        contributionPluginId: input.pluginId,
        contributionId: input.contributionId,
    });
    return toView(rec);
}

/**
 * Execute a contribution action: re-authorize then invoke registered handler.
 */
export type ContributionActionHandler = (input: {
    principalUserId: string;
    pluginId: string;
    contributionId: string;
    body: unknown;
}) => Promise<unknown> | unknown;

const actionHandlers = new Map<string, ContributionActionHandler>();

function actionKey(pluginId: string, contributionId: string): string {
    return `${pluginId}::${contributionId}`;
}

export function registerContributionActionHandler(
    pluginId: string,
    contributionId: string,
    handler: ContributionActionHandler,
): void {
    actionHandlers.set(actionKey(pluginId, contributionId), handler);
}

export function clearContributionActionHandlers(): void {
    actionHandlers.clear();
}

export async function invokeContributionAction(input: {
    sessionId: string;
    pluginId: string;
    contributionId: string;
    body?: unknown;
    clientClaims?: {
        userId?: string;
        guildId?: string;
        pluginId?: string;
        permissionBits?: readonly string[];
    };
}): Promise<unknown> {
    const session = getDashboardSessionRecord(input.sessionId);
    if (!session) {
        throw new DashboardAuthError('unauthenticated', 'Session required');
    }
    const auth = authorizeDashboardRequest({
        session,
        contributionPluginId: input.pluginId,
        contributionId: input.contributionId,
        clientClaims: input.clientClaims,
    });
    const handler = actionHandlers.get(
        actionKey(input.pluginId, input.contributionId),
    );
    if (!handler) {
        throw new DashboardAuthError(
            'contribution_disabled',
            'No action handler for contribution',
        );
    }
    return handler({
        principalUserId: auth.principal.userId,
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        body: input.body,
    });
}
