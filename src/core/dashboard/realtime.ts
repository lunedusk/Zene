/**
 * Dashboard realtime authorization — uses existing event/SSE infrastructure.
 * Client metadata never grants authority; generation-scoped ownership.
 */

import { randomBytes } from 'node:crypto';
import {
    getDashboardSessionRecord,
    type DashboardSessionRecord,
    DashboardAuthError,
} from './authContext.js';
import {
    getContribution,
    type DashboardContributionRecord,
} from './contributionRegistry.js';
import { authorizeDashboardRequest } from './authorization.js';

export type RealtimeErrorCode =
    | 'unauthenticated'
    | 'session_expired'
    | 'session_revoked'
    | 'forbidden'
    | 'invalid_resource'
    | 'invalid_contribution'
    | 'stale_generation'
    | 'plugin_unavailable'
    | 'permission_denied';

export class DashboardRealtimeError extends Error {
    readonly code: RealtimeErrorCode;
    constructor(code: RealtimeErrorCode, message: string) {
        super(message);
        this.name = 'DashboardRealtimeError';
        this.code = code;
    }
}

export interface RealtimeConnection {
    readonly connectionId: string;
    readonly sessionId: string;
    readonly principalUserId: string;
    readonly pluginId?: string;
    readonly contributionId?: string;
    readonly runtimeId?: string;
    readonly generation?: number;
    readonly guildId?: string;
    readonly createdAt: number;
    alive: boolean;
}

export interface RealtimeSubscription {
    readonly subscriptionId: string;
    readonly connectionId: string;
    readonly channel: string;
    readonly pluginId: string;
    readonly contributionId: string;
    readonly runtimeId?: string;
    readonly generation?: number;
    readonly guildId?: string;
}

const connections = new Map<string, RealtimeConnection>();
const subscriptions = new Map<string, RealtimeSubscription>();
/** pluginId → connectionIds */
const byPlugin = new Map<string, Set<string>>();
/** sessionId → connectionIds */
const bySession = new Map<string, Set<string>>();

function mapAuthError(err: unknown): never {
    if (err instanceof DashboardAuthError) {
        const code =
            err.code === 'unauthenticated' || err.code === 'session_expired'
                ? (err.code as RealtimeErrorCode)
                : err.code === 'contribution_missing'
                  ? 'invalid_contribution'
                  : err.code === 'forbidden' || err.code === 'context_mismatch'
                    ? 'forbidden'
                    : 'forbidden';
        throw new DashboardRealtimeError(code, err.message);
    }
    throw err;
}

export function establishRealtimeConnection(input: {
    sessionId: string;
    contributionPluginId?: string;
    contributionId?: string;
    requestedGuildId?: string;
    clientClaims?: {
        userId?: string;
        guildId?: string;
        pluginId?: string;
        permissionBits?: readonly string[];
        generation?: number;
    };
}): RealtimeConnection {
    const session = getDashboardSessionRecord(input.sessionId);
    if (!session) {
        throw new DashboardRealtimeError('unauthenticated', 'Session required');
    }
    if (session.revoked) {
        throw new DashboardRealtimeError('session_revoked', 'Session revoked');
    }

    // Reject client generation/authority claims
    if (input.clientClaims?.permissionBits !== undefined) {
        throw new DashboardRealtimeError('forbidden', 'Client permissionBits rejected');
    }
    if (input.clientClaims?.generation !== undefined) {
        throw new DashboardRealtimeError('forbidden', 'Client generation claim rejected');
    }

    let contribution: DashboardContributionRecord | undefined;
    try {
        const auth = authorizeDashboardRequest({
            session,
            contributionPluginId: input.contributionPluginId,
            contributionId: input.contributionId,
            requestedGuildId: input.requestedGuildId,
            clientClaims: {
                userId: input.clientClaims?.userId,
                guildId: input.clientClaims?.guildId,
                pluginId: input.clientClaims?.pluginId,
            },
        });
        contribution = auth.contribution;
    } catch (err) {
        mapAuthError(err);
    }

    if (input.contributionId && input.contributionPluginId) {
        const c = getContribution(input.contributionPluginId, input.contributionId);
        if (!c || c.state !== 'active') {
            throw new DashboardRealtimeError(
                'invalid_contribution',
                'Contribution not active',
            );
        }
        if (c.kind !== 'realtime' && c.kind !== 'api_route' && c.kind !== 'widget') {
            // allow widget/api_route/realtime for streams
        }
        contribution = c;
    }

    const connectionId = randomBytes(16).toString('hex');
    const conn: RealtimeConnection = {
        connectionId,
        sessionId: session.sessionId,
        principalUserId: session.principal.userId,
        pluginId: contribution?.pluginId,
        contributionId: contribution?.contributionId,
        runtimeId: contribution?.runtimeId,
        generation: contribution?.generation,
        guildId: input.requestedGuildId,
        createdAt: Date.now(),
        alive: true,
    };
    connections.set(connectionId, conn);
    let ss = bySession.get(session.sessionId);
    if (!ss) {
        ss = new Set();
        bySession.set(session.sessionId, ss);
    }
    ss.add(connectionId);
    if (contribution?.pluginId) {
        let ps = byPlugin.get(contribution.pluginId);
        if (!ps) {
            ps = new Set();
            byPlugin.set(contribution.pluginId, ps);
        }
        ps.add(connectionId);
    }
    return conn;
}

export function subscribeRealtime(input: {
    connectionId: string;
    channel: string;
    contributionPluginId: string;
    contributionId: string;
    requestedGuildId?: string;
    clientClaims?: {
        userId?: string;
        guildId?: string;
        pluginId?: string;
        permissionBits?: readonly string[];
        generation?: number;
    };
}): RealtimeSubscription {
    const conn = connections.get(input.connectionId);
    if (!conn || !conn.alive) {
        throw new DashboardRealtimeError('unauthenticated', 'Connection not active');
    }
    const session = getDashboardSessionRecord(conn.sessionId);
    if (!session || session.revoked) {
        throw new DashboardRealtimeError('session_revoked', 'Session revoked');
    }
    if (input.clientClaims?.permissionBits !== undefined) {
        throw new DashboardRealtimeError('forbidden', 'Client permissionBits rejected');
    }
    if (input.clientClaims?.generation !== undefined) {
        throw new DashboardRealtimeError('forbidden', 'Client generation claim rejected');
    }

    const contribution = getContribution(
        input.contributionPluginId,
        input.contributionId,
    );
    if (!contribution || contribution.state !== 'active') {
        throw new DashboardRealtimeError(
            'invalid_contribution',
            'Contribution not available',
        );
    }
    // Stale generation vs connection binding
    if (
        conn.generation !== undefined &&
        contribution.generation !== undefined &&
        conn.generation !== contribution.generation &&
        conn.contributionId === contribution.contributionId
    ) {
        throw new DashboardRealtimeError('stale_generation', 'Stale contribution generation');
    }
    if (
        conn.pluginId &&
        contribution.pluginId !== conn.pluginId &&
        input.clientClaims?.pluginId === contribution.pluginId
    ) {
        // ok if switching with auth
    }

    try {
        authorizeDashboardRequest({
            session,
            contributionPluginId: contribution.pluginId,
            contributionId: contribution.contributionId,
            requestedGuildId: input.requestedGuildId ?? conn.guildId,
            clientClaims: {
                userId: input.clientClaims?.userId,
                guildId: input.clientClaims?.guildId,
                pluginId: input.clientClaims?.pluginId,
            },
        });
    } catch (err) {
        mapAuthError(err);
    }

    const subscriptionId = randomBytes(12).toString('hex');
    const sub: RealtimeSubscription = {
        subscriptionId,
        connectionId: conn.connectionId,
        channel: input.channel,
        pluginId: contribution.pluginId,
        contributionId: contribution.contributionId,
        runtimeId: contribution.runtimeId,
        generation: contribution.generation,
        guildId: input.requestedGuildId ?? conn.guildId,
    };
    subscriptions.set(subscriptionId, sub);
    return sub;
}

export function assertRealtimeGeneration(
    subscriptionId: string,
    expectedGeneration: number,
): void {
    const sub = subscriptions.get(subscriptionId);
    if (!sub) {
        throw new DashboardRealtimeError('invalid_resource', 'Unknown subscription');
    }
    if (sub.generation !== undefined && sub.generation !== expectedGeneration) {
        throw new DashboardRealtimeError('stale_generation', 'Stale generation');
    }
    const conn = connections.get(sub.connectionId);
    if (!conn?.alive) {
        throw new DashboardRealtimeError('unauthenticated', 'Connection closed');
    }
    const session = getDashboardSessionRecord(conn.sessionId);
    if (!session || session.revoked) {
        throw new DashboardRealtimeError('session_revoked', 'Session revoked');
    }
}

export function closeRealtimeConnection(connectionId: string): void {
    const conn = connections.get(connectionId);
    if (!conn) return;
    conn.alive = false;
    for (const [sid, sub] of subscriptions) {
        if (sub.connectionId === connectionId) subscriptions.delete(sid);
    }
    connections.delete(connectionId);
    bySession.get(conn.sessionId)?.delete(connectionId);
    if (conn.pluginId) byPlugin.get(conn.pluginId)?.delete(connectionId);
}

export function invalidateRealtimeForSession(sessionId: string): number {
    const set = bySession.get(sessionId);
    if (!set) return 0;
    let n = 0;
    for (const id of [...set]) {
        closeRealtimeConnection(id);
        n++;
    }
    bySession.delete(sessionId);
    return n;
}

export function invalidateRealtimeForPlugin(
    pluginId: string,
    runtimeId?: string,
    generation?: number,
): number {
    const set = byPlugin.get(pluginId);
    if (!set) return 0;
    let n = 0;
    for (const id of [...set]) {
        const conn = connections.get(id);
        if (!conn) continue;
        if (runtimeId !== undefined && conn.runtimeId !== runtimeId) continue;
        if (generation !== undefined && conn.generation !== generation) continue;
        closeRealtimeConnection(id);
        n++;
    }
    return n;
}

export function getRealtimeConnection(
    connectionId: string,
): RealtimeConnection | undefined {
    return connections.get(connectionId);
}

export function listRealtimeSubscriptions(
    connectionId: string,
): readonly RealtimeSubscription[] {
    return [...subscriptions.values()].filter((s) => s.connectionId === connectionId);
}

export function clearAllRealtime(): void {
    connections.clear();
    subscriptions.clear();
    byPlugin.clear();
    bySession.clear();
}
