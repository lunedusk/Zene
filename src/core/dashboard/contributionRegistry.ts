/**
 * Authoritative dashboard contribution registry.
 * Generation-scoped ownership; stale cleanup cannot remove newer generations.
 */

import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DashboardContributions');

export type DashboardContributionKind =
    | 'page'
    | 'nav'
    | 'navigation'
    | 'settings'
    | 'widget'
    | 'api_route'
    | 'api'
    | 'realtime'
    | 'action'
    | 'privacy';

export type DashboardScope = 'user' | 'server' | 'guild' | 'plugin' | 'global';

export type ContributionRegistrationState = 'active' | 'disabled';

export interface DashboardContributionRecord {
    readonly contributionId: string;
    readonly pluginId: string;
    readonly runtimeId?: string;
    readonly generation?: number;
    readonly kind: DashboardContributionKind;
    readonly scope: DashboardScope;
    readonly title: string;
    readonly route?: string;
    readonly apiPath?: string;
    readonly permissionBits: readonly string[];
    readonly capability?: string;
    readonly order: number;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly registeredAt: number;
    readonly state: ContributionRegistrationState;
}

/** pluginId → contributionId → record */
const byPlugin = new Map<string, Map<string, DashboardContributionRecord>>();

function normalizeKind(kind: DashboardContributionKind): DashboardContributionKind {
    if (kind === 'navigation') return 'nav';
    if (kind === 'api') return 'api_route';
    return kind;
}

export function registerContribution(
    input: Omit<
        DashboardContributionRecord,
        'registeredAt' | 'permissionBits' | 'order' | 'state'
    > & {
        permissionBits?: readonly string[];
        order?: number;
        state?: ContributionRegistrationState;
    },
): string {
    if (!input.contributionId || !input.pluginId) {
        throw new Error('contributionId and pluginId are required');
    }
    const kind = normalizeKind(input.kind);
    let map = byPlugin.get(input.pluginId);
    if (!map) {
        map = new Map();
        byPlugin.set(input.pluginId, map);
    }
    const existing = map.get(input.contributionId);
    if (
        existing &&
        existing.runtimeId !== undefined &&
        input.runtimeId !== undefined &&
        existing.runtimeId !== input.runtimeId &&
        (existing.generation ?? 0) > (input.generation ?? 0)
    ) {
        throw new Error(
            `Cannot overwrite newer contribution ${input.contributionId} with older generation`,
        );
    }
    const rec: DashboardContributionRecord = {
        contributionId: input.contributionId,
        pluginId: input.pluginId,
        runtimeId: input.runtimeId,
        generation: input.generation,
        kind,
        scope: input.scope,
        title: input.title,
        route: input.route,
        apiPath: input.apiPath ?? input.route,
        permissionBits: input.permissionBits ?? [],
        capability: input.capability,
        order: input.order ?? 0,
        payload: input.payload,
        registeredAt: Date.now(),
        state: input.state ?? 'active',
    };
    map.set(rec.contributionId, rec);
    log.debug(
        `[${input.pluginId}] dashboard contribution ${rec.kind}/${rec.contributionId} gen=${String(rec.generation)}`,
    );
    return rec.contributionId;
}

export function revokeContribution(
    pluginId: string,
    contributionId: string,
    filter?: { runtimeId?: string; generation?: number },
): boolean {
    const map = byPlugin.get(pluginId);
    if (!map) return false;
    const rec = map.get(contributionId);
    if (!rec) return false;
    if (filter?.runtimeId !== undefined && rec.runtimeId !== filter.runtimeId) {
        return false;
    }
    if (filter?.generation !== undefined && rec.generation !== filter.generation) {
        return false;
    }
    map.delete(contributionId);
    if (map.size === 0) byPlugin.delete(pluginId);
    return true;
}

export function revokeAllForPlugin(
    pluginId: string,
    runtimeId?: string,
    generation?: number,
): number {
    const map = byPlugin.get(pluginId);
    if (!map) return 0;
    if (runtimeId === undefined && generation === undefined) {
        const n = map.size;
        byPlugin.delete(pluginId);
        return n;
    }
    let n = 0;
    for (const [id, rec] of map) {
        if (runtimeId !== undefined && rec.runtimeId !== runtimeId) continue;
        if (generation !== undefined && rec.generation !== generation) continue;
        map.delete(id);
        n++;
    }
    if (map.size === 0) byPlugin.delete(pluginId);
    if (n > 0) {
        void import('./realtime.js')
            .then(({ invalidateRealtimeForPlugin }) => {
                invalidateRealtimeForPlugin(pluginId, runtimeId, generation);
            })
            .catch(() => undefined);
    }
    return n;
}

export function getContribution(
    pluginId: string,
    contributionId: string,
): DashboardContributionRecord | undefined {
    return byPlugin.get(pluginId)?.get(contributionId);
}

export function resolveContributionByApiPath(
    apiPath: string,
): DashboardContributionRecord | undefined {
    const normalized = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    for (const map of byPlugin.values()) {
        for (const rec of map.values()) {
            if (rec.state !== 'active') continue;
            if (rec.kind !== 'api_route' && rec.kind !== 'api') continue;
            const path = rec.apiPath ?? rec.route;
            if (!path) continue;
            const p = path.startsWith('/') ? path : `/${path}`;
            if (p === normalized || normalized.startsWith(`${p}/`)) {
                return rec;
            }
        }
    }
    return undefined;
}

export function listContributions(filter?: {
    pluginId?: string;
    scope?: DashboardScope;
    kind?: DashboardContributionKind;
}): readonly DashboardContributionRecord[] {
    const out: DashboardContributionRecord[] = [];
    for (const [pluginId, map] of byPlugin) {
        if (filter?.pluginId && filter.pluginId !== pluginId) continue;
        for (const rec of map.values()) {
            if (filter?.scope && rec.scope !== filter.scope) continue;
            if (filter?.kind) {
                const k = normalizeKind(filter.kind);
                if (rec.kind !== k) continue;
            }
            out.push(rec);
        }
    }
    return out.sort((a, b) => a.order - b.order);
}

export function clearAllContributions(): void {
    byPlugin.clear();
}
