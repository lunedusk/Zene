



export type CacheClass =
    | 'public'
    | 'session'
    | 'authorization'
    | 'configuration'
    | 'registry'
    | 'metric'
    | 'resource'
    | 'derived_index';

export type CacheScope = 'local' | 'distributed' | 'authoritative' | 'derived' | 'best_effort';

export interface CacheClassPolicy {
    readonly class: CacheClass;
    readonly scope: CacheScope;
    readonly defaultTtlSec: number;

    readonly keyDimensions: readonly string[];
    readonly notes: string;
}

export const CACHE_POLICIES: readonly CacheClassPolicy[] = [
    {
        class: 'public',
        scope: 'best_effort',
        defaultTtlSec: 60,
        keyDimensions: ['metricId'],
        notes: 'Allowlisted public telemetry only; never private operational data.',
    },
    {
        class: 'session',
        scope: 'local',
        defaultTtlSec: 300,
        keyDimensions: ['sessionId', 'userId'],
        notes: 'Session metadata; revocation must invalidate.',
    },
    {
        class: 'authorization',
        scope: 'local',
        defaultTtlSec: 300,
        keyDimensions: ['userId', 'guildId'],
        notes: 'PermissionCache remains authoritative via PermissionsManager; token ≠ permission freshness.',
    },
    {
        class: 'configuration',
        scope: 'distributed',
        defaultTtlSec: 120,
        keyDimensions: ['configKey'],
        notes: 'Theme/layout/config; invalidate on publish.',
    },
    {
        class: 'registry',
        scope: 'local',
        defaultTtlSec: 30,
        keyDimensions: ['userId', 'registryVersion'],
        notes: 'Per-actor projection; never share across users.',
    },
    {
        class: 'metric',
        scope: 'best_effort',
        defaultTtlSec: 15,
        keyDimensions: ['metricId', 'range'],
        notes: 'Derived aggregates.',
    },
    {
        class: 'resource',
        scope: 'local',
        defaultTtlSec: 60,
        keyDimensions: ['userId', 'resourceType', 'resourceId', 'guildId'],
        notes: 'User-sensitive resource payloads; include all auth dimensions in key.',
    },
    {
        class: 'derived_index',
        scope: 'derived',
        defaultTtlSec: 300,
        keyDimensions: ['indexName'],
        notes: 'Search indexes are derived; re-auth on query.',
    },
] as const;

export function cacheKey(parts: Record<string, string | number | undefined>): string {
    return Object.keys(parts)
        .sort()
        .map((k) => `${k}=${parts[k] ?? ''}`)
        .join('|');
}


export function assertAuthSensitiveKey(userId: string, key: string): void {
    if (!key.includes(`userId=${userId}`)) {
        throw new Error('CACHE_KEY_MISSING_USER');
    }
}
