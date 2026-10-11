# Security model and operator checklist

## 1. Threat model

Zene runs code supplied by the operator and potentially by third-party plugin authors. The security posture depends on which artifacts are installed, their signer trust, the runtime backend, which Core services are exposed, the permissions used by database credentials, and which HTTP/Discord entrypoints are reachable.

No single mechanism protects every layer. Signed artifacts authenticate content under a key; runtime boundaries limit process/resources; SDK bridge authorization constrains available operations; permission checks enforce application actions; data registry policy restricts typed plugin data; logs/audit support investigation. Configuration and operator access remain security-critical.

## 2. High-impact controls

### Plugin trust

Leave `allowUnCertifiedPlugins=false` unless bypass is deliberate and constrained. Validate signing-key selection and plugin package closure. Do not accept a raw JSON fallback after a signed artifact failed verification. Restrict write access to `plugins/` and updater credentials.

### Runtime choice

`in-process` offers no memory, execution or failure isolation. `worker` and `process` create execution/memory boundaries but do not inherently isolate filesystem or network. Container/external backends depend on their environment. Select a level based on required security properties, not just throughput.

### Secrets

The current `SecretManager` reads and writes values to `process.env`. `assimilateEnv()` counts existing non-empty keys and does not remove them from the process environment. Locking prevents overwriting keys already sealed through the SecretManager, but it is not environment-variable encryption. In-process plugin code with process access may read values such as `DiscordToken`. Treat third-party plugins as trusted code with respect to the parent process environment when run in-process.

### Web endpoints

Core HTTP routes and plugin routes are not automatically authenticated just because they're mounted through `heart.net.http` or `BaseRoute`. Authenticate every privileged operation, validate input, enforce request-size/time bounds, minimize CORS/origin trust and ensure deployment firewalls/reverse proxies match the route's intended exposure.

### Database access

Use least-privilege database users, TLS where supported, network ACLs, backups, and data retention. Direct driver access can bypass Core data ownership/privacy policy. Never put URI credentials in logs. In Cross-Host, ensure shared state uses the required remote backends and compatible database aliases.

## 3. SDK bridge

The public SDK bridge is built and injected by Core. It binds plugin identity to runtime ID and generation. Unauthorized sessions throw `SdkError` with `SDK_OPERATION_DENIED`; stale generations throw `SDK_STALE_GENERATION`. Do not expose bridge construction/install functions to untrusted code or introduce a global mutable capability registry into the published package.

A bridge is still only as secure as the host implementation and its operations. Each method must validate the caller identity, runtime generation, input shape and ownership. Avoid turning a low-level bridge helper into arbitrary filesystem, SQL or shell execution.

## 4. Data privacy

The Core data registry validates data type IDs, subject fields for scope, owner-based write/delete rules, public-only cross-plugin reads and export rules. The privacy catalogue persists ownership/scope/personal-data metadata so Core can carry out account/guild deletion even after plugin unload. Global user deletion covers personal-data types; server deletion covers guild/server-scoped types. Plugin-owned whole-type wipe is a separate owner-authorized Core operation, not the same as public subject delete.

Choose `privacyClass` accurately. `secret` data is not exportable through the general registry. A personal-data flag and privacy class are metadata used for enforcement and privacy actions; developers remain responsible for avoiding unnecessary collection and defining retention/review policies.

## 5. Audit and errors

Audit metadata is allowlisted and length-bounded. Use it for security-relevant actions and avoid passing raw arbitrary metadata. Error occurrences sanitize context, cap strings and coalesce by code/window. Neither store should be used to persist secrets, raw HTTP bodies, auth headers or unbounded traces.

See [Audit](AUDIT.md) and [Errors](ERRORS.md).

## 6. Cross-Host

Cross-Host uses an HMAC challenge/registration path, cluster secret, machine token, Redis coordination and optional mutual TLS. A remote worker must be authenticated before it receives shard assignment/control data. Configure `CROSS_HOST_CLUSTER_SECRET` as high-entropy shared secret material. When mTLS is enabled, provide valid CA/cert/key paths and validate certificate lifecycle/permissions. Do not expose the orchestrator's control HTTP surface to an untrusted network.

Use unique/stable machine IDs, compatible Core/plugin versions and the correct Redis database alias. Test stale workers, heartbeats, reassignment, shutdown and Redis interruption.

## 7. Updater

Updater operations can overwrite code and install or remove plugins. Use safe-update checks and backups; inspect dry-run plans and file/plugin decisions before forced operations. Treat `UpdaterPostUpdateCmd`, PATs and plugin-signing keys as sensitive/high authority. Protect local update state and backup directories from untrusted write access.

## 8. Logging and observability

Do not log full connection URIs, passwords, tokens, authorization headers, cookies, private keys or arbitrary plugin payloads. Redaction helpers are defense-in-depth and can miss data embedded in a free-form string. Prefer structured metadata with an allowlist. Track a request/tracking identifier without including credentials in it.

## 9. Security review checklist for changes

- Which trust boundary does the change cross?
- Is the caller identity derived by Core, rather than accepted from arbitrary plugin input?
- Are runtime ID and generation checked for stale SDK operations?
- Does every HTTP/Discord side effect have authorization and validation?
- Does data access preserve type owner, subject and privacy semantics?
- Are inputs bounded and parsed with a schema?
- Can errors expose tokens, URIs or personal data?
- Does teardown remove listeners, timers, routes and provider bindings?
- Does failure remain fail-closed, or does it trigger a hidden fallback?
- Are integration tests isolated from developer/production records?
