/**
 * Phase 2E — Authenticated security context attached after real verification.
 * Authoritative for trusted artifacts; weaker for legacy/bypass.
 */

import type { TrustOutcome as PipelineTrustOutcome } from './verificationPipeline.js';
import type { ExecutionAuthorization } from './verificationPipeline.js';
import type { SignedLogicalPayload } from './signedPayload.js';
import type { MetadataAuthority } from './canonicalMetadata.js';

export type ArtifactSecurityProfile =
    | 'v2-authenticated'
    | 'legacy-signed'
    | 'bypassed-unsigned';

export interface AuthenticatedPluginContext {
    readonly pluginId: string;
    readonly profile: ArtifactSecurityProfile;
    readonly authority: MetadataAuthority;
    readonly signerFingerprint?: string;
    readonly trustOutcome: PipelineTrustOutcome | 'untrusted';
    readonly authorization: ExecutionAuthorization;
    readonly minimumIsolation?: 'in-process' | 'worker' | 'process' | 'container' | 'external';
    readonly requiredCapabilities: readonly string[];
    readonly providerDeclarations: readonly {
        readonly category: string;
        readonly id: string;
        readonly priority: number;
        readonly capabilities: readonly string[];
    }[];
    readonly dependencyLock?: {
        readonly packageManager: 'npm' | 'bun' | 'none';
        readonly lockfileName?: string;
        readonly lockfileDigest?: string;
        readonly dependencies: Readonly<Record<string, string>>;
    };
    readonly integrityRootDigest?: string;
    /** Full v2 payload when available (trusted path). */
    readonly signedPayload?: SignedLogicalPayload;
}

const contexts = new Map<string, AuthenticatedPluginContext>();

export function setAuthenticatedPluginContext(
    pluginId: string,
    ctx: AuthenticatedPluginContext,
): void {
    contexts.set(pluginId, ctx);
}

export function getAuthenticatedPluginContext(
    pluginId: string,
): AuthenticatedPluginContext | undefined {
    return contexts.get(pluginId);
}

export function clearAuthenticatedPluginContext(pluginId: string): void {
    contexts.delete(pluginId);
}

export function assertExecutionAuthorized(pluginId: string): void {
    const ctx = contexts.get(pluginId);
    if (!ctx) {
        throw new Error(
            `No authenticated security context for plugin '${pluginId}'; cannot execute.`,
        );
    }
    if (ctx.authorization !== 'allowed') {
        throw new Error(
            `Execution denied for plugin '${pluginId}': trust=${ctx.trustOutcome}`,
        );
    }
}

/** Bypassed plugins cannot hold privileged security authority. */
export function assertNotPrivilegedWhenBypassed(
    pluginId: string,
    operation: string,
): void {
    const ctx = contexts.get(pluginId);
    if (!ctx) return;
    if (
        ctx.trustOutcome === 'bypassed' ||
        ctx.trustOutcome === 'unknown-signer' ||
        ctx.trustOutcome === 'untrusted'
    ) {
        if (
            operation === 'weaken-runtime' ||
            operation === 'mutate-core' ||
            operation === 'alter-trust' ||
            operation === 'privileged-provider'
        ) {
            throw new Error(
                `Bypassed/untrusted plugin '${pluginId}' cannot perform '${operation}'.`,
            );
        }
    }
}
