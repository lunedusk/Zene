# Integrity and trust

Zene verifies plugin artifacts before trusting them for boot.

## Pipeline (conceptual)

```text
discovery → identity checks → integrity verification → signature / trust decision
→ authorization → dependency validation → load
```

## Artifacts

Signed plugin packages carry authenticated metadata used for ordering and policy. Priority and related fields must survive the signed representation when present. Legacy artifacts are handled explicitly rather than silently upgraded.

## Trust versus cryptography

Cryptographic verification establishes authenticity of bytes and metadata. Trust policy decides whether a verified (or explicitly bypassed) artifact may run. Signed verification failure must not become a silent bypass.

## Packaging

Use repository pack scripts (`npm run pack -- <plugin>`) so production packages include the compiled artifact tree required by policy. Missing compiled output must fail closed.

Details of scanners, ignore rules, and allowlists live in Core integrity helpers under `src/core/helpers/integrity` and related loader gates.
