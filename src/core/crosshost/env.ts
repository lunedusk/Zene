import { secrets } from '#core/helpers/secretManager.js';
import type { CompatMode, CrossHostEnv, CrossHostRole, ResolvedRedis, StrategyId, LoadWeights } from './types.js';

function parseCompatMode(raw: string | undefined): CompatMode {
    if (raw === 'range') return 'range';
    return 'strict';
}

function parsePort(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid CROSS_HOST_HTTP_PORT: ${raw}`);
    }
    return n;
}

function parseNonNegNumber(raw: string | undefined, fallback: number, name: string): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }
    return n;
}

function parseStrategy(raw: string | undefined): StrategyId {
    if (raw === 'sticky' || raw === 'manual' || raw === 'region_aware' || raw === 'least_loaded') {
        return raw;
    }
    return 'least_loaded';
}

function parseManualShards(raw: string | undefined): Readonly<Record<string, readonly number[]>> {
    if (raw === undefined || raw === '') return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('CROSS_HOST_MANUAL_SHARDS must be valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('CROSS_HOST_MANUAL_SHARDS must be an object of machineId → number[]');
    }
    const out: Record<string, number[]> = {};
    for (const [machineId, shards] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(shards)) {
            throw new Error(`CROSS_HOST_MANUAL_SHARDS[${machineId}] must be an array`);
        }
        const ids: number[] = [];
        for (const s of shards) {
            if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) {
                throw new Error(`CROSS_HOST_MANUAL_SHARDS[${machineId}] has invalid shard id`);
            }
            ids.push(s);
        }
        out[machineId] = ids;
    }
    return out;
}

function parseLoadWeights(): LoadWeights {
    return {
        guild: parseNonNegNumber(secrets.getOptional('CROSS_HOST_LOAD_WEIGHT_GUILD'), 1, 'CROSS_HOST_LOAD_WEIGHT_GUILD'),
        member: parseNonNegNumber(secrets.getOptional('CROSS_HOST_LOAD_WEIGHT_MEMBER'), 0.001, 'CROSS_HOST_LOAD_WEIGHT_MEMBER'),
        event: parseNonNegNumber(secrets.getOptional('CROSS_HOST_LOAD_WEIGHT_EVENT'), 10, 'CROSS_HOST_LOAD_WEIGHT_EVENT'),
        command: parseNonNegNumber(secrets.getOptional('CROSS_HOST_LOAD_WEIGHT_COMMAND'), 20, 'CROSS_HOST_LOAD_WEIGHT_COMMAND'),
        shard: parseNonNegNumber(secrets.getOptional('CROSS_HOST_LOAD_WEIGHT_SHARD'), 0.5, 'CROSS_HOST_LOAD_WEIGHT_SHARD'),
    };
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }
    return n;
}

export function loadCrossHostEnv(): CrossHostEnv {
    const enabled = secrets.getBoolean('CROSS_HOST', false);
    const roleRaw = secrets.getOptional('CROSS_HOST_ROLE');
    let role: CrossHostRole | null = null;
    if (roleRaw === 'orchestrator' || roleRaw === 'worker') {
        role = roleRaw;
    }

    const clusterSecret = secrets.getOptional('CROSS_HOST_CLUSTER_SECRET') ?? '';
    const machineId = secrets.getOptional('CROSS_HOST_MACHINE_ID') ?? null;
    const orchestratorUrl = secrets.getOptional('CROSS_HOST_ORCHESTRATOR_URL') ?? null;

    return {
        enabled,
        role,
        machineId,
        orchestratorUrl,
        clusterSecret,
        httpHost: secrets.getOptional('CROSS_HOST_HTTP_HOST') ?? '0.0.0.0',
        httpPort: parsePort(secrets.getOptional('CROSS_HOST_HTTP_PORT'), 8020),
        compatMode: parseCompatMode(secrets.getOptional('CROSS_HOST_COMPAT_MODE')),
        tokenTtlSec: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_TOKEN_TTL_SEC'),
            3600,
            'CROSS_HOST_TOKEN_TTL_SEC',
        ),
        mtlsEnabled: secrets.getBoolean('CROSS_HOST_MTLS_ENABLED', false),
        mtlsCertPath: secrets.getOptional('CROSS_HOST_MTLS_CERT_PATH') ?? null,
        mtlsKeyPath: secrets.getOptional('CROSS_HOST_MTLS_KEY_PATH') ?? null,
        mtlsCaPath: secrets.getOptional('CROSS_HOST_MTLS_CA_PATH') ?? null,
        heartbeatMs: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_HEARTBEAT_MS'),
            5000,
            'CROSS_HOST_HEARTBEAT_MS',
        ),
        suspectAfter: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_SUSPECT_AFTER'),
            3,
            'CROSS_HOST_SUSPECT_AFTER',
        ),
        deadGraceMs: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_DEAD_GRACE_MS'),
            15000,
            'CROSS_HOST_DEAD_GRACE_MS',
        ),
        totalShardsOverride: (() => {
            const raw = secrets.getOptional('CROSS_HOST_TOTAL_SHARDS');
            if (raw === undefined || raw === '') return null;
            const n = Number(raw);
            if (!Number.isInteger(n) || n < 1) {
                throw new Error(`Invalid CROSS_HOST_TOTAL_SHARDS: ${raw}`);
            }
            return n;
        })(),
        statsIntervalMs: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_STATS_INTERVAL_MS'),
            900000,
            'CROSS_HOST_STATS_INTERVAL_MS',
        ),
        rebalanceCooldownMs: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_REBALANCE_COOLDOWN_MS'),
            60000,
            'CROSS_HOST_REBALANCE_COOLDOWN_MS',
        ),
        loadImbalanceThreshold: parseNonNegNumber(
            secrets.getOptional('CROSS_HOST_LOAD_IMBALANCE_THRESHOLD'),
            0.25,
            'CROSS_HOST_LOAD_IMBALANCE_THRESHOLD',
        ),
        rebalanceMaxMoves: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_REBALANCE_MAX_MOVES'),
            32,
            'CROSS_HOST_REBALANCE_MAX_MOVES',
        ),
        rebalanceMinImprovement: parseNonNegNumber(
            secrets.getOptional('CROSS_HOST_REBALANCE_MIN_IMPROVEMENT'),
            0.05,
            'CROSS_HOST_REBALANCE_MIN_IMPROVEMENT',
        ),
        assignmentStrategy: parseStrategy(secrets.getOptional('CROSS_HOST_ASSIGNMENT_STRATEGY')),
        regionLabelKey: secrets.getOptional('CROSS_HOST_REGION_LABEL_KEY') ?? 'region',
        maxConcurrentUpdates: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_MAX_CONCURRENT_UPDATES'),
            1,
            'CROSS_HOST_MAX_CONCURRENT_UPDATES',
        ),
        loadWeights: parseLoadWeights(),
        manualShards: parseManualShards(secrets.getOptional('CROSS_HOST_MANUAL_SHARDS')),
        indexEnabled: secrets.getBoolean('CROSS_HOST_INDEX_ENABLED', false),
        indexBackend: 'redis',
        apiGatewayEnabled: secrets.getBoolean('CROSS_HOST_API_GATEWAY_ENABLED', true),
        apiProxyTimeoutMs: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_API_PROXY_TIMEOUT_MS'),
            30_000,
            'CROSS_HOST_API_PROXY_TIMEOUT_MS',
        ),
        workerApiHost: secrets.getOptional('CROSS_HOST_WORKER_API_HOST') ?? '0.0.0.0',
        workerApiPort: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_WORKER_API_PORT') ?? secrets.getOptional('APIPort'),
            3000,
            'CROSS_HOST_WORKER_API_PORT',
        ),
        workerApiAdvertiseHost: secrets.getOptional('CROSS_HOST_WORKER_API_ADVERTISE_HOST') ?? null,
        indexRetentionDays: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_INDEX_RETENTION_DAYS'),
            14,
            'CROSS_HOST_INDEX_RETENTION_DAYS',
        ),
        queryTimeoutMs: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_QUERY_TIMEOUT_MS'),
            5000,
            'CROSS_HOST_QUERY_TIMEOUT_MS',
        ),
        queryConcurrency: parsePositiveInt(
            secrets.getOptional('CROSS_HOST_QUERY_CONCURRENCY'),
            16,
            'CROSS_HOST_QUERY_CONCURRENCY',
        ),
    };
}

function isRedisConfig(uri: string, engine: string | undefined): boolean {
    if (engine === 'redis') return true;
    try {
        const u = new URL(uri);
        const proto = u.protocol.replace(':', '');
        return proto === 'redis' || proto === 'rediss';
    } catch {
        return false;
    }
}

export function resolveCrossHostRedis(): ResolvedRedis {
    const raw = secrets.getOptional('Database') ?? '{}';
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Database env var is not valid JSON; required for Cross-Host Redis resolution');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Database env var must be a JSON object of alias → { uri, engine? }');
    }

    const map = parsed as Record<string, unknown>;

    const tryAlias = (alias: string): ResolvedRedis | null => {
        const entry = map[alias];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
        const rec = entry as Record<string, unknown>;
        const uri = rec.uri;
        if (typeof uri !== 'string' || uri.trim() === '') return null;
        const engine = typeof rec.engine === 'string' ? rec.engine : undefined;
        if (!isRedisConfig(uri, engine)) return null;
        return { alias, uri };
    };

    const preferred = tryAlias('crosshost');
    if (preferred) return preferred;

    const fallback = tryAlias('main');
    if (fallback) return fallback;

    throw new Error(
        'Cross-Host requires a Redis instance: set Database.crosshost (preferred) or Database.main with a redis:// or rediss:// URI (engine redis). Neither was available.',
    );
}
