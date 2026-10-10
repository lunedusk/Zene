# Cross-Host

Cross-Host enables multi-process and multi-machine operation for Zene. Standalone single-process deployments do not require it.

## Roles

Typical roles include standalone operation, classic sharding, orchestrator, and worker processes. Exact role selection follows Core configuration and environment flags such as `CROSS_HOST`.

## Trust and boot

Workers authenticate to the control plane using configured machine credentials and challenge/HMAC (or related) mechanisms implemented under `src/core/crosshost`. Boot should fail closed when shared security requirements are not met.

## Communication

Plugin bus messaging is constrained by Core policy (including same-plugin namespace rules where enforced). Use the public SDK CrossHost surface when available; do not expose shutdown of workers through third-party SDK APIs.

## Storage

Shared Cross-Host state requires **remote** shared databases. Embedded local Surreal/SQLite paths are not valid as the multi-worker source of truth. Align documentation, `Database` aliases, and runtime `surrealDB.get('main')` (or the documented shared alias) so every worker reaches the same remote instance.

## Operations

- Prefer health and membership signals from Core before routing work
- Expect partial results when querying distributed audit/error indexes
- Shut down cleanly so runtime generations and SDK bridges release resources

Implementation detail lives under `src/core/crosshost` and related heart helpers.
