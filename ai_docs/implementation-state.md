# Zene Implementation State

## Phase
**Phase 0 — Repository Archaeology and Architecture Baseline**

## Status
Complete for the requested archaeology scope. No implementation code was changed.

## Evidence baseline
- Repository: `lunedusk/Zene`
- Ref inspected: `main`
- Commit: `42e709d08b7406375f5e186b7576d0bf0e59c262`
- Commit message: `Idk lol`
- Supplied specifications: `ai_docs/zene.md`, `ai_docs/dashboard.md`, `ai_docs/ui-research.json`

## Completed
- Repository tree archaeology.
- Core/plugin lifecycle mapping.
- Permission/hierarchy mapping.
- Token/session/auth mapping.
- HTTP/API/OpenAPI mapping.
- Dashboard backend mapping.
- Dashboard SDK mapping.
- dash-data/database/Redis mapping.
- Event/realtime mapping.
- Cross-Host orchestrator/worker/shard routing mapping.
- Registry/layout/theme/public-site mapping.
- Deletion/privacy and analytics mapping.
- Frontend/testing/build archaeology.
- Requirement-to-code traceability.
- Architectural conflict/risk analysis.
- Proposed implementation sequence.

## Changed files
- `ai_docs/architecture-baseline.md`
- `ai_docs/implementation-state.md`
- `ai_docs/architecture-decisions.md`

No implementation source, migration, test, configuration, or generated runtime file was changed.

## Major discoveries
1. Dashboard backend exists and is integrated with Zene, but no browser dashboard application exists in the inspected repository.
2. `src/core/types/dashSdk.ts` is a small V1-style contract, not the requested V2 platform contract.
3. Existing dashboard registry visibility is an estimate and is not sufficient as the final authorization boundary.
4. Current SSE broadcasts events to connected clients without per-event permission/resource filtering.
5. WebSocket endpoint is currently a 501/deferred stub.
6. Dashboard auth is Discord OAuth access-token resolution into a Zene signed dashboard token; canonical multi-provider identity is not verified.
7. `dash_deletion_requests` exists, but no central DataRightsService/workflow was verified.
8. Layout/theme persistence exists but lacks immutable draft/publish/version/rollback semantics.
9. Cross-Host routing/control-plane foundations are substantial and should be extended, not replaced.
10. No contributor plugin dashboard manifests were verified in the repository tree.

## Blocked
No implementation blocker was encountered for Phase 0. Several future decisions remain open; they are recorded in the architecture baseline.

## Next task
Phase 1 — Platform Contracts and Security Foundation, only when explicitly requested.

## Checkpoint
Phase 0 planning checkpoint branch: `phase-0/repository-archaeology-2026-09-29`.

## Verification
Repository archaeology was performed against the remote `main` tree and key source files. Local unpushed working-tree state is NOT VERIFIED.
