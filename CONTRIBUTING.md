# Contributing to Zene

This guide describes a source-first contribution workflow for the repository at the documentation baseline [`c510bbf8fde1fedffd05efe2779ee71e90d5597d`](https://github.com/lunedusk/Zene/commit/c510bbf8fde1fedffd05efe2779ee71e90d5597d). Commands and scripts may differ on later revisions; check `package.json` before running them.

## Before changing code

1. Identify the affected product boundary: Core, first-party plugin, public SDK, runtime host, database adapter, or documentation.
2. Read the implementation, exported TypeScript contracts, callers, neighboring tests, and current documentation. Treat current source and tests as authoritative over older examples.
3. Record the intended behavior and compatibility constraints before refactoring. Keep a change focused; don't combine unrelated cleanup merely because it is nearby.
4. For trust, permissions, privacy, environment handling, or persistence, explicitly document the threat model and failure behavior.

## Implementation expectations

- Keep strict TypeScript types and ESM import conventions aligned with the repository.
- Do not assume `IHeart` and `@lunedusk/zene-sdk` are interchangeable. New external plugin integrations should target the public SDK where the runtime supports it; Core internals are not a public API contract.
- Bind resources and registrations to plugin/runtime lifecycle ownership. A disable or unload must not leave event listeners, command routes, timers, provider bindings, or runtime handles active.
- Do not weaken signature verification, dependency-closure checks, runtime isolation floors, request validation, permission checks, or data privacy controls to make a change easier.
- Do not silently fall back from an explicitly requested durable backend to memory. Keep development/test overrides explicit.
- Never place credential-bearing values, tokens, raw secret values, authorization headers, or full database URIs in logs, tests, examples, or committed configuration.
- Add a regression test for a reproduced defect. Test both the expected result and important failure paths.
- Update the relevant documentation in the same change when an API, configuration key, lifecycle guarantee, operator workflow, or data shape changes.

## Validation

Inspect `package.json` to confirm available scripts. At this baseline the root package declares `build`, `slim-build`, `compile`, `copy-assets`, `start`, `dev`, and other scripts, but it does **not** declare a root `test` script. Don't invent `npm test` as a repository validation command.

Useful validations include:

```bash
npm run slim-build
```

For tests written for Node's test runner and `tsx`, run the relevant files explicitly, for example:

```bash
npx tsx --test src/core/database/surrealRecord.unit.test.ts
```

Integration tests may require local database services and an explicit opt-in environment setting. Read the test setup before executing them; never direct integration tests at production services. See [Testing and validation](TESTING.md) for the known targeted SurrealDB checks and the distinction between focused validation and a full suite.

Do not claim a command passed unless you executed it in the active checkout and observed the exit status. Report any tests not run and why.

## Documentation contributions

- Write for the intended audience: plugin developer, Core contributor, SDK consumer, or operator.
- State the exact source baseline when describing implementation behavior.
- Prefer complete argument/return/failure descriptions to broad claims such as “supports everything”.
- Link to source paths and the relevant reference page. Keep relative links valid.
- Separate production environment settings from one-off script inputs and test harness variables.
- Mark actual limitations clearly; do not turn future intentions into guarantees.

## Pull requests and commits

Use a focused pull request with a clear explanation of the problem, implementation approach, compatibility impact, and validation performed. Mention migrations, environment changes, or operator actions where applicable. Avoid unrelated generated output, local database files, `.env` files, logs, or build artifacts.

Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating. Report vulnerabilities through the repository's private reporting channels rather than disclosing exploit details in a public issue.
