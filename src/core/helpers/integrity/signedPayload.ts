/**
 * Phase 2E — Versioned signed logical payload (JCS-canonicalized).
 * Verification-context fields are NEVER part of the signed payload.
 */

import { createHash } from 'node:crypto';
import { CANONICALIZATION_VERSION, canonicalizeJcs } from './jcs.js';

export const METADATA_SCHEMA_VERSION = 2 as const;

/** Provider authority declared in signed metadata. */
export interface SignedProviderDeclaration {
    readonly category: string;
    readonly id: string;
    readonly priority: number;
    readonly capabilities: readonly string[];
    readonly contractVersion?: string;
}

/** Integrity tree binding — signed with the metadata. */
export interface SignedIntegrityBinding {
    readonly algorithm: 'blake3' | 'sha256';
    readonly rootDigest: string;
    /** Ordered relative paths → content digests. */
    readonly files: readonly { readonly path: string; readonly digest: string; readonly size: number }[];
}

/** Authenticated runtime security floor. */
export interface SignedRuntimeRequirements {
    readonly minimumIsolation: 'in-process' | 'worker' | 'process' | 'container' | 'external';
    readonly requiredCapabilities: readonly string[];
    readonly allowedRuntimes?: readonly string[];
}

/** Dependency lock binding. */
export interface SignedDependencyLock {
    readonly packageManager: 'npm' | 'bun' | 'none';
    readonly lockfileName?: string;
    readonly lockfileDigest?: string;
    readonly dependencies: Readonly<Record<string, string>>;
}

/**
 * Logical signed payload — plugin-authored claims only.
 * NO: authority, trust, bypass, verification results, priorityAuthenticated.
 */
export interface SignedLogicalPayload {
    readonly canonicalizationVersion: typeof CANONICALIZATION_VERSION;
    readonly metadataVersion: typeof METADATA_SCHEMA_VERSION;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly author?: string;
    readonly dependencies: readonly string[];
    readonly zene_version?: string;
    readonly node_version?: string;
    readonly priority: number;
    readonly ignoreHash: readonly string[];
    readonly providers: readonly SignedProviderDeclaration[];
    readonly runtimeRequirements: SignedRuntimeRequirements;
    readonly integrity: SignedIntegrityBinding;
    readonly dependencyLock: SignedDependencyLock;
}

export function buildSignedLogicalPayload(
    partial: Omit<SignedLogicalPayload, 'canonicalizationVersion' | 'metadataVersion'> & {
        canonicalizationVersion?: number;
        metadataVersion?: number;
    },
): SignedLogicalPayload {
    return {
        canonicalizationVersion: CANONICALIZATION_VERSION,
        metadataVersion: METADATA_SCHEMA_VERSION,
        id: partial.id,
        name: partial.name,
        version: partial.version,
        description: partial.description,
        author: partial.author,
        dependencies: [...partial.dependencies].sort(),
        zene_version: partial.zene_version,
        node_version: partial.node_version,
        priority: partial.priority,
        ignoreHash: [...partial.ignoreHash].sort(),
        providers: [...partial.providers].sort((a, b) =>
            a.category === b.category
                ? a.id.localeCompare(b.id)
                : a.category.localeCompare(b.category),
        ),
        runtimeRequirements: {
            minimumIsolation: partial.runtimeRequirements.minimumIsolation,
            requiredCapabilities: [...partial.runtimeRequirements.requiredCapabilities].sort(),
            allowedRuntimes: partial.runtimeRequirements.allowedRuntimes
                ? [...partial.runtimeRequirements.allowedRuntimes].sort()
                : undefined,
        },
        integrity: {
            algorithm: partial.integrity.algorithm,
            rootDigest: partial.integrity.rootDigest,
            files: [...partial.integrity.files].sort((a, b) => a.path.localeCompare(b.path)),
        },
        dependencyLock: {
            packageManager: partial.dependencyLock.packageManager,
            lockfileName: partial.dependencyLock.lockfileName,
            lockfileDigest: partial.dependencyLock.lockfileDigest,
            dependencies: Object.fromEntries(
                Object.entries(partial.dependencyLock.dependencies).sort(([a], [b]) =>
                    a.localeCompare(b),
                ),
            ),
        },
    };
}

/** JCS bytes of the signed logical payload. */
export function canonicalizeSignedPayload(payload: SignedLogicalPayload): string {
    return canonicalizeJcs(payload);
}

export function digestSignedPayload(payload: SignedLogicalPayload): string {
    const canonical = canonicalizeSignedPayload(payload);
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Derive stable signer identity from verified public key PEM/bytes. */
export function deriveSignerFingerprint(publicKeyPemOrBytes: string | Uint8Array): string {
    const buf =
        typeof publicKeyPemOrBytes === 'string'
            ? Buffer.from(publicKeyPemOrBytes, 'utf8')
            : Buffer.from(publicKeyPemOrBytes);
    return createHash('sha256').update(buf).digest('hex');
}
