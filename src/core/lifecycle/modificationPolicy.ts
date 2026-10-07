/**
 * Phase 2B — Modification policy (extension / replacement / physical mutation).
 *
 * Physical source mutation is denied by default and, when it occurs, invalidates
 * the prior integrity/trust decision. Runtime extension/replacement go through
 * contracts (providers, registries) without touching signed files.
 */

import {
    DEFAULT_MODIFICATION_POLICY,
    type ArtifactIntegrityState,
    type ModificationPolicy,
} from './types.js';

/** Canonical default lives in types.ts; re-exported for the public policy module surface. */
export { DEFAULT_MODIFICATION_POLICY };

const policyByPlugin = new Map<string, ModificationPolicy>();
const integrityByPlugin = new Map<string, ArtifactIntegrityState>();

export function getModificationPolicy(pluginId: string): ModificationPolicy {
    return policyByPlugin.get(pluginId) ?? DEFAULT_MODIFICATION_POLICY;
}

/** Override policy for a plugin (runtime; not claimed as signed metadata). */
export function setModificationPolicy(
    pluginId: string,
    policy: Partial<ModificationPolicy>,
): ModificationPolicy {
    const base = getModificationPolicy(pluginId);
    const next: ModificationPolicy = {
        extensionAllowed: policy.extensionAllowed ?? base.extensionAllowed,
        replacementAllowed: policy.replacementAllowed ?? base.replacementAllowed,
        sourceMutationAllowed:
            policy.sourceMutationAllowed ?? base.sourceMutationAllowed,
        sensitivePathMutationAllowed:
            policy.sensitivePathMutationAllowed ?? base.sensitivePathMutationAllowed,
    };
    policyByPlugin.set(pluginId, next);
    return next;
}

export function clearModificationPolicy(pluginId: string): void {
    policyByPlugin.delete(pluginId);
}

export function getArtifactIntegrityState(pluginId: string): ArtifactIntegrityState {
    return integrityByPlugin.get(pluginId) ?? 'unknown';
}

export function markArtifactVerified(pluginId: string): void {
    integrityByPlugin.set(pluginId, 'valid');
}

export function markArtifactVerificationFailed(pluginId: string): void {
    integrityByPlugin.set(pluginId, 'failed-verification');
}

/**
 * Record that files under a signed plugin tree were mutated.
 * Does not re-sign. Prior signature must not be treated as authority.
 */
export function recordPhysicalSourceMutation(
    pluginId: string,
    pathRelative: string,
): { allowed: boolean; integrityState: ArtifactIntegrityState; reason: string } {
    const policy = getModificationPolicy(pluginId);
    const sensitive =
        /(^|\/)manifest\.(json|nvx)$/i.test(pathRelative) ||
        /(^|\/)index\.(js|ts|mjs)$/i.test(pathRelative);

    if (sensitive && !policy.sensitivePathMutationAllowed) {
        integrityByPlugin.set(pluginId, 'invalidated-by-mutation');
        return {
            allowed: false,
            integrityState: 'invalidated-by-mutation',
            reason:
                `Sensitive path mutation denied for '${pluginId}' (${pathRelative}). ` +
                `Integrity invalidated; re-pack and re-trust required.`,
        };
    }

    if (!policy.sourceMutationAllowed) {
        integrityByPlugin.set(pluginId, 'invalidated-by-mutation');
        return {
            allowed: false,
            integrityState: 'invalidated-by-mutation',
            reason:
                `Source mutation denied by default for '${pluginId}' (${pathRelative}). ` +
                `Integrity invalidated; re-pack and re-trust required.`,
        };
    }

    // Explicitly allowed — still invalidates prior signature (new pack required).
    integrityByPlugin.set(pluginId, 'invalidated-by-mutation');
    return {
        allowed: true,
        integrityState: 'invalidated-by-mutation',
        reason:
            `Source mutation permitted for '${pluginId}' but prior signature is no longer authoritative. ` +
            `Re-pack to establish a new integrity/trust decision.`,
    };
}

export function assertRuntimeExtensionAllowed(pluginId: string): void {
    if (!getModificationPolicy(pluginId).extensionAllowed) {
        throw new Error(`Runtime extension denied for plugin '${pluginId}'.`);
    }
}

export function assertRuntimeReplacementAllowed(pluginId: string): void {
    if (!getModificationPolicy(pluginId).replacementAllowed) {
        throw new Error(`Runtime replacement denied for plugin '${pluginId}'.`);
    }
}
