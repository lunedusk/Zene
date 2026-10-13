import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:ClusterClient');

let machineToken: string | null = null;
let orchestratorUrl: string | null = null;

export function setClusterClientAuth(token: string, baseUrl: string): void {
    machineToken = token;
    orchestratorUrl = baseUrl.replace(/\/$/, '');
}

export function clearClusterClientAuth(): void {
    machineToken = null;
    orchestratorUrl = null;
}

function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
    if (!machineToken || !orchestratorUrl) {
        throw new Error('Cluster client not authenticated');
    }
    const url = joinUrl(orchestratorUrl, path);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${machineToken}`);
    if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
}

export interface ClusterShardDump {
    ok: boolean;
    totalShards: number;
    generation: number;
    owners: Record<string, number[]>;
    shardToMachine: Record<string, string>;
    workers?: Array<{ machineId: string; lastSeenAt: number; shards: number[] }>;
}

export async function fetchClusterShards(): Promise<ClusterShardDump> {
    const res = await authFetch('/cross-host/v1/cluster/shards');
    const json = (await res.json()) as ClusterShardDump & { message?: string };
    if (!res.ok || !json.ok) {
        throw new Error(json.message ?? `cluster/shards HTTP ${res.status}`);
    }
    return json;
}

export async function fetchGuildOwner(guildId: string): Promise<{
    guildId: string;
    shardId: number;
    machineId: string | null;
    totalShards: number;
}> {
    const res = await authFetch(
        `/cross-host/v1/cluster/guild-owner?guildId=${encodeURIComponent(guildId)}`,
    );
    const json = (await res.json()) as {
        ok: boolean;
        guildId: string;
        shardId: number;
        machineId: string | null;
        totalShards: number;
        message?: string;
    };
    if (!res.ok || !json.ok) {
        throw new Error(json.message ?? `guild-owner HTTP ${res.status}`);
    }
    return json;
}

export async function requestShardShift(
    shardId: number,
    toMachineId: string,
): Promise<{ from: string | null; to: string; generation: number }> {
    const res = await authFetch('/cross-host/v1/cluster/shard-shift', {
        method: 'POST',
        body: JSON.stringify({ shardId, toMachineId }),
    });
    const json = (await res.json()) as {
        ok: boolean;
        from: string | null;
        to: string;
        generation: number;
        message?: string;
    };
    if (!res.ok || !json.ok) {
        throw new Error(json.message ?? `shard-shift HTTP ${res.status}`);
    }
    log.info('Shard shift requested', { shardId, toMachineId, from: json.from });
    return { from: json.from, to: json.to, generation: json.generation };
}

export function isClusterClientReady(): boolean {
    return Boolean(machineToken && orchestratorUrl);
}
