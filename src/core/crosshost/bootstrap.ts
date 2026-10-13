import { getLogger, flushLogs } from '#core/utils/logger.js';
import { redisDB } from '#core/database/redis.js';
import { secrets } from '#core/helpers/secretManager.js';
import { configManager } from '#core/manager/config.js';
import { i18n } from '#core/manager/lang.js';
import { emojis } from '#core/manager/emoji.js';
import type { CrossHostRole } from './types.js';
import { loadCrossHostEnv, resolveCrossHostRedis } from './env.js';
import { acquireOrchestratorClaim } from './auth/claim.js';
import {
    MembershipRegistry,
    discoverLocalDesiredState,
    resolveCoreVersion,
} from './orchestrator/membership.js';
import { startOrchestratorServer } from './orchestrator/server.js';
import { SnapshotService } from './orchestrator/snapshot.js';
import { ShardMap } from './orchestrator/shardMap.js';
import { IdentifyQueue } from './orchestrator/identifyQueue.js';
import { fetchGatewayBot } from './orchestrator/gatewayInfo.js';
import { registerWithOrchestrator, runWorkerControlPlane } from './worker/adapter.js';
import { channelHeartbeat, channelStats } from './protocol/channels.js';
import { decodeMessage } from './protocol/codec.js';
import { heartbeatSchema, statsMessageSchema } from './protocol/messages.js';
import { RebalanceEngine } from './orchestrator/rebalance.js';
import { UpdateController } from './orchestrator/updateController.js';
import type { WorkerStats } from './types.js';
import { assertCrossHostStorageAllowed } from './storageGate.js';
import { expandProcessEnv } from '#core/placeholder/index.js';
import { resolveIndexBackend } from './indexStore/resolve.js';
import { QueryRpcClient } from './query/rpc.js';
import type { IndexBackend } from './indexStore/types.js';
import { buildQueryFacade, setCrossHostQueryFacade } from './query/facade.js';
import { PeerRosterPublisher } from './orchestrator/peerRoster.js';
import { publishControlShutdown } from './worker/pluginBus.js';
import {
    registerFleetShutdownPublisher,
    registerMachineShutdownPublisher,
    registerShardOwnerResolver,
    performLocalShutdown,
} from '#core/heart/control.js';
import { channelControlShutdown } from './protocol/channels.js';
import { controlShutdownSchema } from './protocol/messages.js';

const log = getLogger('CrossHost');

async function runOrchestrator(): Promise<void> {
    expandProcessEnv();
    const env = loadCrossHostEnv();
    if (!env.clusterSecret) {
        throw new Error('CROSS_HOST_CLUSTER_SECRET is required for orchestrator role');
    }

    assertCrossHostStorageAllowed();

    const redisTarget = resolveCrossHostRedis();
    log.info('Connecting Cross-Host Redis', { alias: redisTarget.alias });
    await redisDB.connect(redisTarget.alias, redisTarget.uri);
    const clients = redisDB.get(redisTarget.alias);
    const channelPrefix = `zene:crosshost:${redisTarget.alias}`;

    const indexResolved = await resolveIndexBackend(env, clients.main, channelPrefix);
    const indexBackend: IndexBackend | null = indexResolved.enabled
        ? indexResolved.backend
        : null;
    if (!indexResolved.enabled) {
        log.info('Secondary index disabled', { reason: indexResolved.reason });
    } else {
        log.info('Secondary index enabled', { backend: indexBackend?.name });
        const trimTimer = setInterval(() => {
            void indexBackend
                ?.trim(env.indexRetentionDays)
                .catch((err) => log.warn('Index trim failed', err));
        }, 3_600_000);
        trimTimer.unref();
    }

    const queryClient = new QueryRpcClient(clients.pub, clients.sub, channelPrefix);
    await queryClient.start();

    const claim = await acquireOrchestratorClaim(clients.main);

    const token = secrets.get('DiscordToken');
    const gateway = await fetchGatewayBot(token);
    const totalShards = env.totalShardsOverride ?? gateway.shards;

    log.info('Loading orchestrator config/lang/emoji (source of truth)');
    await configManager.init(true);
    await i18n.init(true);
    await emojis.init(true);

    const coreVersion = await resolveCoreVersion();
    const desiredState = await discoverLocalDesiredState(coreVersion);
    log.info('Desired state resolved', {
        zeneVersion: desiredState.zeneVersion,
        pluginCount: desiredState.plugins.length,
        compatMode: env.compatMode,
        totalShards,
        maxConcurrency: gateway.maxConcurrency,
    });

    const membership = new MembershipRegistry(
        {
            clusterSecret: env.clusterSecret,
            compatMode: env.compatMode,
            tokenTtlSec: env.tokenTtlSec,
            redisAlias: redisTarget.alias,
            channelPrefix,
        },
        desiredState,
    );
    membership.setTotalShards(totalShards);

    const peerRoster = new PeerRosterPublisher(clients.main, channelPrefix);
    const publishRoster = async () => {
        const ids = membership.listWorkers().map((w) => w.machineId);
        await peerRoster.publish(ids);
    };

    const snapshot = new SnapshotService(
        clients.main,
        clients.pub,
        channelPrefix,
        (v) => membership.setSnapshotVersion(v),
    );
    await snapshot.publishFromManagers(true);

    const shardMap = new ShardMap(totalShards, clients.pub, channelPrefix);
    membership.setShardLookup((machineId) => shardMap.shardsFor(machineId));

    const identifyQueue = new IdentifyQueue(
        gateway.maxConcurrency,
        clients.pub,
        channelPrefix,
        clients.main,
    );

    const workerStats = new Map<string, WorkerStats>();
    const updating = new Set<string>();
    const rebalance = new RebalanceEngine({
        env,
        membership,
        shardMap,
        identifyQueue,
        stats: workerStats,
        updating,
    });
    const updateController = new UpdateController({
        env,
        membership,
        shardMap,
        identifyQueue,
        pub: clients.pub,
        sub: clients.sub,
        channelPrefix,
        updating,
    });
    await updateController.start();

    const server = await startOrchestratorServer(
        env,
        membership,
        claim,
        snapshot,
        identifyQueue,
        shardMap,
        (machineId) => {
            void rebalance.onWorkerJoined(machineId).catch((err) =>
                log.warn('Join fill-unowned failed', err),
            );
        },
    );

    const pollSnapshot = setInterval(() => {
        void snapshot.publishFromManagers(false).catch((err) => {
            log.warn('Snapshot poll failed', err);
        });
    }, 5_000);
    pollSnapshot.unref();

    await clients.sub.subscribe(channelHeartbeat(channelPrefix), channelStats(channelPrefix));
    clients.sub.on('message', (channel, payload) => {
        try {
            const raw = decodeMessage(Buffer.from(payload, 'base64'));
            if (channel === channelHeartbeat(channelPrefix)) {
                const parsed = heartbeatSchema.safeParse(raw);
                if (!parsed.success) return;
                membership.touch(parsed.data.machineId);
                membership.setWorkerSnapshotAck(
                    parsed.data.machineId,
                    parsed.data.snapshotVersionAck,
                );
                membership.setWorkerShards(parsed.data.machineId, parsed.data.shards);
                if (parsed.data.apiBaseUrl !== undefined) {
                    membership.setApiBaseUrl(
                        parsed.data.machineId,
                        parsed.data.apiBaseUrl ?? null,
                    );
                }
                if (parsed.data.generation > membership.getGeneration()) {
                    membership.bumpGeneration(parsed.data.generation);
                }
                return;
            }
            if (channel === channelStats(channelPrefix)) {
                const parsed = statsMessageSchema.safeParse(raw);
                if (!parsed.success) return;
                rebalance.recordStats(parsed.data as WorkerStats);
            }
        } catch (err) {
            log.warn('Control message handling error', err);
        }
    });

    const failureWatch = setInterval(() => {
        const now = Date.now();
        const suspectMs = env.heartbeatMs * env.suspectAfter;
        const deadMs = suspectMs + env.deadGraceMs;
        for (const worker of [...membership.listWorkers()]) {
            const age = now - worker.lastSeenAt;
            if (age > deadMs) {
                log.warn('Worker dead; clearing shards and removing from membership', {
                    machineId: worker.machineId,
                    lastSeenAt: worker.lastSeenAt,
                    ageMs: age,
                });
                void import('#core/manager/event.js')
                    .then(({ eventBus }) =>
                        eventBus.emitConcurrent('crosshost.worker.dead', {
                            machineId: worker.machineId,
                            ageMs: age,
                        }),
                    )
                    .catch(() => undefined);
                void (async () => {
                    try {
                        await shardMap.clearMachine(worker.machineId, 'recovery');
                        membership.removeWorker(worker.machineId);
                        await rebalance.maybeRebalance(true);
                    } catch (err) {
                        log.warn('Dead-worker recovery failed', err);
                    }
                })();
            } else if (age > suspectMs) {
                log.warn('Worker suspect (missed heartbeats)', {
                    machineId: worker.machineId,
                    ageMs: age,
                });
            }
        }
    }, Math.max(env.heartbeatMs, 1000));
    failureWatch.unref();

    const rosterTimer = setInterval(() => {
        void publishRoster().catch((err) => log.warn('Roster publish failed', err));
    }, 5_000);
    rosterTimer.unref();
    void publishRoster();

    registerFleetShutdownPublisher(async (reason) => {
        await publishControlShutdown(clients.pub, channelPrefix, {
            scope: 'fleet',
            reason,
            fromMachineId: 'orchestrator',
        });
        await performLocalShutdown(reason);
    });
    registerMachineShutdownPublisher(async (machineId, reason) => {
        await publishControlShutdown(clients.pub, channelPrefix, {
            scope: 'machine',
            machineId,
            reason,
            fromMachineId: 'orchestrator',
        });
    });
    registerShardOwnerResolver((shardId) => shardMap.ownerOf(shardId));

    await clients.sub.subscribe(channelControlShutdown(channelPrefix));
    clients.sub.on('message', (channel, payload) => {
        if (channel !== channelControlShutdown(channelPrefix)) return;
        try {
            const raw = decodeMessage(Buffer.from(payload, 'base64'));
            const parsed = controlShutdownSchema.safeParse(raw);
            if (!parsed.success) return;
            if (parsed.data.scope === 'fleet' || parsed.data.scope === 'orchestrator') {
                void performLocalShutdown(parsed.data.reason);
            }
        } catch (err) {
            log.warn('Orchestrator shutdown message error', err);
        }
    });

    const rebalanceTimer = setInterval(() => {
        void rebalance.maybeRebalance(false).catch((err) => log.warn('Rebalance failed', err));
    }, Math.max(env.rebalanceCooldownMs, 5000));
    rebalanceTimer.unref();

    const updateTimer = setInterval(() => {
        void updateController.tick().catch((err) => log.warn('Update tick failed', err));
    }, 30_000);
    updateTimer.unref();

    void rebalance.maybeRebalance(true).catch((err) => log.warn('Initial rebalance failed', err));

    log.info('Orchestrator control plane ready', {
        totalShards,
        maxConcurrency: identifyQueue.getMaxConcurrency(),
        snapshotVersion: snapshot.getVersion(),
        strategy: env.assignmentStrategy,
        index: indexBackend?.name ?? 'off',
        queryTimeoutMs: env.queryTimeoutMs,
    });
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('crosshost.orchestrator.ready', {
                totalShards,
                strategy: env.assignmentStrategy,
                snapshotVersion: snapshot.getVersion(),
            }),
        )
        .catch(() => undefined);

    setCrossHostQueryFacade(
        buildQueryFacade({
            env,
            client: queryClient,
            listMachineIds: () => membership.listWorkers().map((w) => w.machineId),
            ownerOfShard: (shardId) => shardMap.ownerOf(shardId),
            index: indexBackend,
        }),
    );

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            log.warn(`Orchestrator received ${signal}; beginning full teardown`);
        } catch {

        }
        clearInterval(pollSnapshot);
        clearInterval(failureWatch);
        clearInterval(rebalanceTimer);
        clearInterval(updateTimer);
        clearInterval(rosterTimer);
        try {
            const { eventBus } = await import('#core/manager/event.js');
            void eventBus.emitConcurrent('system.shutdown.start', {
                signal,
                role: 'orchestrator',
                at: Date.now(),
            });
        } catch {

        }
        try {
            setCrossHostQueryFacade(null);
        } catch {

        }
        try {
            await server.stop();
        } catch (err: unknown) {
            const code =
                err && typeof err === 'object' && 'code' in err
                    ? String((err as { code: unknown }).code)
                    : '';
            if (code !== 'ERR_SERVER_NOT_RUNNING') {
                try {
                    log.error('Orchestrator HTTP stop error', err);
                } catch {
                    log.error('[CrossHost] Orchestrator HTTP stop error', err);
                }
            }
        }
        try {
            const { DatabaseManager } = await import('#core/database/index.js');
            await DatabaseManager.closeAll();
        } catch (err) {
            try {
                await redisDB.disconnectAll();
            } catch {

            }
            log.error('[CrossHost] Orchestrator DB teardown error', err);
        }
        try {
            const { eventBus } = await import('#core/manager/event.js');
            void eventBus.emitConcurrent('system.shutdown.complete', {
                signal,
                role: 'orchestrator',
                at: Date.now(),
            });
        } catch {

        }
        try {
            await flushLogs();
        } catch {

        }
        process.exit(0);
    };
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

}

async function runWorker(): Promise<void> {
    expandProcessEnv();
    const env = loadCrossHostEnv();
    if (!env.machineId) {
        throw new Error('CROSS_HOST_MACHINE_ID is required for worker role');
    }
    if (!env.orchestratorUrl) {
        throw new Error('CROSS_HOST_ORCHESTRATOR_URL is required for worker role');
    }
    if (!env.clusterSecret) {
        throw new Error('CROSS_HOST_CLUSTER_SECRET is required for worker role');
    }

    const { installWorkerSignalHandlers } = await import('./worker/shutdown.js');
    installWorkerSignalHandlers();

    assertCrossHostStorageAllowed();

    const redisTarget = resolveCrossHostRedis();
    const registration = await registerWithOrchestrator(env);

    await redisDB.connect(redisTarget.alias, redisTarget.uri);
    const clients = redisDB.get(redisTarget.alias);

    log.info('Worker connected to Redis after successful registration', {
        alias: redisTarget.alias,
        generation: registration.response.generation,
        assignedShards: registration.response.assignedShards,
        totalShards: registration.response.totalShards,
    });

    await runWorkerControlPlane(env, registration, clients);

    await new Promise<void>(() => {});
}

export async function runCrossHost(role: CrossHostRole): Promise<void> {
    log.info(`Cross-Host boot starting as ${role}`);
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('system.boot.start', {
                mode: `crosshost:${role}`,
                at: Date.now(),
            }),
        )
        .catch(() => undefined);
    if (role === 'orchestrator') {
        await runOrchestrator();
        return;
    }
    await runWorker();
}
