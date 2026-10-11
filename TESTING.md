# Testing and validation guide

## 1. Test layers

Use distinct suites for the following contracts:

1. **Pure unit tests:** deterministic parser/codec/policy behavior, such as Surreal record helpers, requirement evaluation and runtime candidate selection.
2. **Core integration tests:** bootstrap order, loader lifecycle, data registry authorization, command registration, event/route ownership, runtime cleanup and error mapping.
3. **Service-backed integration tests:** real SQLite, PostgreSQL, MongoDB, SurrealDB and Redis contracts; only run when the corresponding service is intentionally configured.
4. **End-to-end tests:** gateway/HTTP behavior, first-party plugins, dashboard/auth flows, command sync, updater plans and Cross-Host worker/orchestrator lifecycle.
5. **Build/package checks:** clean output, local SDK build, ESM resolution, bundled/copied assets and plugin artifact pack/unpack verification.

A passing unit test proves only the assertion it exercises. A successful local build does not prove service integration. A local integration test that manually defines a table does not prove production bootstrap defines it.

## 2. Standard validation commands

```bash
npm run build
npm run slim-build
npm run lint
```

`npm run build` performs clean output generation, local package builds, TypeScript compilation and asset copying. `slim-build` uses pre-built local package dependencies. `lint` invokes ESLint with `--fix`; run it only when you intend to accept and review formatting changes.

Focused tests use the repository's established Node test runner and `tsx`, for example:

```bash
npx tsx --test src/core/database/surrealRecord.unit.test.ts
```

Review the current test scripts and filenames in the current commit; not every local-only test is necessarily tracked in Git. Never claim a test ran because it appears in a suggested command.

## 3. SurrealDB record compatibility

The current source provides `src/core/database/surrealRecord.ts` to centralize record construction and logical-key handling. Its unit tests cover removal of a reserved `id` field from CONTENT payloads and logical-key read precedence. The owner reported an optional live suite at `src/core/database/phase4-surreal-stores.integration.test.ts` that covers helper CRUD, audit insert/read, and error occurrence schema initialization/coalescing/readback.

At the validation baseline, the owner ran:

- helper tests: 2 passed;
- combined opt-in Surreal-store and durable-data integration tests: 8 passed, 0 failed;
- `npm run slim-build`: completed without reported errors.

Those results are from the owner-provided terminal transcript, not rerun by this documentation pass. The regular `npm run build` and full repository test suite were not included in that transcript. Run them after changes and keep the outputs associated with the exact commit tested.

## 4. Integration safety

- Use an explicit test namespace/database or isolated test environment.
- Generate a unique prefix/ID for every test-created record.
- Clean only records created by the test. Do not drop whole shared tables or databases.
- Do not use a fallback memory adapter to conceal a durable-backend failure.
- Exercise the production initializer when testing schema/bootstrap guarantees.
- Make service-backed tests opt-in if they require external daemons.
- Do not make normal builds require live databases.
- Keep credentials in local test environment variables and out of tracked docs/config.

## 5. What to assert

For data code, assert both authorization and persistence outcomes: correct owner, subject validation, policy/adapter match, stable identity, readback after successful write, deletion count and failure propagation. For schema ensure operations, test idempotence and cold-start behavior against a genuinely fresh test DB.

For loader/runtime code, test that code is not executed during metadata preload; invalid signatures do not trigger unsigned fallback; duplicate IDs reject all conflicted artifacts; dependencies load first; stale runtime generation messages are rejected; and cleanup doesn't remove a newer generation's resources.

For EventBus, test priority, wildcard matching, callback removal, owner unregister, once semantics for both serial and concurrent emission, and the returned error/result shape.

For plugin routes/commands, test permission denials and malformed input—not just the successful handler path.

## 6. Reporting results

A useful validation report identifies the commit SHA, exact commands, exit codes, pass/fail/skip counts, services/versions, required env flags and any known exclusions. Separate “not run” from “passed”. Never summarize one passing test subset as “all tests passed.”
