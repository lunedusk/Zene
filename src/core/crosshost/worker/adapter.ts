import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type {
    CrossHostEnv,
    PluginIdVersion,
    RegisterResponseBody,
    ChallengeResponseBody,
    SnapshotEnvelope,
    SnapshotNotifyMessage,
    AssignmentUpdateMessage,
    IdentifyGrantMessage,
    HeartbeatMessage,
} from '../types.js';
import {
    buildManifestHash,
    computeRegisterHmac,
} from '../auth/hmac.js';
import {
    channelAssignmentUpdate,
    channelHeartbeat,
    channelIdentifyGrant,
    channelSnapshotNotify,
    channelUpdateInstruct,
    channelUpdateAck,
} from '../protocol/channels.js';
import { decodeMessage, encodeMessage } from '../protocol/codec.js';
import {
    snapshotNotifySchema,
    assignmentUpdateSchema,
    identifyGrantSchema,
    updateInstructSchema,
} from '../protocol/messages.js';
import type { Operation } from '../jsonPatch.js';
import {
    applyAssignment,
    createWorkerRuntimeState,
    ensurePluginsPreloaded,
    onIdentifyGrant,
    startClientIfNeeded,
    type WorkerRuntimeState,
} from './runtime.js';
import { StatsCollector } from './statsCollector.js';
import { workerHooks } from './hooks.js';
import type { UpdateInstructMessage, UpdateAckMessage, QueryOp } from '../types.js';
import { flushLogs } from '#core/utils/logger.js';
import { httpServer } from '#core/manager/http/server.js';
import { startQueryRpcServer } from '../query/rpc.js';
import { configureIndexWriter } from '../indexStore/writer.js';
import { resolveIndexBackend } from '../indexStore/resolve.js';
import { markCrossHostWorkerActive, setCrossHostWorkerShards } from '../runtimeFlag.js';
import { startWorkerPluginBus, publishControlShutdown } from './pluginBus.js';
import { setCrossHostBus } from '#core/heart/crossHost.js';
import {
    registerFleetShutdownPublisher,
    registerMachineShutdownPublisher,
    registerGaugeHandlers,
} from '#core/heart/control.js';
import { list as auditList, getById as auditGetById } from '#core/audit/index.js';
import { list as errorList, getById as errorGetById } from '#core/errors/index.js';

const log = getLogger('CrossHost:Worker');

let activeWorkerRuntime: WorkerRuntimeState | null = null;

export function getActiveWorkerRuntime(): WorkerRuntimeState | null {
    return activeWorkerRuntime;
}

function resolveWorkerApiBaseUrl(env: CrossHostEnv): string | null {
    const advertise = env.workerApiAdvertiseHost;
    if (!advertise) return null;
    return `http://${advertise}:${env.workerApiPort}`;
}

function initWorkerHttp(): void {
    httpServer.init();
}

async function startWorkerHttp(env: CrossHostEnv): Promise<string | null> {
    await httpServer.start(env.workerApiPort, env.workerApiHost);
    httpServer.finalize();
    const base = resolveWorkerApiBaseUrl(env);
    if (!base) {
        log.warn(
            'CROSS_HOST_WORKER_API_ADVERTISE_HOST not set; worker API will not be registered for gateway routing',
        );
    } else {
        log.info('Worker HTTP API listening for gateway proxy', {
            bind: `${env.workerApiHost}:${env.workerApiPort}`,
            advertise: base,
        });
    }
    return base;
}

export interface WorkerRegistration {
    readonly response: Extract<RegisterResponseBody, { ok: true }>;
    readonly bootGeneration: string;
}

async function readCoreVersion(): Promise<string> {
    try {
        const raw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
        const pkg = JSON.parse(raw) as { version?: string };
        return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}

async function discoverLocalPlugins(): Promise<PluginIdVersion[]> {
    const pluginsDir = path.join(process.cwd(), 'plugins');
    const plugins: PluginIdVersion[] = [];
    try {
        const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const jsonPath = path.join(pluginsDir, entry.name, 'manifest.json');
            try {
                const raw = await fs.readFile(jsonPath, 'utf8');
                const data = JSON.parse(raw) as unknown;
                if (
                    typeof data === 'object' &&
                    data !== null &&
                    typeof (data as { id?: unknown }).id === 'string' &&
                    typeof (data as { version?: unknown }).version === 'string'
                ) {
                    plugins.push({
                        id: (data as { id: string }).id,
                        version: (data as { version: string }).version,
                    });
                }
            } catch {
                continue;
            }
        }
    } catch {
        log.warn('Worker could not read plugins directory; registering with empty plugin set');
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id));
    return plugins;
}

function joinUrl(base: string, pathPart: string): string {
    const b = base.replace(/\/+$/, '');
    const p = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    return `${b}${p}`;
}

export async function registerWithOrchestrator(env: CrossHostEnv): Promise<WorkerRegistration> {
    if (!env.machineId) {
        throw new Error('CROSS_HOST_MACHINE_ID is required for worker role');
    }
    if (!env.orchestratorUrl) {
        throw new Error('CROSS_HOST_ORCHESTRATOR_URL is required for worker role');
    }
    if (!env.clusterSecret) {
        throw new Error('CROSS_HOST_CLUSTER_SECRET is required for worker role');
    }

    const machineId = env.machineId;
    const bootGeneration = randomBytes(16).toString('hex');
    const zeneVersion = await readCoreVersion();
    const plugins = await discoverLocalPlugins();

    const challengeUrl = new URL(joinUrl(env.orchestratorUrl, '/cross-host/v1/challenge'));
    challengeUrl.searchParams.set('machineId', machineId);

    log.info('Requesting registration challenge', {
        machineId,
        orchestratorUrl: env.orchestratorUrl,
    });

    const challengeRes = await fetch(challengeUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
    });
    if (!challengeRes.ok) {
        const text = await challengeRes.text().catch(() => '');
        throw new Error(
            `Challenge request failed: HTTP ${challengeRes.status} ${text.slice(0, 200)}`,
        );
    }
    const challengeJson = (await challengeRes.json()) as ChallengeResponseBody;
    if (
        typeof challengeJson.challengeId !== 'string' ||
        typeof challengeJson.nonce !== 'string' ||
        typeof challengeJson.expiresAt !== 'number'
    ) {
        throw new Error('Challenge response missing required fields');
    }

    const manifestHash = buildManifestHash(zeneVersion, plugins);
    const hmac = computeRegisterHmac(env.clusterSecret, {
        nonce: challengeJson.nonce,
        machineId,
        manifestHash,
        zeneVersion,
        bootGeneration,
    });

    const body = {
        machineId,
        zeneVersion,
        plugins,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        bootGeneration,
        challengeId: challengeJson.challengeId,
        hmac,
    };

    const registerUrl = joinUrl(env.orchestratorUrl, '/cross-host/v1/register');
    log.info('Submitting registration', {
        machineId,
        zeneVersion,
        pluginCount: plugins.length,
        bootGeneration,
    });

    const registerRes = await fetch(registerUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });

    const registerJson = (await registerRes.json()) as RegisterResponseBody;
    if (!registerJson.ok) {
        log.error('Registration rejected', {
            machineId,
            reason: registerJson.reason,
            message: registerJson.message,
            status: registerRes.status,
        });
        throw new Error(
            `Registration rejected: ${registerJson.reason} — ${registerJson.message}`,
        );
    }

    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('crosshost.worker.registered', {
                machineId,
                assignedShards: registerJson.assignedShards,
                totalShards: registerJson.totalShards,
            }),
        )
        .catch(() => undefined);
    try {
        const { setClusterClientAuth } = await import('./clusterClient.js');
        if (env.orchestratorUrl && registerJson.machineToken) {
            setClusterClientAuth(registerJson.machineToken, env.orchestratorUrl);
        }
    } catch {
    }
    log.info('Registration accepted', {
        machineId,
        generation: registerJson.generation,
        assignedShards: registerJson.assignedShards,
        totalShards: registerJson.totalShards,
        snapshotVersion: registerJson.snapshotVersion,
        redisAlias: registerJson.redis.alias,
        tokenExpiresAt: registerJson.machineTokenExpiresAt,
        compatMode: registerJson.compatMode,
    });

    return { response: registerJson, bootGeneration };
}

async function pullSnapshot(
    env: CrossHostEnv,
    machineToken: string,
    version?: number,
): Promise<SnapshotEnvelope> {
    if (!env.orchestratorUrl) {
        throw new Error('CROSS_HOST_ORCHESTRATOR_URL missing');
    }
    const url = new URL(joinUrl(env.orchestratorUrl, '/cross-host/v1/snapshot'));
    if (version !== undefined) {
        url.searchParams.set('version', String(version));
    }
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${machineToken}`,
        },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Snapshot pull failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { ok?: boolean; envelope?: SnapshotEnvelope };
    if (!json.ok || !json.envelope) {
        throw new Error('Snapshot pull response missing envelope');
    }
    return json.envelope;
}

export async function runWorkerControlPlane(
    env: CrossHostEnv,
    registration: WorkerRegistration,
    redis: { main: Redis; pub: Redis; sub: Redis },
): Promise<void> {
    const reg = registration.response;
    const prefix = reg.redis.channelPrefix;
    const machineId = env.machineId;
    if (!machineId) {
        throw new Error('CROSS_HOST_MACHINE_ID missing');
    }
    const state: WorkerRuntimeState = createWorkerRuntimeState(
        machineId,
        reg.totalShards,
        reg.assignedShards,
        reg.generation,
    );
    activeWorkerRuntime = state;
    state.grantWaiter.configureRedis(redis.main, prefix, machineId);
    markCrossHostWorkerActive(machineId);
    setCrossHostWorkerShards(state.shards);

    let advertisedApiBase: string | null = null;

    const heartbeat = async (): Promise<void> => {
        const msg: HeartbeatMessage = {
            machineId: state.machineId,
            generation: state.generation,
            shards: state.shards,
            snapshotVersionAck: state.snapshotCache.getVersion(),
            at: Date.now(),
            apiBaseUrl: advertisedApiBase,
        };
        await redis.pub.publish(
            channelHeartbeat(prefix),
            encodeMessage(msg).toString('base64'),
        );
    };

    await heartbeat();
    const heartbeatTimer = setInterval(() => {
        void heartbeat().catch((err) => log.warn('Heartbeat publish failed', err));
    }, env.heartbeatMs);
    heartbeatTimer.unref();
    log.info('Worker early heartbeat started', {
        machineId,
        intervalMs: env.heartbeatMs,
        shards: state.shards,
    });
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('crosshost.heartbeat.started', {
                machineId,
                intervalMs: env.heartbeatMs,
            }),
        )
        .catch(() => undefined);

    const indexResolved = await resolveIndexBackend(env, redis.main, prefix);
    configureIndexWriter({
        backend: indexResolved.enabled ? indexResolved.backend : null,
        machineId,
        getShardId: () => (state.shards.length > 0 ? state.shards[0] : null),
    });
    if (!indexResolved.enabled) {
        log.info('Worker index publisher disabled', { reason: indexResolved.reason });
    }

    await startQueryRpcServer(redis.sub, redis.pub, prefix, machineId, async (op: QueryOp, payload: unknown) => {
        const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
        switch (op) {
            case 'audit.list':
                return auditList(body as never);
            case 'audit.get':
                return auditGetById(String(body.id ?? ''));
            case 'error.list':
                return errorList(body as never);
            case 'error.get':
                return errorGetById(String(body.id ?? ''));
            default:
                throw new Error(`Unknown query op: ${op}`);
        }
    });

    const requestGrants = async (shardIds: readonly number[]): Promise<void> => {
        for (const shardId of shardIds) {
            await state.grantWaiter.waitFor(shardId, 60_000);
        }
    };

    const statsCollector = new StatsCollector({
        machineId,
        pub: redis.pub,
        channelPrefix: prefix,
        intervalMs: env.statsIntervalMs,
        getShardCount: () => state.shards.length,
    });

    const handleUpdateInstruct = async (instruct: UpdateInstructMessage): Promise<void> => {
        if (instruct.machineId !== machineId) return;
        log.info('Update instruct received', {
            instructId: instruct.instructId,
            zeneVersion: instruct.desiredState.zeneVersion,
            pluginCount: instruct.desiredState.plugins.length,
        });
        await workerHooks.runBeforeUpdate({
            zeneVersion: instruct.desiredState.zeneVersion,
            plugins: instruct.desiredState.plugins,
        });
        let ok = false;
        let message: string;
        try {
            const { runWorkerUpdate } = await import('./updateClient.js');
            await runWorkerUpdate(instruct);
            ok = true;
            message = 'updater finished; exiting for restart';
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
            log.error('Worker update failed', err);
        }
        await workerHooks.runAfterUpdate({ ok, message });
        const ack: UpdateAckMessage = {
            machineId,
            instructId: instruct.instructId,
            ok,
            message,
            at: Date.now(),
        };
        await redis.pub.publish(
            channelUpdateAck(prefix),
            encodeMessage(ack).toString('base64'),
        );
        if (ok) {
            await flushLogs();
            process.exit(0);
        }
    };

    const onMessage = (channel: string, payload: string) => {
        try {
            const buf = Buffer.from(payload, 'base64');
            const raw = decodeMessage(buf);
            if (channel === channelSnapshotNotify(prefix)) {
                const parsed = snapshotNotifySchema.safeParse(raw);
                if (!parsed.success) return;
                void handleSnapshotNotify(env, reg.machineToken, state, parsed.data as SnapshotNotifyMessage);
                return;
            }
            if (channel === channelAssignmentUpdate(prefix)) {
                const parsed = assignmentUpdateSchema.safeParse(raw);
                if (!parsed.success) return;
                const update = parsed.data as AssignmentUpdateMessage;
                if (update.machineId !== machineId) {
                    log.debug('Ignoring assignment for other machine', {
                        for: update.machineId,
                        self: machineId,
                        generation: update.generation,
                    });
                    return;
                }
                void applyAssignment(state, update, requestGrants).then(async () => {
                    setCrossHostWorkerShards(state.shards);
                    statsCollector.bindClient(state.client);
                    if (state.pluginsBooted && !advertisedApiBase) {
                        try {
                            advertisedApiBase = await startWorkerHttp(env);
                        } catch (err) {
                            log.error('Worker HTTP API failed to start after assignment', err);
                        }
                    }
                });
                return;
            }
            if (channel === channelIdentifyGrant(prefix)) {
                const parsed = identifyGrantSchema.safeParse(raw);
                if (!parsed.success) return;
                const grant = parsed.data as IdentifyGrantMessage;
                if (grant.machineId !== machineId) {
                    log.debug('Ignoring identify grant for other machine', {
                        for: grant.machineId,
                        self: machineId,
                        shardId: grant.shardId,
                    });
                    return;
                }
                onIdentifyGrant(state, grant);
                return;
            }
            if (channel === channelUpdateInstruct(prefix)) {
                const parsed = updateInstructSchema.safeParse(raw);
                if (!parsed.success) return;
                void handleUpdateInstruct(parsed.data as UpdateInstructMessage);
            }
        } catch (err) {
            log.error('Control-plane message handling error', err);
        }
    };

    redis.sub.on('message', onMessage);
    await redis.sub.subscribe(
        channelSnapshotNotify(prefix),
        channelAssignmentUpdate(prefix),
        channelIdentifyGrant(prefix),
        channelUpdateInstruct(prefix),
    );
    log.info('Worker subscribed to control-plane channels');

    const envelope = await pullSnapshot(env, reg.machineToken, reg.snapshotVersion);
    state.snapshotCache.applyFull(envelope);
    await ensurePluginsPreloaded(state);

    initWorkerHttp();
    await startClientIfNeeded(state, requestGrants);

    try {
        if (state.pluginsBooted) {
            advertisedApiBase = await startWorkerHttp(env);
        }
    } catch (err) {
        log.error('Worker HTTP API failed to start', err);
    }

    statsCollector.bindClient(state.client);
    statsCollector.start();

    const bus = await startWorkerPluginBus({
        machineId,
        prefix,
        pub: redis.pub,
        sub: redis.sub,
        main: redis.main,
    });
    setCrossHostBus(bus);
    registerGaugeHandlers(
        (name, value) => statsCollector.setGauge(name, value),
        (name, by) => statsCollector.incGauge(name, by),
    );
    registerFleetShutdownPublisher(async (reason) => {
        await publishControlShutdown(redis.pub, prefix, {
            scope: 'fleet',
            reason,
            fromMachineId: machineId,
        });
    });
    registerMachineShutdownPublisher(async (targetId, reason) => {
        await bus.shutdownWorker(targetId, reason);
    });

    log.info('Worker control plane active', {
        machineId: state.machineId,
        shards: state.shards,
        totalShards: state.totalShards,
        snapshotVersion: state.snapshotCache.getVersion(),
    });
}

async function handleSnapshotNotify(
    env: CrossHostEnv,
    machineToken: string,
    state: WorkerRuntimeState,
    notify: SnapshotNotifyMessage,
): Promise<void> {
    if (notify.version <= state.snapshotCache.getVersion()) {
        return;
    }
    if (notify.mode === 'diff' && notify.baseVersion !== undefined && Array.isArray(notify.patch)) {
        const ok = state.snapshotCache.applyDiff(
            notify.baseVersion,
            notify.version,
            notify.hash,
            notify.patch as Operation[],
        );
        if (ok) return;
        log.info('Diff failed; pulling full snapshot', { version: notify.version });
    }
    const envelope = await pullSnapshot(env, machineToken, notify.version);
    state.snapshotCache.applyFull(envelope);
}
