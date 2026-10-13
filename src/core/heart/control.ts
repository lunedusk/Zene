import { getLogger, flushLogs } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { markUpdaterHealthy } from '#core/manager/updater/index.js';
import { getCrossHostQuery } from '#core/crosshost/query/facade.js';
import type { CrossHostQueryFacade } from '#core/crosshost/query/facade.js';
import { getCrossHostWorkerMachineId, getCrossHostWorkerShards } from '#core/crosshost/runtimeFlag.js';
import type { CrossHostRole } from '#core/crosshost/types.js';
import { getHeartClient } from './holders.js';

const log = getLogger('Heart:Control');
const startedAt = Date.now();

export type ShutdownScope = 'local' | 'machine' | 'fleet';

let fleetShutdownPublisher: ((reason: string) => Promise<void>) | null = null;
let machineShutdownPublisher: ((machineId: string, reason: string) => Promise<void>) | null =
    null;
let shardOwnerResolver: ((shardId: number) => string | undefined) | null = null;

export function registerFleetShutdownPublisher(
    fn: ((reason: string) => Promise<void>) | null,
): void {
    fleetShutdownPublisher = fn;
}

export function registerMachineShutdownPublisher(
    fn: ((machineId: string, reason: string) => Promise<void>) | null,
): void {
    machineShutdownPublisher = fn;
}

export function registerShardOwnerResolver(
    fn: ((shardId: number) => string | undefined) | null,
): void {
    shardOwnerResolver = fn;
}

async function destroyClientIfAny(): Promise<void> {
    const client = getHeartClient();
    if (!client) return;
    try {
        client.destroy();
    } catch (err) {
        log.warn('Client destroy during shutdown failed', err);
    }
}

export async function performLocalShutdown(reason?: string): Promise<never> {
    log.warn('Local shutdown requested', { reason: reason ?? 'unspecified' });
    try {
        await destroyClientIfAny();
        await flushLogs();
    } catch (err) {
        log.error('Shutdown cleanup error', err);
    }
    process.exit(0);
}

export type ControlDomain = {
    readonly shutdown: (reason?: string) => Promise<never>;
    readonly requestRestart: (reason?: string) => Promise<never>;
    readonly shutdownFleet: (reason?: string) => Promise<void>;
    readonly shutdownMachine: (machineId: string, reason?: string) => Promise<void>;
    readonly shutdownShard: (shardId: number, reason?: string) => Promise<void>;
    readonly isCrossHost: () => boolean;
    readonly role: () => CrossHostRole | null;
    readonly machineId: () => string | null;
    readonly shards: () => readonly number[];
    readonly query: () => CrossHostQueryFacade | null;
    readonly uptimeMs: () => number;
    readonly pid: () => number;
    readonly nodeVersion: () => string;
    readonly markHealthy: () => void;
    readonly setGauge: (name: string, value: number) => void;
    readonly incGauge: (name: string, by?: number) => void;
};

let gaugeSet: ((name: string, value: number) => void) | null = null;
let gaugeInc: ((name: string, by?: number) => void) | null = null;

export function registerGaugeHandlers(
    set: ((name: string, value: number) => void) | null,
    inc: ((name: string, by?: number) => void) | null,
): void {
    gaugeSet = set;
    gaugeInc = inc;
}

function resolveRole(): CrossHostRole | null {
    if (!secrets.getBoolean('CROSS_HOST', false)) return null;
    const r = secrets.getOptional('CROSS_HOST_ROLE');
    if (r === 'orchestrator' || r === 'worker') return r;
    return null;
}

export const controlDomain: ControlDomain = Object.freeze({
    async shutdown(reason?: string): Promise<never> {
        return performLocalShutdown(reason);
    },
    async requestRestart(reason?: string): Promise<never> {
        log.warn('Restart requested', { reason: reason ?? 'unspecified' });
        try {
            await destroyClientIfAny();
            await flushLogs();
        } catch (err) {
            log.error('Restart cleanup error', err);
        }
        process.exit(75);
    },
    async shutdownFleet(reason?: string): Promise<void> {
        const msg = reason ?? 'fleet shutdown';
        if (fleetShutdownPublisher) {
            await fleetShutdownPublisher(msg);
            return;
        }
        if (secrets.getBoolean('CROSS_HOST', false)) {
            log.warn('Fleet shutdown requested but publisher not wired; shutting down local only');
        }
        await performLocalShutdown(msg);
    },
    async shutdownMachine(machineId: string, reason?: string): Promise<void> {
        if (!machineId) {
            throw new Error('shutdownMachine requires machineId');
        }
        const localId = getCrossHostWorkerMachineId() ?? secrets.getOptional('CROSS_HOST_MACHINE_ID');
        if (localId && localId === machineId) {
            await performLocalShutdown(reason);
            return;
        }
        if (machineShutdownPublisher) {
            await machineShutdownPublisher(machineId, reason ?? 'machine shutdown');
            return;
        }
        throw new Error(
            'shutdownMachine is only available when Cross-Host control plane has registered a publisher',
        );
    },
    async shutdownShard(shardId: number, reason?: string): Promise<void> {
        if (!Number.isInteger(shardId) || shardId < 0) {
            throw new Error(`Invalid shardId: ${shardId}`);
        }
        const localShards = getCrossHostWorkerShards();
        if (localShards.includes(shardId)) {
            await performLocalShutdown(reason ?? `shard ${shardId} local`);
            return;
        }
        if (!shardOwnerResolver) {
            throw new Error('shutdownShard requires Cross-Host shard owner resolver (orchestrator)');
        }
        const owner = shardOwnerResolver(shardId);
        if (!owner) {
            throw new Error(`No owner for shard ${shardId}`);
        }
        await controlDomain.shutdownMachine(owner, reason ?? `shard ${shardId}`);
    },
    isCrossHost(): boolean {
        return secrets.getBoolean('CROSS_HOST', false);
    },
    role: resolveRole,
    machineId(): string | null {
        return (
            getCrossHostWorkerMachineId() ??
            secrets.getOptional('CROSS_HOST_MACHINE_ID') ??
            null
        );
    },
    shards(): readonly number[] {
        return getCrossHostWorkerShards();
    },
    query: () => getCrossHostQuery(),
    uptimeMs: () => Date.now() - startedAt,
    pid: () => process.pid,
    nodeVersion: () => process.versions.node,
    markHealthy: () => {
        markUpdaterHealthy();
    },
    setGauge(name: string, value: number): void {
        if (gaugeSet) gaugeSet(name, value);
    },
    incGauge(name: string, by = 1): void {
        if (gaugeInc) gaugeInc(name, by);
    },
});
