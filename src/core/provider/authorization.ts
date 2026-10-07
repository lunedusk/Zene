/**
 * Phase 2E — Provider authorization is Core policy, not self-declaration.
 *
 * A signed provider declaration means the plugin *intends* to register a provider.
 * Core must still authorize that the verified plugin/signer may control that category.
 */

import { getAuthenticatedPluginContext } from '#core/helpers/integrity/authenticatedContext.js';

/** Categories that are privileged and never available to bypass/legacy without explicit allow. */
export const PRIVILEGED_PROVIDER_CATEGORIES = new Set([
    'dependency.install',
    'core.runtime',
    'core.trust',
    'core.config',
]);

/**
 * Host policy: which plugin IDs may provide which categories.
 * Empty map = only non-privileged categories for trusted v2 plugins that declare them.
 * Operators can extend via setProviderCategoryAllowlist.
 */
const categoryAllowlist = new Map<string, ReadonlySet<string>>();

/**
 * Grant pluginId permission to provide category (host/operator policy).
 */
export function allowProviderCategory(pluginId: string, category: string): void {
    const prev = categoryAllowlist.get(pluginId);
    const next = new Set(prev ?? []);
    next.add(category);
    categoryAllowlist.set(pluginId, next);
}

export function clearProviderCategoryAllowlist(pluginId?: string): void {
    if (pluginId) categoryAllowlist.delete(pluginId);
    else categoryAllowlist.clear();
}

export function isProviderCategoryAuthorized(input: {
    pluginId: string;
    category: string;
}): boolean {
    const ctx = getAuthenticatedPluginContext(input.pluginId);

    // Bypassed / legacy / unknown: never privileged categories
    if (!ctx || ctx.profile !== 'v2-authenticated' || ctx.trustOutcome !== 'trusted') {
        if (PRIVILEGED_PROVIDER_CATEGORIES.has(input.category) || input.category.startsWith('core.')) {
            return false;
        }
        // Non-privileged categories still require v2 declaration path for trusted only
        return false;
    }

    // Trusted v2: privileged categories need explicit host allowlist entry
    if (PRIVILEGED_PROVIDER_CATEGORIES.has(input.category) || input.category.startsWith('core.')) {
        const allowed = categoryAllowlist.get(input.pluginId);
        return allowed?.has(input.category) === true;
    }

    // Non-privileged: allowed for trusted v2 if declared (declaration checked separately)
    return true;
}

/**
 * Full check: declaration present + Core authorization.
 */
export function assertProviderFullyAuthorized(input: {
    pluginId: string;
    category: string;
    id: string;
    priority: number;
}): void {
    const ctx = getAuthenticatedPluginContext(input.pluginId);

    // Privileged categories always require explicit Core allowlist + v2 trust
    if (
        PRIVILEGED_PROVIDER_CATEGORIES.has(input.category) ||
        input.category.startsWith('core.')
    ) {
        if (!ctx || ctx.profile !== 'v2-authenticated' || ctx.trustOutcome !== 'trusted') {
            throw new Error(
                `Privileged provider ${input.category}/${input.id}: plugin '${input.pluginId}' is not v2-trusted.`,
            );
        }
        if (!isProviderCategoryAuthorized({ pluginId: input.pluginId, category: input.category })) {
            throw new Error(
                `Provider category '${input.category}' is not authorized for plugin '${input.pluginId}' by Core policy.`,
            );
        }
    }

    if (!ctx) {
        // No authenticated context: non-privileged only (compat/test); still no self-grant of privilege
        return;
    }

    if (ctx.profile !== 'v2-authenticated' || ctx.trustOutcome !== 'trusted') {
        throw new Error(
            `Provider ${input.category}/${input.id}: plugin '${input.pluginId}' is not v2-trusted; cannot register providers.`,
        );
    }

    // Empty declaration set recorded means "no providers allowed"
    if (ctx.providerDeclarations.length === 0) {
        // Empty authenticated list: deny all registrations for this plugin
        throw new Error(
            `Plugin '${input.pluginId}' has empty authenticated provider set; cannot register ${input.category}/${input.id}.`,
        );
    }

    const decl = ctx.providerDeclarations.find(
        (d) => d.category === input.category && d.id === input.id,
    );
    if (!decl) {
        throw new Error(
            `Provider ${input.category}/${input.id} not declared in authenticated metadata for '${input.pluginId}'.`,
        );
    }
    if (decl.priority !== input.priority) {
        throw new Error(
            `Provider priority mismatch for ${input.category}/${input.id}: signed=${decl.priority} runtime=${input.priority}`,
        );
    }

    if (!isProviderCategoryAuthorized({ pluginId: input.pluginId, category: input.category })) {
        throw new Error(
            `Provider category '${input.category}' is not authorized for plugin '${input.pluginId}' by Core policy.`,
        );
    }
}
