# Cross-Host distributed deployment reference

## 1. Purpose and topology

Cross-Host is Zene's optional multi-machine control plane for coordinating Discord shard ownership and plugin execution across processes/machines. A normal standalone bot does not need it. The implementation is in `src/core/crosshost/` and is connected to Core through mode selection, Redis coordination, runtime flags, `heart.control`, and the plugin Cross-Host bus.

At a high level:

- **Orchestrator:** owns cluster membership, registration challenge/authentication, desired Core/plugin state, total shard count, assignment strategy, worker health tracking, rebalance decisions, snapshot publication, identify queue, update control and distributed query/index coordination.
- **Worker:** registers with the orchestrator, consumes assignment/snapshot/control information, reports heartbeats/stats and runs Discord clients/plugins for assigned shards. A worker with zero shards can remain in standby without logging into Discord.
- **Redis:** carries control-plane pub/sub and shared coordination state. `resolveCrossHostRedis()` prefers `Database.crosshost`, then accepts `Database.main` only when that entry is Redis. It does not choose an arbitrary Redis alias.
- **Remote shared storage:** durable data required by multiple hosts must use suitable remote backends. Local-file SQLite/embedded SurrealDB are rejected/skipped for Cross-Host storage purposes.

Cross-Host is not simply “set a flag to distribute work.” It changes the boot branch and assumes network reachability, consistent deployment metadata, shared service credentials and safe shard reassignment.

## 2. Boot and role selection

`detectDeployMode()` returns `crosshost` when `CROSS_HOST` is true, `sharded` when `isSharded` is true, otherwise `standalone`. `loadCrossHostEnv()` reads the `CROSS_HOST_*` settings and parses/validates ports, positive integers, non-negative weights and the manual shard map.

`CROSS_HOST_ROLE` is recognized as `orchestrator` or `worker`. Anything else becomes an unknown/null role in role-detection helpers. The orchestrator boot path fails if `CROSS_HOST_CLUSTER_SECRET` is empty. Workers need a reachable `CROSS_HOST_ORCHESTRATOR_URL` and compatible control-plane configuration.

The `CROSS_HOST` feature is enabled independently of whether a role was recognized; operators must configure both rather than assume the flag infers a role.

## 3. Shared storage gate

Cross-Host depends on shared state for membership, assignment and control coordination. The storage gate reads the configured database map and disallows local-only engine choices for cross-hosted shared data. `DatabaseManager` separately rejects embedded SurrealDB protocols and SQLite in Cross-Host.

For Cross-Host Redis resolution:

1. Parse `Database` as a JSON object.
2. Prefer alias `crosshost` when it has `redis://`/`rediss://` or `engine: redis` and a usable URI.
3. Otherwise accept alias `main` if it is Redis.
4. Otherwise fail with an error describing the accepted aliases.

All orchestrator/worker processes that are supposed to coordinate must reach the same intended Redis instance and use compatible channel prefixes. Different aliases may point to the same endpoint, but alias equality alone doesn't prove endpoint equality.

## 4. Registration and authentication

The Cross-Host type model includes registration requests with machine ID, Zene version, plugin ID/version set, Node version, platform/architecture, boot generation, optional labels, challenge ID and HMAC. A challenge response carries challenge ID, nonce and expiry. Successful registration returns a generation, assigned shards/total shards, Redis material, machine token/expiry, snapshot version, desired state and compatibility mode. Failure responses carry a reason code/message.

Relevant rejection reasons include invalid HMAC, strict version mismatch, out-of-range version, plugin-set mismatch, duplicate machine ID, claim conflict, invalid payload, expired/missing challenge, missing machine ID and unauthorized/internal failures. Log stable reason codes and sanitized identifiers rather than secrets or HMAC input.

Do not make an external API that bypasses the registration challenge/token process. Registration payloads are runtime data and must be validated with protocol schemas even if the TypeScript types compile.

## 5. Desired state, snapshots and worker health

Desired state describes the Zene version and plugin ID/version collection the cluster expects. Snapshot documents carry config, language namespaces and emoji maps. Snapshot envelopes include version/hash/document. Workers acknowledge snapshot version through heartbeats and can apply full or diff notifications; a snapshot version mismatch can affect configuration consistency across hosts.

Workers publish heartbeats with machine ID, generation, assigned shards, snapshot acknowledgement and time, plus optional API base URL. Stats include machine ID, guild/member counts, event/command rate, shard count, custom gauges and timestamp.

The current environment parser defaults heartbeat interval to 5,000 ms, suspect threshold to 3 heartbeat intervals and dead grace to 15,000 ms. When a worker exceeds the suspect threshold, the orchestrator logs a warning. Past the dead window it can clear the worker's shard ownership, remove membership and rebalance.

Do not interpret a heartbeat as proof of all plugin handlers being healthy. Use independent service health and plugin runtime status where required.

## 6. Shard assignment and rebalance

Strategies are `least_loaded`, `sticky`, `manual`, and `region_aware`. The env parser falls back to `least_loaded` for an unrecognized strategy. Load weights combine guild, member, event, command and shard contributions. Additional knobs include minimum improvement, imbalance threshold, max moves and cooldown.

`RebalanceEngine` first attempts to fill unowned shards, then calculates worker load scores and imbalance, then asks the selected strategy for an assignment diff. It respects workers marked as updating. Assignments are written via `ShardMap`, membership shard views and the generation are advanced. The reason union includes `join`, `leave`, `rebalance`, `drain`, `reshard`, `manual` and `recovery`.

Manual assignment uses JSON object syntax `machineId -> number[]`, and each shard ID must be a non-negative integer. Validate uniqueness and desired ownership before changing manual maps; duplicate assignment or out-of-range shard handling should be tested with the current schema and assignment layer.

## 7. Discord identify grants

The orchestrator uses gateway shard/concurrency information and an identify queue. The protocol defines identify grants with machine ID, shard ID, grant ID, expiry and `allowResume`. Workers should wait for grants before opening sessions for assigned shards. An identify grant is a control-plane permission for a particular shard/attempt; do not cache it as a permanent authorization.

Workers apply assignment generations monotonically: stale assignment generations are ignored, and an identical shard set for the same generation is a no-op. Assignment hooks run before and after the worker updates the client/shards.

## 8. Cross-Host plugin messaging

The Core `heart.crossHost` domain exposes:

```ts
isAvailable(): boolean
machineId(): string | null
peers(): readonly string[]
send(target: string, channel: string, payload: unknown): Promise<void>
request<T>(target: string, channel: string, payload: unknown, timeoutMs?: number): Promise<T>
on(channel: string, handler: PluginBusHandler): void
off(channel: string, handler: PluginBusHandler): void
shutdownWorker(machineId: string, reason?: string): Promise<void>
```

The no-op/unavailable bus reports unavailable, returns null/empty peer information and throws on send/request/shutdown; its listener registration logs and does not create a working distributed subscription. Core bridge handlers are installed when the control plane/runtime is ready.

The public SDK surface differs: it includes `isAvailable`, `machineId`, `peers`, `send({target, channel, payload, trackingId?})`, `request({target, channel, payload, timeoutMs?, trackingId?})`, `on(channel, handler)` and `off(channel, handler?)`. An SDK handler receives `payload` and metadata (`fromMachineId`, channel, optional request/tracking/message IDs). SDK send/request/on can throw `CROSSHOST_UNAVAILABLE`; transport errors are wrapped as `CROSSHOST_TRANSPORT`.

Treat all payload data as untrusted. Define message version/schema, cap payload size, authenticate/authorize operations, and handle duplicate deliveries/timeouts. Correlation/tracking IDs are for diagnosis and must not include credentials.

## 9. Distributed query and optional index

Cross-Host defines index records for audit/error summaries and query operations such as `audit.list`, `audit.get`, `error.list`, and `error.get`. The index record stores summary metadata (kind, ID, machine/shard, time, bounded summary and optional surface/severity/action). It is a secondary index, not the canonical full data record. Query RPC requests include request ID, target machine, operation and payload; responses include machine ID, success, optional partial flag, data/error.

Optional index settings include `CROSS_HOST_INDEX_ENABLED` and `CROSS_HOST_INDEX_RETENTION_DAYS`. The backend type declared by current env shape is Redis. Disabled index is a supported state and does not mean audit/error storage is disabled.

## 10. Rolling updates and shutdown

The Cross-Host subsystem contains an update controller and message shapes for update instructions/acks (machine ID, generation, desired state, instruction ID, status/message/time). It also has fleet and machine shutdown publishers wired into `heart.control`. `heart.control.shutdownFleet`, `shutdownMachine` and `shutdownShard` rely on these registrations/resolvers; without the relevant control-plane publisher, remote operations throw instead of pretending success.

A fleet shutdown request can publish a control message then initiate local shutdown. A machine request targets one worker. A shard request resolves current shard owner. In standalone mode, these methods are not a general remote management API.

## 11. Environment reference

| Key | Current default/parser behavior | Meaning |
|---|---|---|
| `CROSS_HOST` | false | Enable Cross-Host mode. |
| `CROSS_HOST_ROLE` | no default | `orchestrator` or `worker`. |
| `CROSS_HOST_CLUSTER_SECRET` | required by orchestrator | Shared cluster auth material. |
| `CROSS_HOST_MACHINE_ID` | null | Stable machine identity. |
| `CROSS_HOST_ORCHESTRATOR_URL` | null | Worker registration target. |
| `CROSS_HOST_HTTP_HOST` | `0.0.0.0` | Orchestrator bind host. |
| `CROSS_HOST_HTTP_PORT` | `8020` | Port; integer range 1–65535. |
| `CROSS_HOST_COMPAT_MODE` | strict | `range` or strict fallback. |
| `CROSS_HOST_TOKEN_TTL_SEC` | 3600 | Positive machine token TTL seconds. |
| `CROSS_HOST_MTLS_ENABLED` | false | Use mTLS setup. |
| `CROSS_HOST_MTLS_CA_PATH` | null | CA path. |
| `CROSS_HOST_MTLS_CERT_PATH` | null | Certificate path. |
| `CROSS_HOST_MTLS_KEY_PATH` | null | Private-key path. |
| `CROSS_HOST_HEARTBEAT_MS` | 5000 | Positive heartbeat interval. |
| `CROSS_HOST_SUSPECT_AFTER` | 3 | Positive heartbeat multiplier. |
| `CROSS_HOST_DEAD_GRACE_MS` | 15000 | Positive dead-member grace. |
| `CROSS_HOST_TOTAL_SHARDS` | unset | Optional positive total-shard override. |
| `CROSS_HOST_MANUAL_SHARDS` | empty object | JSON mapping machine ID to non-negative shard ID arrays. |
| `CROSS_HOST_ASSIGNMENT_STRATEGY` | least_loaded | least_loaded/sticky/manual/region_aware. |
| `CROSS_HOST_LOAD_WEIGHT_GUILD` | 1 | Non-negative load weight. |
| `CROSS_HOST_LOAD_WEIGHT_MEMBER` | 0.001 | Non-negative load weight. |
| `CROSS_HOST_LOAD_WEIGHT_EVENT` | 10 | Non-negative load weight. |
| `CROSS_HOST_LOAD_WEIGHT_COMMAND` | 20 | Non-negative load weight. |
| `CROSS_HOST_LOAD_WEIGHT_SHARD` | 0.5 | Non-negative load weight. |
| `CROSS_HOST_STATS_INTERVAL_MS` | 900000 | Positive stats interval. |
| `CROSS_HOST_REBALANCE_COOLDOWN_MS` | 60000 | Positive rebalance cooldown. |
| `CROSS_HOST_LOAD_IMBALANCE_THRESHOLD` | 0.25 | Non-negative imbalance threshold. |
| `CROSS_HOST_REBALANCE_MAX_MOVES` | 32 | Positive move bound. |
| `CROSS_HOST_REBALANCE_MIN_IMPROVEMENT` | 0.05 | Non-negative threshold. |
| `CROSS_HOST_MAX_CONCURRENT_UPDATES` | 1 | Positive update concurrency. |
| `CROSS_HOST_REGION_LABEL_KEY` | region | Worker label key. |
| `CROSS_HOST_INDEX_ENABLED` | false | Enable secondary index. |
| `CROSS_HOST_INDEX_RETENTION_DAYS` | 14 | Positive index retention. |
| `CROSS_HOST_API_GATEWAY_ENABLED` | true | Enable API gateway. |
| `CROSS_HOST_API_PROXY_TIMEOUT_MS` | 30000 | Positive API proxy timeout. |
| `CROSS_HOST_WORKER_API_HOST` | 0.0.0.0 | Worker API bind host. |
| `CROSS_HOST_WORKER_API_PORT` | `CROSS_HOST_WORKER_API_PORT`, then APIPort, then 3000 | Positive worker port. |
| `CROSS_HOST_WORKER_API_ADVERTISE_HOST` | null | Optional advertised host. |
| `CROSS_HOST_QUERY_TIMEOUT_MS` | 5000 | Positive distributed query timeout. |
| `CROSS_HOST_QUERY_CONCURRENCY` | 16 | Positive concurrency bound. |

See [Environment reference](ENV%20Reference.md) for full configuration context.

## 12. Deployment sequence

1. Decide whether the deployment actually needs multiple machines/shards.
2. Configure compatible Core versions/plugin versions and signer trust across hosts.
3. Provision remote Redis and shared durable data backends; avoid embedded/local-only engines.
4. Set identical high-entropy cluster secret material and network/TLS policy.
5. Set orchestrator role, total shard behavior, and worker role/machine IDs/URL.
6. Start the orchestrator and verify Redis connection, claim acquisition, gateway shard count, and control HTTP readiness.
7. Start workers; verify authenticated registration, compatibility and received snapshots.
8. Verify heartbeat/assignment generations and identify grants before judging Discord login.
9. Test worker death, reassignment, shutdown, stale generations and Redis interruption in staging.
10. Confirm API and dashboard exposure/authorization for every reachable worker endpoint.

## 13. Operational failure modes

- **Missing shared Redis:** the subsystem fails rather than choosing any arbitrary Redis alias.
- **Invalid role:** `CROSS_HOST=true` with no valid role can lead to wrong branch/requirements behavior; configure it explicitly.
- **Duplicate machine ID:** registration can be rejected; ensure stable unique IDs.
- **Version/plugin set mismatch:** align releases or intentionally select a supported compatibility mode.
- **No shards assigned:** worker may be in standby and skip Discord login.
- **Heartbeat loss:** worker can be marked suspect/dead and shards reassigned after configured thresholds.
- **Local database in multi-host:** local state diverges; fix the backend architecture rather than trying to synchronize a file.
- **Unavailable plugin bus:** send/request/on are not silently successful; check role and boot timing.
