# Zene Architecture Decisions

## ADR-0001 — Phase 0 baseline and source authority
- **Date:** 2026-09-29
- **Context:** Zene Dashboard work spans an existing backend, approved platform specifications, and UI research.
- **Decision:** Repository implementation is authoritative for current-state claims; approved specifications are authoritative for intended architecture; UI research is authoritative for design direction. Never silently substitute one for another.
- **Alternatives:** Treat the specification as current implementation; design a separate generic dashboard backend.
- **Reason:** Prevents architectural hallucination and preserves existing Zene ownership boundaries.
- **Affected systems:** all Dashboard/core/plugin/Cross-Host work.
- **Migration impact:** none.
- **Compatibility impact:** preserves current Zene architecture.
- **Security impact:** prevents bypassing existing authorization and identity systems.

## ADR-0002 — Dashboard remains a Zene-integrated web boundary
- **Date:** 2026-09-29
- **Context:** Existing dashboard routes are a Zene plugin; specifications require the browser to communicate only with Dashboard API.
- **Decision:** Extend `src/plugins/dashboard` and existing Zene HTTP/gateway facilities rather than create a parallel dashboard backend.
- **Alternatives:** standalone dashboard backend with duplicate auth/database/permissions.
- **Reason:** Existing Zene systems already own identity, permissions, plugin lifecycle, database and Cross-Host state.
- **Affected systems:** dashboard, API gateway, token, permissions, dash-data, Cross-Host.
- **Migration impact:** future routes/services must converge on shared contracts.
- **Compatibility impact:** existing dashboard API remains the foundation.
- **Security impact:** one authoritative server-side boundary.

## ADR-0003 — Phase 1 must precede broad UI implementation
- **Date:** 2026-09-29
- **Context:** Current registry, SSE, identity, and routing semantics are weaker than the final specification.
- **Decision:** First implementation phase should establish SDK V2, capability/resource authorization, routing context, typed events, API contracts, and identity extension boundaries before building the broad browser application.
- **Alternatives:** build frontend shell first and retrofit security/platform contracts.
- **Reason:** prevents current limitations from becoming browser-side assumptions.
- **Affected systems:** core types, permissions, dashboard, Cross-Host, events, API/OpenAPI.
- **Migration impact:** establishes contracts that later migrations target.
- **Compatibility impact:** existing bits/token/event/database systems are extended, not replaced.
- **Security impact:** high positive impact; avoids registry/realtime/IDOR design debt.

## ADR-0004 — Existing Cross-Host control plane remains authoritative
- **Date:** 2026-09-29
- **Context:** Orchestrator, worker membership, shard map, Redis control, machine auth and gateway routing already exist.
- **Decision:** Dashboard routing must extend current Cross-Host mechanisms. The orchestrator remains a control plane; browser credentials never become machine credentials.
- **Alternatives:** introduce a separate dashboard cluster/router.
- **Reason:** avoids duplicate shard affinity and incompatible worker control.
- **Affected systems:** `src/core/crosshost/*`, dashboard fleet/routing.
- **Migration impact:** dashboard-specific routing abstractions will wrap current shard/worker resolution.
- **Compatibility impact:** preserves worker/orchestrator protocol.
- **Security impact:** keeps machine tokens internal.

## ADR-0005 — dash-data remains dashboard persistence abstraction
- **Date:** 2026-09-29
- **Context:** Existing dashboard persistence is already routed through dash-data and existing database adapters.
- **Decision:** Extend dash-data with domain-level services/migrations; do not introduce a second dashboard database.
- **Alternatives:** dedicated dashboard DB/service.
- **Reason:** preserves adapter compatibility and Cross-Host storage safety.
- **Affected systems:** dash-data, database adapters, migrations.
- **Migration impact:** future persistent structures require versioned migrations.
- **Compatibility impact:** existing records remain authoritative during migration.
- **Security impact:** centralized persistence ownership reduces accidental data-access divergence.
