/**
 * Phase 2C — Search authorization filter (pure).
 * Index is derived state; authorization is authoritative on every result.
 */

import type { ResolvedPermissions } from '#core/types/permissions.js';

export type SearchResultKind =
    | 'page'
    | 'command'
    | 'plugin'
    | 'doc'
    | 'guild'
    | 'user'
    | 'setting'
    | 'metric'
    | 'audit'
    | 'override'
    | 'surface';

export interface SearchCandidate {
    readonly id: string;
    readonly kind: SearchResultKind;
    readonly title: string;
    readonly snippet?: string;
    readonly guildId?: string;
    readonly pluginId?: string;
    readonly requiredBits?: readonly string[];
    readonly ownerOnly?: boolean;
    readonly hidden?: boolean;
}

export interface SearchActor {
    readonly userId: string;
    readonly isEnvOwner: boolean;
    readonly resolved: ResolvedPermissions;
}

function hasBit(a: SearchActor, bit: string): boolean {
    if (a.isEnvOwner || a.resolved.botOwner || a.resolved.bits.has('bot.owner')) return true;
    return a.resolved.bits.has(bit);
}

/** Per-candidate authorization — omit unauthorized entirely (no visible:false leak). */
export function authorizeSearchCandidate(actor: SearchActor, c: SearchCandidate): boolean {
    if (c.hidden) return false;
    if (c.ownerOnly) {
        return actor.isEnvOwner || actor.resolved.botOwner || actor.resolved.bits.has('bot.owner');
    }
    if (c.kind === 'audit') {
        return hasBit(actor, 'bot.audit.view') || hasBit(actor, 'bot.logs.view');
    }
    if (c.kind === 'metric') {
        return hasBit(actor, 'bot.analytics.view');
    }
    if (c.kind === 'guild') {
        return hasBit(actor, 'bot.servers.view') || hasBit(actor, 'bot.servers.manage');
    }
    if (c.kind === 'plugin' || c.kind === 'surface') {
        return hasBit(actor, 'bot.plugins.view') || hasBit(actor, 'bot.plugins.manage');
    }
    if (c.kind === 'override') {
        return actor.isEnvOwner || actor.resolved.botOwner || actor.resolved.bits.has('bot.owner');
    }
    if (c.requiredBits && c.requiredBits.length > 0) {
        return c.requiredBits.some((b) => hasBit(actor, b));
    }
    // Default: authenticated actor may see generic pages/docs/commands/settings without extra bits
    return true;
}

export function filterSearchResults(
    actor: SearchActor,
    candidates: readonly SearchCandidate[],
): SearchCandidate[] {
    return candidates.filter((c) => authorizeSearchCandidate(actor, c));
}

/** Facet/count must use the same filter — never pre-auth counts. */
export function authorizedCount(actor: SearchActor, candidates: readonly SearchCandidate[]): number {
    return filterSearchResults(actor, candidates).length;
}
