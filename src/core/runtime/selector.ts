/**
 * Phase 2D — Security-aware runtime selection.
 *
 * Never selects below policy.minimum rank.
 * Fallback only among allowed levels when allowFallback is true.
 */

import { isLevelAvailable, type RuntimeAvailability } from './availability.js';
import {
    ISOLATION_RANK,
    type IsolationLevel,
    type RuntimePolicy,
    type RuntimeSelectionResult,
} from './types.js';

function rank(level: IsolationLevel): number {
    return ISOLATION_RANK[level];
}

/**
 * Candidate order: preferred first, then other allowed levels sorted by rank ascending
 * among those ≥ minimum (prefer closer to preferred when fallback).
 */
export function buildCandidateOrder(policy: RuntimePolicy): IsolationLevel[] {
    const allowed = [...new Set(policy.allowed)];
    if (!allowed.includes(policy.preferred)) {
        allowed.push(policy.preferred);
    }
    const minRank = rank(policy.minimum);
    const viable = allowed.filter((l) => rank(l) >= minRank);
    const rest = viable
        .filter((l) => l !== policy.preferred)
        .sort((a, b) => rank(a) - rank(b));
    if (rank(policy.preferred) >= minRank) {
        return [policy.preferred, ...rest];
    }
    // preferred below minimum is invalid policy — candidates only ≥ minimum
    return rest;
}

export function selectRuntime(
    policy: RuntimePolicy,
    availability: RuntimeAvailability,
): RuntimeSelectionResult {
    if (rank(policy.preferred) < rank(policy.minimum)) {
        return {
            ok: false,
            code: 'rejected_policy',
            message:
                `Invalid policy: preferred '${policy.preferred}' is below minimum '${policy.minimum}'.`,
        };
    }

    const candidates = buildCandidateOrder(policy);
    if (candidates.length === 0) {
        return {
            ok: false,
            code: 'rejected_policy',
            message: `No allowed runtimes meet minimum isolation '${policy.minimum}'.`,
            attempted: [],
        };
    }

    const attempted: IsolationLevel[] = [];
    let firstAvailable: IsolationLevel | null = null;

    for (const level of candidates) {
        attempted.push(level);
        if (!isLevelAvailable(level, availability)) continue;
        if (rank(level) < rank(policy.minimum)) {
            // Should not appear due to buildCandidateOrder, but defend.
            continue;
        }
        if (level === policy.preferred) {
            return {
                ok: true,
                level,
                code: 'selected',
                message: `Selected preferred runtime '${level}'.`,
            };
        }
        if (!policy.allowFallback) {
            return {
                ok: false,
                code: 'rejected_none_available',
                message:
                    `Preferred runtime '${policy.preferred}' unavailable and fallback is disabled.`,
                attempted,
            };
        }
        firstAvailable = level;
        break;
    }

    if (firstAvailable) {
        return {
            ok: true,
            level: firstAvailable,
            code: 'preferred_unavailable_fallback',
            message:
                `Preferred '${policy.preferred}' unavailable; fell back to '${firstAvailable}' (still ≥ minimum '${policy.minimum}').`,
        };
    }

    // Check if anything was available but all below minimum (security reject)
    const anyWeakerAvailable = (
        ['in-process', 'worker', 'process', 'container', 'external'] as IsolationLevel[]
    ).some(
        (l) =>
            isLevelAvailable(l, availability) &&
            rank(l) < rank(policy.minimum) &&
            policy.allowed.includes(l),
    );

    if (anyWeakerAvailable) {
        return {
            ok: false,
            code: 'rejected_below_minimum',
            message:
                `No available runtime meets minimum isolation '${policy.minimum}'. ` +
                `Weaker runtimes must not be used (security downgrade denied).`,
            attempted,
        };
    }

    return {
        ok: false,
        code: 'rejected_none_available',
        message: `No available runtime among candidates for policy (preferred=${policy.preferred}, minimum=${policy.minimum}).`,
        attempted,
    };
}
