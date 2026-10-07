/**
 * Runtime selection with semantic capability enforcement.
 * Isolation rank is a coarse floor; requiredCapabilities are evaluated individually.
 */

import {
    ISOLATION_RANK,
    RUNTIME_CAPABILITY_MATRIX,
    type IsolationLevel,
    type RuntimePolicy,
    type RuntimeSelectionResult,
} from './types.js';
import { isLevelAvailable, type RuntimeAvailability } from './availability.js';

const CAPABILITY_FIELDS = [
    'executionIsolation',
    'memorySpaceIsolation',
    'failureIsolation',
    'filesystemIsolation',
    'networkIsolation',
    'disposableContext',
] as const;

export type KnownCapabilityId = (typeof CAPABILITY_FIELDS)[number];

function rank(level: IsolationLevel): number {
    return ISOLATION_RANK[level];
}

function isIsolationLevel(s: string): s is IsolationLevel {
    return s in ISOLATION_RANK;
}

/**
 * Evaluate whether a backend satisfies every required capability identifier.
 * Unknown capability names → reject.
 */
export function capabilitiesSatisfied(
    level: IsolationLevel,
    requiredCapabilities: readonly string[],
): { ok: true } | { ok: false; reason: string } {
    if (requiredCapabilities.length === 0) return { ok: true };
    const matrix = RUNTIME_CAPABILITY_MATRIX[level];
    for (const cap of requiredCapabilities) {
        if (!(CAPABILITY_FIELDS as readonly string[]).includes(cap)) {
            return { ok: false, reason: `Unknown security capability '${cap}'` };
        }
        const field = cap as KnownCapabilityId;
        if (matrix[field] !== true) {
            return {
                ok: false,
                reason: `Runtime '${level}' does not provide capability '${cap}'`,
            };
        }
    }
    return { ok: true };
}

/**
 * Build candidate order: preferred first, then other allowed ≥ minimum by ascending rank.
 */
export function buildCandidateOrder(policy: RuntimePolicy): IsolationLevel[] {
    const minRank = rank(policy.minimum);
    const allowed = policy.allowed.filter((l) => rank(l) >= minRank);
    const rest = allowed
        .filter((l) => l !== policy.preferred)
        .sort((a, b) => rank(a) - rank(b));
    const out: IsolationLevel[] = [];
    if (allowed.includes(policy.preferred)) out.push(policy.preferred);
    out.push(...rest);
    return out;
}

export interface SelectRuntimeOptions {
    readonly requiredCapabilities?: readonly string[];
    /** When present from signed metadata — hard allowlist of isolation levels. */
    readonly allowedRuntimes?: readonly string[];
}

export function selectRuntime(
    policy: RuntimePolicy,
    availability: RuntimeAvailability,
    options: SelectRuntimeOptions = {},
): RuntimeSelectionResult {
    const required = options.requiredCapabilities ?? [];
    const signedAllowed = options.allowedRuntimes;

    // Merge signed allowedRuntimes into effective allowed set when present
    let effectiveAllowed = [...policy.allowed];
    if (signedAllowed && signedAllowed.length > 0) {
        const signedLevels: IsolationLevel[] = [];
        for (const s of signedAllowed) {
            if (!isIsolationLevel(s)) {
                return {
                    ok: false,
                    code: 'rejected_policy',
                    message: `Unknown allowedRuntime '${s}' in authenticated metadata.`,
                    attempted: [],
                };
            }
            signedLevels.push(s);
        }
        effectiveAllowed = effectiveAllowed.filter((l) => signedLevels.includes(l));
        if (effectiveAllowed.length === 0) {
            return {
                ok: false,
                code: 'rejected_policy',
                message:
                    'No overlap between operator-allowed runtimes and authenticated allowedRuntimes.',
                attempted: [],
            };
        }
    }

    const effectivePolicy: RuntimePolicy = {
        preferred: policy.preferred,
        minimum: policy.minimum,
        allowed: effectiveAllowed,
        allowFallback: policy.allowFallback,
    };

    // Preferred must still meet minimum rank
    if (rank(effectivePolicy.preferred) < rank(effectivePolicy.minimum)) {
        return {
            ok: false,
            code: 'rejected_policy',
            message: `Preferred '${effectivePolicy.preferred}' is below minimum '${effectivePolicy.minimum}'.`,
            attempted: [],
        };
    }

    const candidates = buildCandidateOrder(effectivePolicy);
    if (candidates.length === 0) {
        return {
            ok: false,
            code: 'rejected_policy',
            message: `No allowed runtimes meet minimum isolation '${effectivePolicy.minimum}'.`,
            attempted: [],
        };
    }

    const attempted: IsolationLevel[] = [];

    for (const level of candidates) {
        attempted.push(level);
        if (!isLevelAvailable(level, availability)) continue;
        if (rank(level) < rank(effectivePolicy.minimum)) continue;

        const caps = capabilitiesSatisfied(level, required);
        if (!caps.ok) {
            // Capability miss is a hard reject for this candidate; continue to next
            continue;
        }

        if (level === effectivePolicy.preferred) {
            return {
                ok: true,
                level,
                code: 'selected',
                message: `Selected preferred runtime '${level}'.`,
            };
        }
        if (!effectivePolicy.allowFallback) {
            return {
                ok: false,
                code: 'rejected_none_available',
                message: `Preferred runtime '${effectivePolicy.preferred}' unavailable/ineligible and fallback is disabled.`,
                attempted,
            };
        }
        return {
            ok: true,
            level,
            code: 'preferred_unavailable_fallback',
            message: `Preferred '${effectivePolicy.preferred}' unavailable; fell back to '${level}' (≥ minimum '${effectivePolicy.minimum}').`,
        };
    }

    // If any candidate failed only on unknown capability, surface that
    for (const level of candidates) {
        const caps = capabilitiesSatisfied(level, required);
        if (!caps.ok && caps.reason.startsWith('Unknown')) {
            return {
                ok: false,
                code: 'rejected_policy',
                message: caps.reason,
                attempted,
            };
        }
    }

    return {
        ok: false,
        code: 'rejected_none_available',
        message: `No available runtime satisfies isolation floor and required capabilities [${required.join(', ')}].`,
        attempted,
    };
}
