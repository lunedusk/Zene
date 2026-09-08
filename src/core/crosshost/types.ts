export type CrossHostRole = 'orchestrator' | 'worker';

export type CompatMode = 'strict' | 'range';

export type RegisterReasonCode =
    | 'OK'
    | 'HMAC_INVALID'
    | 'VERSION_MISMATCH_STRICT'
    | 'VERSION_OUT_OF_RANGE'
    | 'PLUGIN_SET_MISMATCH'
    | 'DUPLICATE_MACHINE_ID'
    | 'CLAIM_CONFLICT'
    | 'INVALID_PAYLOAD'
    | 'CHALLENGE_EXPIRED'
    | 'CHALLENGE_MISSING'
    | 'MACHINE_ID_REQUIRED'
    | 'UNAUTHORIZED'
    | 'INTERNAL';

export type AssignmentReason =
    | 'join'
    | 'leave'
    | 'rebalance'
    | 'drain'
    | 'reshard'
    | 'manual'
    | 'recovery';

export interface PluginIdVersion {
    readonly id: string;
    readonly version: string;
}

export interface DesiredState {
    readonly zeneVersion: string;
    readonly plugins: readonly PluginIdVersion[];
}

export interface RegisterRequestBody {
    readonly machineId: string;
    readonly zeneVersion: string;
    readonly plugins: readonly PluginIdVersion[];
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
    readonly bootGeneration: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly challengeId: string;
    readonly hmac: string;
}

export interface RedisMaterial {
    readonly alias: string;
    readonly channelPrefix: string;
}

export interface RegisterSuccessBody {
    readonly ok: true;
    readonly generation: number;
    readonly assignedShards: readonly number[];
    readonly totalShards: number;
    readonly redis: RedisMaterial;
    readonly machineToken: string;
    readonly machineTokenExpiresAt: number;
    readonly snapshotVersion: number;
    readonly desiredState: DesiredState;
    readonly compatMode: CompatMode;
}

export interface RegisterFailureBody {
    readonly ok: false;
    readonly reason: RegisterReasonCode;
    readonly message: string;
}

export type RegisterResponseBody = RegisterSuccessBody | RegisterFailureBody;

export interface ChallengeResponseBody {
    readonly challengeId: string;
    readonly nonce: string;
    readonly expiresAt: number;
}

export interface WorkerView {
    readonly machineId: string;
    readonly zeneVersion: string;
    readonly plugins: readonly PluginIdVersion[];
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
    readonly bootGeneration: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly registeredAt: number;
    readonly lastSeenAt: number;
    readonly shards: readonly number[];
    readonly snapshotVersionAck: number;
    readonly apiBaseUrl: string | null;
}

export interface CrossHostEnv {
    readonly enabled: boolean;
    readonly role: CrossHostRole | null;
    readonly machineId: string | null;
    readonly orchestratorUrl: string | null;
    readonly clusterSecret: string;
    readonly httpHost: string;
    readonly httpPort: number;
    readonly compatMode: CompatMode;
    readonly tokenTtlSec: number;
    readonly mtlsEnabled: boolean;
    readonly mtlsCertPath: string | null;
    readonly mtlsKeyPath: string | null;
    readonly mtlsCaPath: string | null;
    readonly heartbeatMs: number;
    readonly suspectAfter: number;
    readonly deadGraceMs: number;
    readonly totalShardsOverride: number | null;
    readonly statsIntervalMs: number;
    readonly rebalanceCooldownMs: number;
    readonly loadImbalanceThreshold: number;
    readonly rebalanceMaxMoves: number;
    readonly rebalanceMinImprovement: number;
    readonly assignmentStrategy: StrategyId;
    readonly regionLabelKey: string;
    readonly maxConcurrentUpdates: number;
    readonly loadWeights: LoadWeights;
    readonly manualShards: Readonly<Record<string, readonly number[]>>;
    readonly indexEnabled: boolean;
    readonly indexBackend: 'redis';
    readonly indexRetentionDays: number;
    readonly apiGatewayEnabled: boolean;
    readonly apiProxyTimeoutMs: number;
    readonly workerApiHost: string;
    readonly workerApiPort: number;
    readonly workerApiAdvertiseHost: string | null;
    readonly queryTimeoutMs: number;
    readonly queryConcurrency: number;
}

export interface ResolvedRedis {
    readonly alias: string;
    readonly uri: string;
}

export interface SnapshotDocument {
    readonly config: Record<string, unknown>;
    readonly lang: Array<{ locale: string; namespace: string; raw: unknown }>;
    readonly emoji: Record<string, string>;
}

export interface SnapshotEnvelope {
    readonly version: number;
    readonly hash: string;
    readonly document: SnapshotDocument;
}

export interface SnapshotNotifyMessage {
    readonly version: number;
    readonly hash: string;
    readonly mode: 'full' | 'diff';
    readonly baseVersion?: number;
    readonly patch?: unknown;
}

export interface AssignmentUpdateMessage {
    readonly generation: number;
    readonly machineId: string;
    readonly shards: readonly number[];
    readonly totalShards: number;
    readonly reason: AssignmentReason;
}

export interface IdentifyGrantMessage {
    readonly machineId: string;
    readonly shardId: number;
    readonly grantId: string;
    readonly expiresAt: number;
    readonly allowResume: boolean;
}

export interface HeartbeatMessage {
    readonly machineId: string;
    readonly generation: number;
    readonly shards: readonly number[];
    readonly snapshotVersionAck: number;
    readonly at: number;
    readonly apiBaseUrl?: string | null;
}

export interface GatewayBotInfo {
    readonly url: string;
    readonly shards: number;
    readonly maxConcurrency: number;
    readonly sessionStartLimit: {
        readonly total: number;
        readonly remaining: number;
        readonly resetAfter: number;
        readonly maxConcurrency: number;
    };
}

export type StrategyId = 'least_loaded' | 'sticky' | 'manual' | 'region_aware';

export interface WorkerStats {
    readonly machineId: string;
    readonly guildCount: number;
    readonly memberCount: number | null;
    readonly eventRate: number;
    readonly commandRate: number;
    readonly shardCount: number;
    readonly customGauges: Readonly<Record<string, number>>;
    readonly at: number;
}

export interface LoadWeights {
    readonly guild: number;
    readonly member: number;
    readonly event: number;
    readonly command: number;
    readonly shard: number;
}

export interface AssignmentDiff {
    readonly assignments: ReadonlyMap<string, readonly number[]>;
    readonly moves: readonly {
        readonly shardId: number;
        readonly from: string | null;
        readonly to: string;
    }[];
    readonly reason: string;
}

export interface UpdateInstructMessage {
    readonly machineId: string;
    readonly generation: number;
    readonly desiredState: DesiredState;
    readonly instructId: string;
}

export interface UpdateAckMessage {
    readonly machineId: string;
    readonly instructId: string;
    readonly ok: boolean;
    readonly message: string;
    readonly at: number;
}

export type IndexKind = 'audit' | 'error';

export interface IndexRecordMeta {
    readonly kind: IndexKind;
    readonly id: string;
    readonly machineId: string;
    readonly shardId: number | null;
    readonly ts: number;
    readonly summary: string;
    readonly surface?: string;
    readonly severity?: string;
    readonly action?: string;
}

export type QueryOp = 'audit.list' | 'audit.get' | 'error.list' | 'error.get';

export interface QueryRequestMessage {
    readonly requestId: string;
    readonly targetMachineId: string;
    readonly op: QueryOp;
    readonly payload: unknown;
}

export interface QueryResponseMessage {
    readonly requestId: string;
    readonly machineId: string;
    readonly ok: boolean;
    readonly partial?: boolean;
    readonly data?: unknown;
    readonly error?: string;
}
