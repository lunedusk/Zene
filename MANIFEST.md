# Documentation revamp bundle manifest

## Baseline

- Repository: [`lunedusk/Zene`](https://github.com/lunedusk/Zene)
- Source revision: [`c510bbf8fde1fedffd05efe2779ee71e90d5597d`](https://github.com/lunedusk/Zene/commit/c510bbf8fde1fedffd05efe2779ee71e90d5597d)
- Package version at baseline: `0.5.7`
- Documentation is a new source-oriented set, not a merge that preserves the former docs' headings or structure.

## Apply the bundle

From the Zene repository root, extract the archive over the checkout and review the diff before committing. Paths inside the archive match their intended repository paths. Existing files with the same path are replaced; new files are added. The archive contains documentation only—it does not modify TypeScript, tests, `package.json`, lockfiles, `.gitignore`, or runtime configuration.

```bash
tar -tzf Zene-Documentation-Revamp-c510bbf.tar.gz
# After copying the archive into the checkout:
tar -xzf Zene-Documentation-Revamp-c510bbf.tar.gz -C .
git status --short
git diff --check
git diff --stat
```

Do not commit the archive itself into the repo unless the maintainer explicitly wants a downloadable release artifact tracked there.

## Rewritten existing documents

These documents already existed in the source revision and are replaced by the corresponding files in this bundle:

- `README.md`
- `SETUP.md`
- `PLUGINS.md`
- `Database.md`
- `ENV Reference.md`
- `CROSS_HOST.md`
- `INTEGRITY.md`
- `EVENTS.md`
- `DATA_SHAPES.md`
- `LOADER.md`
- `PLACEHOLDERS.md`
- `AUDIT.md`
- `CACHE.md`
- `ERRORS.md`
- `UPDATER.md`
- `System Prompt - AI - Plugin.md`
- `CONTRIBUTING.md`
- `packages/zene-sdk/README.md`

## New reference documents

- `ARCHITECTURE.md` — architecture map and trust boundaries.
- `CORE_API_REFERENCE.md` — Core `IHeart` service surface for trusted plugin code.
- `SDK_REFERENCE.md` — public `@lunedusk/zene-sdk` bridge contract.
- `RUNTIME.md` — runtime policy, isolation levels, host protocol and cleanup.
- `SECURITY.md` — threat model and operator/developer checks.
- `OPERATIONS.md` — operational troubleshooting.
- `TESTING.md` — test layers, safe integration setup and reported validation state.
- `GLOSSARY.md` — shared vocabulary.
- `SOURCE_TRACEABILITY.md` — documentation-to-source map and verification boundaries.
- `MANIFEST.md` — this file.

## Intentionally not replaced

`CODE_OF_CONDUCT.md` and `CONTRIBUTORS.md` are community/governance documents, not technical architecture references, and are intentionally left untouched. The root `LICENSE` is not documentation content to rewrite. The existing `.env.example` is also not included because it is a tracked runtime configuration example, not a Markdown reference; review it as a separate config change rather than silently changing it in a docs-only bundle.

## Verification summary and limits

The Markdown files were checked for non-empty content, internal relative links, duplicate `REDIS_URL` inventory rows, and accidental inclusion of known integration-test flags in the production environment reference. All bundle-to-bundle Markdown links were resolved during the final local check; links to repository files intentionally kept outside the bundle (such as `CODE_OF_CONDUCT.md`) resolve after extraction into the repository.

This is not a code build and the docs archive has not been committed to GitHub. The owner-reported targeted validation on the baseline was: Surreal record unit tests 2 passed; opt-in combined Surreal-store/durable-data integration tests 8 passed with 0 failures; `npm run slim-build` completed without reported errors. The full regular build and full repository test suite were not shown as run. See `TESTING.md` and `SOURCE_TRACEABILITY.md` for detail.
