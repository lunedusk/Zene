# Zene Dashboard — Phase 0 Architecture Baseline

**Phase:** 0 — Repository Archaeology and Architecture Baseline  
**Date:** 2026-09-29  
**Repository:** `lunedusk/Zene`  
**Inspected ref:** `main` at `42e709d08b7406375f5e186b7576d0bf0e59c262` (`Idk lol`)  
**Scope:** archaeology/planning only; no implementation code changed.

## Evidence and authority

This baseline separates three evidence classes:

1. **Repository evidence** — authoritative for current implementation.
2. **Approved Zene/Dashboard specifications** — authoritative for intended architecture.
3. **UI research** — authoritative for requested design direction, not current implementation.

The supplied specifications explicitly require source-first verification and say unverified facts must be marked NOT VERIFIED. This baseline therefore does not treat specification statements such as “existing dashboard has X” as proof unless the repository was inspected.

## Executive architecture map

```
Browser
  |
  | REST / SSE / future WebSocket
  v
Dashboard API (current: dashboard plugin routes on Zene HTTP)
  |
  +--> dashboard auth/session -> token plugin -> PermissionsManager
  |
  +--> dashboard registry -> PluginManager + plugin dashboard manifests
  |
  +--> dashboard data -> dash-data -> Zene database adapters
  |
  +--> Discord/guild operations -> Heart/client + permissions/hierarchy
  |
  +--> Cross-Host operations -> worker cluster client / orchestrator gateway
  |
  +--> audit/errors/analytics -> existing core registries + dash-data
  |
  +--> OpenAPI -> API plugin GatewayConfigManager route discovery
  |
  +--> realtime -> EventBus -> current dashboard SSE
  |
  +--> owner theme/layout/landing persistence -> dash-data
```

**Important current-state fact:** the repository is a Zene backend/framework with a dashboard API plugin. It does **not** contain a separate browser dashboard application, React/Next/Vite frontend, public-site application, or frontend component library. The tree contains no frontend/web application matching the requested final platform. The dashboard backend is therefore an existing backend foundation, not the final Dashboard Platform.

## Subsystem archaeology

### 1. Zene core architecture

**Exists:** TypeScript, pure ESM, Node >=20, discord.js v14. Core is organized around Heart/plugin-scoped runtime, BasePlugin, loaders, managers, database adapters, event bus, audit/errors, HTTP, and Cross-Host.

**Primary locations**
- `src/core/bases/*`
- `src/core/heart/*`
- `src/core/loader/*`
- `src/core/manager/*`
- `src/core/database/*`
- `src/core/audit/*`
- `src/core/errors/*`
- `src/core/crosshost/*`

**Lifecycle:** PluginManager discovers, validates/integrity-checks, dependency-sorts, preloads entrypoints, then creates a scoped Heart and loads middleware/events/commands/handlers/routes before `onEnable`. Disable removes interactions, EventBus subscriptions, HTTP namespace, and handlers.

**Spec mapping:** preserve this architecture. Dashboard must extend it rather than become a second backend.

**Missing/changes:** capability resolution, canonical identity, richer SDK, dashboard override/editor runtime, centralized privacy/data-rights, typed dashboard event catalog, and browser-facing dashboard application.

**Must remain:** Heart/plugin lifecycle, loaders, existing managers, audit/error facilities.

**Risk:** dashboard features that bypass existing managers would create competing security/data ownership systems.

### 2. Plugin manager and lifecycle

**Exists:** `src/core/loader/index.ts`, `discovery.ts`, dependency loader, integrity gate, PluginManager registry; dashboard exposes plugin lifecycle through `src/plugins/dashboard/src/lib/pluginLifecycle.ts` and `adminPlugins.ts`.

**Current behavior:** enable/reload delegates to PluginManager.reload; disable calls PluginManager.disable; dashboard adds a 30s lifecycle cooldown and bumps dashboard registry version.

**Spec expects:** dashboard plugin contributions to participate in a stable SDK/manifest contract, with manifest identity/hash included in Cross-Host executable compatibility and owner overrides kept outside plugin source.

**Missing:** V2 manifest schema, schema migration, plugin dashboard data/privacy/analytics declarations, richer capability model, override layer.

**Remain:** PluginManager as lifecycle authority.

### 3. Permissions and hierarchy

**Exists:** ranked permission bits, bot/server/plugin scopes, custom bit registration, role stores, cache, owner/protected-bit guards, hierarchy helpers. `src/core/types/permissions.ts` defines built-ins including dashboard/theme/pages, analytics, fleet, shard, token, permission, gates, and Cross-Host bits.

**Current security:** dashboard routes use token payload bits and explicit helpers such as `requireAuthedBit`, `requireGuildBit`; owner/protected role mutation is guarded in PermissionsManager.

**Spec expects:** capability layer above bits, contextual resolution, 404 information hiding, widget/action-level filtering, no duplicate dashboard permissions.

**Conflict:** current dashboard authorization is bit-oriented and often returns 403; registry uses a `visibleEstimate`, not a final per-request security registry. `requireGuildBit` checks token guild scope/bits but is not a generalized capability/resource resolver.

**Missing:** `CapabilityResolver`, typed routing/resource context, server-side final registry filtering, information-minimizing 404 semantics, realtime authorization reevaluation.

**Remain:** existing bits, ranks, owner/server-owner hierarchy, protected target rules.

### 4. Token/session/authentication

**Exists:** `src/core/manager/token.ts`, `tokenCrypto.ts`, token plugin handler/routes. Tokens are signed HMAC-style Zene tokens containing userId, iat/exp, jti, deviceId, bits, optional guildId, tokenVersion, issuer/audience. DB-backed token store supports global/device versions, devices, revocation.

Dashboard currently resolves a Discord OAuth access token through Discord /users/@me, then issues a Zene dashboard session. Session is supplied via `X-Dash-Session`.

**Spec expects:** one canonical Zene User/Identity/Credential/Passkey/SecurityKey/Session/Device/Recovery/SecurityEvent model; Discord is one provider among Discord/GitHub/Google/X/email/password/Apple/Microsoft/OIDC/SAML; TOTP/passkeys/security keys/sudo.

**Conflict:** current dashboard identity model is effectively Discord-provider-first; no repository evidence of the specified canonical identity subsystem or provider registry.

**Missing:** identity persistence, provider framework, WebAuthn, password/recovery, SSO, sudo, security-event model, user-facing device/session management beyond token device records.

**Remain:** TokenManager as the signed session/token primitive unless a future identity layer explicitly extends it.

### 5. HTTP/API architecture

**Exists:** `src/core/manager/http/server.ts` owns Express server and router mounts. BaseRoute/RouteLoader discover and mount plugin routes. API plugin provides gateway middleware, CORS/security/auth configuration, and `/api/openapi.json`.

Dashboard routes use `applyGateway` and common `ok/err/HttpError` response helpers.

**Spec expects:** Dashboard API as sole browser boundary, explicit typed contracts, auth/authz/routing/resource resolution/response normalization/404 controls/idempotency/concurrency.

**Missing:** dedicated Dashboard Gateway/BFF abstraction and typed request routing context; current routes directly perform many resource operations.

**Risk:** current API gateway and Cross-Host gateway are adjacent concepts but not yet a unified Dashboard routing architecture.

### 6. Current dashboard architecture

**Exists:** `src/plugins/dashboard/*` with auth, registry, public, user, server, owner/admin, fleet, exports, analytics, theme, layout, plugin, updater, broker, and event routes.

**Current shape:** dashboard is a backend plugin mounted through Zene's normal route loader. It is not a standalone frontend.

**Spec expects:** integrated web platform with public site, user dashboard, server dashboard, owner control plane, editor, plugin platform, privacy, analytics, metrics, realtime.

**Missing:** browser application and most platform services.

### 7. Dashboard SDK

**Exists:** `src/core/types/dashSdk.ts`.

Current model includes:
- 13 surface kinds
- visibility rules based primarily on bits/user/guild/feature flag
- theme preferences
- declarative payloads
- iframe/hostModule references
- plugin manifest with schemaVersion/pluginId/surfaces/themePresets/dashCompat
- resolved registry/snapshot types

**Spec expects V2:** surfaces, widgets, layout, theme, permissions, capabilities, API/data providers, realtime, analytics, privacy, editor, errors, assets.

**Conflict:** current types are V1/small metadata contract; many V2 domains are absent. Current `visibleEstimate` is explicitly not sufficient as the final security boundary.

**Missing:** stable V2 module contracts, typed capabilities, widget/data/realtime/privacy/editor/assets APIs, manifest version migration.

**Remain:** `dashSdk.ts` should be extended rather than replaced.

### 8. dash-data

**Exists:** `src/plugins/dash-data/src/lib/store.ts`, handler, migrations. It delegates to `resolveDashboardBackend()` and `openSqlAdapter()`, supports SQL adapters and Mongo, and provides dashboard collections for Surreal.

Current persistent concepts include:
- `dash_kv`
- `dash_layouts`
- `dash_theme`
- `dash_theme_presets`
- `dash_landing_config`
- `dash_surface_flags`
- `dash_server_plugin_config`
- `dash_global_member_bans`
- `dash_member_notes`
- `dash_deletion_requests`
- `dash_moderation_actions`
- `dash_audit_log`
- `dash_infractions`
- `dash_command_counters`

**Spec expects:** remain the dashboard data abstraction; add migrations for versions, drafts, schedules, overrides, privacy/deletion, analytics/metrics.

**Conflict:** several dashboard routes directly issue SQL through dash-data helpers. This is not a second database, but the future architecture requires stronger domain-level dash-data APIs so routes do not become ad-hoc persistence code.

### 9. Database abstraction

**Exists:** `src/core/database/*` supports native Postgres, native SQLite, TypeORM SQL engines, MongoDB, Redis and SurrealDB. Migrations are versioned.

**Cross-Host:** local SQLite/file/embedded Surreal is rejected; Cross-Host requires remote Surreal for shared document data.

**Spec expects:** existing adapters remain authoritative; no second dashboard database; every new persistent structure gets versioned migration support.

**Missing:** dashboard-specific migration expansion for final platform.

**Remain:** adapter abstraction and Cross-Host storage gate.

### 10. Redis

**Exists:** `src/core/database/redis.ts` maintains main/pub/sub Redis clients per alias. Cross-Host uses Redis for control-plane channels/state.

**Spec expects:** Redis remains internal/control-plane infrastructure; browser never connects directly.

**Missing:** dashboard-specific distributed realtime propagation semantics and typed authorization-aware fanout.

**Risk:** current dashboard SSE client registry is process-local; Cross-Host dashboard events are not yet a complete shared event architecture.

### 11. Events

**Exists:** EventBus with exact/wildcard listeners, priority, owner tracking, sequential/concurrent emit. Plugin lifecycle and system events are emitted.

Dashboard currently emits/consumes `dash.registry.updated`, `dash.surface.invalidate`, `dash.theme.updated`, `dash.layout.updated`, `dash.widget.data`.

**Spec expects:** shared typed event catalog for REST/SSE/WebSocket with registry/theme/layout/widget/worker/shard/plugin/permission/session/deletion/privacy/analytics events.

**Missing:** typed catalog, authorization-aware event broker, cross-host propagation, permission-change subscription reevaluation.

### 12. OpenAPI

**Exists:** API plugin's `GatewayConfigManager.buildOpenApiSpec()` is exposed at `/api/openapi.json`; dashboard routes contain `@openapi` annotations. `swagger-jsdoc` is present in dependencies.

**Spec expects:** all production dashboard APIs documented, generated schemas/types where appropriate.

**Missing/NOT VERIFIED:** a repository path implementing generated schema/type synchronization beyond GatewayConfigManager was not established in the inspected tree. The existing route annotations are real, but completeness against the future API catalog is not established.

**Risk:** route annotations are currently loose descriptions rather than a fully typed contract system.

### 13. Cross-Host orchestrator

**Exists:** `src/core/crosshost/orchestrator/*`, Redis-backed membership, challenge/HMAC registration, machine tokens, snapshots, shard map, rebalance, metrics, control-plane HTTP.

The orchestrator also mounts `mountApiGateway` and can proxy HTTP requests to workers based on guild/shard affinity.

**Spec expects:** orchestrator remains control plane; dashboard metadata/assets may be indexed without booting arbitrary plugin runtime; executable compatibility expands to dashboard manifest identity/integrity/SDK compatibility.

**Missing:** dashboard-aware metadata registry and explicit Dashboard API routing context on top of current generic API gateway.

**Remain:** orchestrator control-plane role, worker admission, Redis control, shard map.

### 14. Cross-Host workers

**Exists:** worker runtime applies shard assignments, requests identify grants, starts Discord client when needed, boots plugins on assigned worker; StatsCollector publishes worker stats to Redis.

**Current stats:** guild count, member count when intent allows, event rate, command rate, shard count, custom gauges.

**Spec expects:** CPU/RAM/heap/GC/event loop/network/disk/guild/member/event/command/shard/latency/plugin health and richer shard session/disconnect state.

**Missing:** most requested host/runtime metrics and dashboard-specific health aggregation.

### 15. Shard routing

**Exists:** `affinity.ts`, shard map, guild-owner endpoint, orchestrator API gateway. Guild ID resolves to Discord shard ID and shard owner worker.

**Spec expects:** browser never computes/targets shard affinity; Dashboard API resolves resource -> guild -> shard -> worker.

**Current state:** routing logic exists centrally and is reusable. Dashboard fleet routes currently call worker cluster APIs from a worker process rather than exposing a unified Dashboard RoutingResolver.

**Missing:** typed routing context and centralized resource routing service.

### 16. Current dashboard registry

**Exists:** `dashRegistry.ts` scans loaded plugins, reads `plugins/<id>/dashboard/manifest.json` when present, validates surface kind/tier/title, applies a visibility estimate, and returns a cached snapshot.

**Important verified fact:** the repository tree does not show any plugin dashboard manifests matching `*/dashboard/manifest.json`; only the dashboard plugin's own manifest was verified. Therefore the generic plugin-contribution path is present in code but currently has no verified installed contributor manifests.

**Conflict:** spec requires per-request/per-session final registry filtered through auth context/capabilities/resource scope/editor flags. Current registry snapshot can include blocked surfaces with `visibleEstimate:false` and is cached globally.

### 17. Current dashboard realtime

**Exists:** SSE route `/api/dash/events/sse`, EventBus wiring, heartbeat every 25s.

**Critical conflict:** `SseClient` stores user/bits, but `broadcastDashEvent()` sends each event to every client without checking those bits or resource scope. Thus current realtime filtering is not a final authorization boundary.

**WebSocket:** `/api/dash/events/ws` currently returns 501 and explicitly says WebSocket is deferred.

**Missing:** typed shared event model, server-side per-event filtering, permission-change reevaluation/termination, reconnect/version reconciliation, WebSocket.

### 18. Current dashboard layouts

**Exists:** `dash_layouts` and `adminLayouts.ts`. Layout has scope, guildId, name, version, schemaVersion, one `grid` object, navOrder, themeOverrideId, updatedAt/by.

**Current mutation:** owner authorization is env BotOwnerIds; PUT can set an arbitrary version and overwrites the row.

**Spec expects:** desktop/tablet/mobile grids, immutable published versions, drafts, previews, schedules, optimistic concurrency, rollback/restore/reset, history.

**Missing:** responsive grid schema, immutable version store, draft/publish workflow, conflict checking, schedule, preview, rollback.

### 19. Current theme system

**Exists:** `dash_theme`, `dash_theme_presets`, `adminTheme.ts`; token JSON is persisted as a single current object, plus named presets. Landing config is also persisted.

**Current mutation:** env BotOwnerIds plus existing theme/page bits are used; theme PUT directly updates current tokens.

**Spec expects:** semantic/component/element tokens, light/dark/custom, gradients, typography, motion, accessibility constraints, plugin token contributions, runtime override layers, versioning/reset/import/export.

**Missing:** layered token runtime, validation, versioning/drafts/preview/publish, accessibility invariants.

### 20. Current public site

**Exists:** public API endpoints for landing-config, stats, bot-info under `/api/dash/public`.

**Missing:** public website/browser UI, configurable routes/sections, SEO, docs/changelog/FAQ/legal/status/contact surfaces, shared component/design platform.

**Risk:** current public stats use live Discord cache and command counters; Cross-Host aggregation is not a complete public metrics architecture.

### 21. Current deletion/data-rights implementation

**Exists:** `dash_deletion_requests` table and migration, but no verified dashboard deletion route/service/central DataRightsService was found in the inspected repository tree.

**Spec expects:** central DataRightsService, plugin data registry, request/approve/reject/cancel/execute/verify/export/status, server/bot/account scopes, idempotent handlers, recovery/notice, legal retention exceptions, completion reports.

**Conflict:** current persistence is a single `userId/requestedAt/status` table; it is far below the specified workflow and there is no verified orchestration layer.

### 22. Current analytics/telemetry

**Exists:** dashboard analytics handler records per-day command/plugin/name counters in `dash_command_counters`; admin analytics exposes command totals/series/plugin breakdown and logs. Core has metrics manager and Cross-Host worker stats.

**Spec expects:** typed metrics registry, host/node/Discord/Zene/dashboard/Cross-Host catalog, retention, plugin analytics declarations, privacy classification, configurable product/marketing analytics.

**Missing:** central metrics/analytics registry, privacy-aware analytics consent/configuration, historical retention engine, host/runtime metric catalog, cross-host aggregation.

### 23. Current plugin dashboard functionality

**Exists:** dashboard registry, plugin lifecycle/config/locale management, plugin page bundle URL inspection, manifest reading, and SDK surface types.

**Missing:** verified plugin dashboard manifests, rich typed plugin contribution API, data/privacy/analytics declarations, realtime/data providers, editor integration, public surfaces, theme contributions.

### 24. Current frontend/component architecture

**Exists:** no browser application. Backend has Discord Components V2 builders, but these are Discord UI builders and are unrelated to the requested web component architecture.

**Spec expects:** Zene-native web design system with command palette, action panels, expandable widgets, contextual drawers, responsive layouts, tokenized theme system, editor primitives, accessible components, i18n/RTL.

**Status:** NOT VERIFIED as existing because no frontend tree exists; absence was established from the full repository tree inspected.

### 25. Current testing/build architecture

**Exists:** TypeScript compiler, build scripts, lint script, TypeDoc, GitHub workflows for plugin CI/release/sync, and one verified dashboard unit test (`brokerPath.test.ts`). Package scripts do not expose a general Vitest/Jest/Playwright test command.

**Spec expects:** comprehensive acceptance suite spanning build/API/OpenAPI/auth/permissions/404 registry/realtime/Cross-Host/database/privacy/editor/security/SEO/accessibility.

**Missing:** browser test application and broad automated acceptance suite.

## Requirement-to-code traceability

| Requirement | Current code | State |
|---|---|---|
| Existing Zene permissions authoritative | `src/core/types/permissions.ts`, `src/core/manager/permissions.ts` | Present |
| Dashboard sessions | `src/core/manager/token.ts`, token plugin, dashboard auth | Partial/present |
| Dashboard API boundary | `src/plugins/dashboard/*` + HttpServer | Present backend; no browser |
| Server-side final registry | `dashRegistry.ts` | Partial; not security-final |
| Capability layer | No verified resolver | Missing |
| 404 information hiding | Generic 404 exists; dashboard authz often 403 | Missing/incomplete |
| Cross-Host routing | `crosshost/gateway/*`, orchestrator, shard map | Present foundation |
| Dashboard routing resolver | No verified dedicated resolver | Missing |
| Dashboard SDK V2 | `dashSdk.ts` | Partial/V1 |
| Plugin dashboard manifests | Reader exists | Partial; no verified contributor manifests |
| Theme persistence | `dash_theme`, `adminTheme.ts` | Partial |
| Responsive layouts | `dash_layouts` single grid | Missing |
| Override engine | No verified implementation | Missing |
| Editor | No verified implementation | Missing |
| Preview/publish/schedule | No verified implementation | Missing |
| Canonical identity | No verified subsystem | Missing |
| Multi-provider auth | No verified subsystem | Missing |
| Passkeys/security keys | No verified subsystem | Missing |
| Sudo | No verified dashboard subsystem | Missing |
| Privacy registry | No verified implementation | Missing |
| DataRightsService | No verified implementation | Missing |
| Deletion table | `dash_deletion_requests` | Partial |
| Export | audit/error exports only | Partial |
| Analytics | command counters + routes | Partial |
| Metrics registry | core metrics + worker stats | Partial |
| SSE | `dashEvents.ts`, `events.ts` | Present but auth-incomplete |
| WebSocket | `events.ts` returns 501 | Missing |
| Typed realtime catalog | No verified shared catalog | Missing |
| OpenAPI | API Gateway + route annotations | Present foundation |
| API idempotency | No generalized dashboard mechanism verified | Missing |
| Optimistic concurrency | Layout version is writable, no conflict check | Missing |
| Audit | core audit + dashboard writeAudit | Present foundation |
| Public site | public API only | Missing UI |
| Frontend | none | Missing |
| Browser acceptance tests | none verified | Missing |

## Architectural conflicts

1. **Dashboard SDK contract conflict:** current `dashSdk.ts` is materially smaller than V2.
2. **Authorization conflict:** current dashboard authorization is bit-based and often 403; final architecture requires capability/resource-aware 404 information hiding.
3. **Registry conflict:** current snapshot is cached/global and exposes `visibleEstimate`; spec requires a genuinely filtered final registry per request/session.
4. **Realtime security conflict:** current SSE broadcast does not filter events by client permissions/resource scope.
5. **Realtime transport conflict:** WebSocket is explicitly deferred but required day one.
6. **Identity conflict:** current dashboard starts from Discord OAuth and issues dashboard tokens; canonical multi-provider Zene identity is absent.
7. **Deletion conflict:** current table is minimal and lacks the specified central workflow.
8. **Persistence architecture conflict:** dashboard routes can issue raw SQL through dash-data helpers; final design requires domain data abstractions rather than route-level persistence logic.
9. **Theme/layout conflict:** current mutable “current” records are incompatible with immutable version/draft/publish/schedule semantics.
10. **Frontend conflict:** the repository has no web app, so all final UI/component/public-site requirements are net-new.
11. **OpenAPI contract gap:** current annotations/generator exist, but there is no verified typed schema generation layer covering the future API.
12. **Cross-Host dashboard conflict:** generic API gateway routing exists, but there is no verified typed Dashboard RoutingResolver or dashboard metadata registry in the orchestrator.
13. **Metrics conflict:** current counters/stats are useful foundations but do not constitute the specified registry/retention/privacy-aware analytics system.

## Dependency graph

```
Core identity/auth
  -> session/token assurance
  -> authorization context
  -> capability resolver
  -> resource scope
       |
       +-> dashboard registry
       +-> REST route authorization
       +-> realtime authorization
       +-> search/discovery
       +-> editor/publish authorization

Plugin lifecycle + manifest/integrity
  -> Dashboard SDK V2
  -> plugin surface registry
  -> plugin data/privacy/analytics declarations
  -> Cross-Host compatibility
       |
       +-> orchestrator metadata index

Database abstraction + dash-data
  -> dashboard persistence
  -> layouts/themes/overrides
  -> privacy/deletion jobs
  -> analytics/metrics retention

EventBus + Redis/Cross-Host propagation
  -> typed realtime catalog
  -> SSE
  -> WebSocket
  -> invalidation/registry/theme/layout/widget events

Cross-Host membership + shard map + worker stats
  -> Dashboard RoutingResolver
  -> fleet/shard views
  -> worker/shard metrics

SDK V2 + registry + theme/layout runtime
  -> browser dashboard application
  -> owner editor
  -> plugin UI
  -> public site

OpenAPI + typed contracts
  -> browser client SDK
  -> contract tests
  -> documentation

Audit + request IDs
  -> privileged mutations
  -> editor publishing
  -> privacy/deletion
  -> fleet/security actions
```

## Highest-risk areas

1. **Authorization/resource resolution** — mistakes become IDOR/information-disclosure vulnerabilities.
2. **Realtime authorization** — current SSE proves that event transport can exist without correct filtering.
3. **Canonical identity migration** — affects tokens, sessions, providers, Discord linking, audit and all dashboard routes.
4. **Owner TSX/override runtime** — trusted code plus persistence/versioning requires strong isolation of data, secrets, failure recovery and audit semantics even though code itself is trusted.
5. **Cross-Host routing and degraded control-plane behavior** — must preserve shard ownership and avoid browser exposure of machine credentials.
6. **Data-rights execution** — plugin hooks, retention/legal exceptions and idempotency cross database and lifecycle boundaries.
7. **Persistence migration** — existing layouts/themes/deletion records must survive migration across SQLite/Postgres/Mongo/Surreal where supported.
8. **Plugin SDK compatibility** — manifest/SDK evolution must not break installed plugins or Cross-Host admission.
9. **Frontend/plugin execution model** — no existing web runtime means this is a new platform boundary.
10. **OpenAPI/typed contract completeness** — current route annotations are not sufficient evidence for the final contract surface.

## What must remain unchanged unless a later decision supersedes it

- Zene PluginManager and lifecycle.
- Existing permission bits/ranks/hierarchy and protected-target semantics.
- Existing token manager as a reusable session/token primitive.
- Existing EventBus.
- Existing database adapter abstraction.
- Cross-Host orchestrator as control plane.
- Worker/plugin/Discord runtime ownership.
- Cross-Host storage gate.
- Core audit/error registries.
- Dashboard plugin as the Zene-integrated browser API backend.
- `dash-data` as dashboard persistence abstraction.
- OpenAPI generation through the API plugin.
- Trusted-plugin model and trusted owner TSX model, subject to the specified security/audit constraints.

## Exact systems expected to change

### Core
- `src/core/types/dashSdk.ts`
- `src/core/types/permissions.ts` only where new capability metadata must be represented
- `src/core/manager/permissions.ts` and permission helpers
- `src/core/manager/token.ts` / token plugin integration
- new identity/auth/security modules
- `src/core/manager/events/EventBus.ts` plus typed dashboard event catalog
- `src/core/database/*` only for required shared abstractions/migrations
- `src/core/crosshost/*` for dashboard routing/metadata/compatibility/realtime propagation
- OpenAPI/gateway integration

### Plugins
- `src/plugins/dashboard/*`
- `src/plugins/dash-data/*`
- `src/plugins/token/*`
- `src/plugins/api/*`
- affected plugin manifests under `src/plugins/*` as the SDK is adopted
- plugin data/privacy/analytics declarations

### New web platform
- a new browser application tree (exact location is a design decision because no current frontend exists)
- component/design system
- dashboard/public-site routes
- browser API client
- SSE/WebSocket client
- editor runtime
- theme/layout runtime
- plugin surface runtime

### Documentation/checkpoints
- `ai_docs/architecture-baseline.md`
- `ai_docs/implementation-state.md`
- `ai_docs/architecture-decisions.md`

## Proposed implementation phases

### Phase 0 — this checkpoint
Repository archaeology, architecture map, traceability, conflicts, risks, file impact, decisions. No implementation code.

### Phase 1 — platform contracts and security foundation
Lock typed Dashboard SDK V2, routing context, capability model, final registry contract, API response/error/idempotency/concurrency contracts, typed event catalog, and canonical identity/session extension boundaries. No broad UI work yet.

### Phase 2 — Dashboard API/BFF and Cross-Host routing
Centralize Dashboard Gateway authorization/resource resolution, 404 information hiding, guild/shard/worker routing, orchestrator metadata boundary, and single-host/Cross-Host parity.

### Phase 3 — dash-data + persistence versioning
Responsive layouts, theme layers, override/version/draft/schedule/preview persistence, migrations, concurrency, data providers.

### Phase 4 — realtime
Shared event broker/catalog, SSE authorization/reconnect/version reconciliation, WebSocket, Cross-Host propagation, registry/theme/layout/widget/permission/session events.

### Phase 5 — identity/auth/security
Canonical user/identity model, providers, WebAuthn/passkeys/security keys, TOTP/recovery, sessions/devices, sudo, provider management, security events.

### Phase 6 — privacy/data rights + analytics/metrics
Data registry, deletion/export engine, retention/legal holds, policy generation/versioning, metrics registry, analytics registry, privacy controls and retention.

### Phase 7 — web design system + application shell
Zene-native component system, theme runtime, responsive shell, command palette/action panels/drawers/widgets, accessibility/i18n, public site shell.

### Phase 8 — plugin dashboard runtime + owner editor
Plugin V2 manifests, surface runtime, trusted TSX, visual editor, overrides, preview, publish/rollback/restore, scheduled publishing.

### Phase 9 — full product surfaces
User/server/owner/fleet/plugin/privacy/analytics/metrics/public/legal/status routes and UI.

### Phase 10 — hardening and acceptance
Security/IDOR/XSS/CSRF/OAuth tests, contract/OpenAPI tests, Cross-Host failure/rebalance, database matrix, realtime tests, accessibility/SEO, build/release verification.

## Recommended first implementation phase after Phase 0

**Phase 1: Platform Contracts and Security Foundation.**

The current repository already has enough persistence/routes to tempt incremental UI construction, but doing so before fixing the registry/auth/routing/event contracts would bake current security limitations into the browser architecture. The first implementation should therefore establish the canonical internal contracts that every later surface consumes.

## Genuine decision points

1. **Frontend location/deployment:** exact repository path/package and build/deployment model for the new browser application.
2. **Canonical identity migration strategy:** introduce identity tables/models in core first, or extend the existing token/device system behind a compatibility layer.
3. **Dashboard API ownership:** keep all dashboard routes inside `src/plugins/dashboard` or introduce a dedicated core Dashboard Gateway package while retaining the plugin as integration facade.
4. **WebSocket implementation:** Node HTTP upgrade in the existing server vs a dedicated transport module/package.
5. **Cross-Host dashboard metadata:** exact artifact/index representation and how orchestrator obtains plugin dashboard manifests/assets without booting plugin runtime.
6. **Owner TSX runtime:** exact execution/bundling strategy for trusted TSX and failure isolation.
7. **Persistence backend policy:** whether every dashboard feature must support every existing adapter immediately or whether features can declare backend requirements while preserving the Cross-Host safety gate.
8. **Identity schema ownership:** core database migrations vs a dedicated identity plugin.
9. **Analytics privacy defaults:** exact opt-in/opt-out semantics and whether product analytics and operational metrics share a storage/registry abstraction.

## NOT VERIFIED

- Working-tree cleanliness of a local checkout. GitHub inspection verifies remote `main`, not a user's unpushed local changes.
- A complete browser/frontend tree (none was found in the remote tree inspected).
- A complete generated OpenAPI schema/type pipeline beyond the API Gateway generator and route annotations.
- Any existing canonical multi-provider identity implementation.
- Any existing central DataRightsService/privacy registry.
- Any existing WebSocket implementation.
- Any existing plugin contributor dashboard manifests beyond the manifest-reading capability.
- Any existing owner TSX editor/runtime.
