/**
 * Phase 2E — Operator config may tighten but never weaken authenticated floors.
 */

import type { IsolationLevel } from '#core/runtime/types.js';
import { ISOLATION_RANK } from '#core/runtime/types.js';

export interface AuthenticatedSecurityFloor {
    readonly minimumIsolation: IsolationLevel;
    readonly requiredCapabilities: readonly string[];
}

export interface OperatorRuntimePreference {
    readonly preferred?: IsolationLevel;
    readonly minimum?: IsolationLevel;
    readonly allowed?: readonly IsolationLevel[];
}

export interface EffectiveRuntimeConstraints {
    readonly minimumIsolation: IsolationLevel;
    readonly preferred: IsolationLevel;
    readonly allowed: readonly IsolationLevel[];
    readonly requiredCapabilities: readonly string[];
}

/**
 * Merge authenticated plugin floor with operator preference.
 * Operator may raise the floor, never lower it.
 */
export function mergeSecurityFloor(
    floor: AuthenticatedSecurityFloor,
    operator: OperatorRuntimePreference,
): EffectiveRuntimeConstraints {
    const floorRank = ISOLATION_RANK[floor.minimumIsolation];
    let minimum = floor.minimumIsolation;
    if (operator.minimum !== undefined) {
        if (ISOLATION_RANK[operator.minimum] >= floorRank) {
            minimum = operator.minimum;
        }
        // else: ignore weaker operator minimum
    }

    let preferred = operator.preferred ?? minimum;
    if (ISOLATION_RANK[preferred] < ISOLATION_RANK[minimum]) {
        preferred = minimum;
    }

    let allowed: IsolationLevel[] = operator.allowed
        ? [...operator.allowed]
        : [minimum, preferred];
    allowed = allowed.filter((l) => ISOLATION_RANK[l] >= ISOLATION_RANK[minimum]);
    if (allowed.length === 0) {
        allowed = [minimum];
    }
    if (!allowed.includes(preferred)) {
        allowed = [...allowed, preferred];
    }

    return {
        minimumIsolation: minimum,
        preferred,
        allowed,
        requiredCapabilities: [...floor.requiredCapabilities],
    };
}

/**
 * Reject if operator attempt would weaken authenticated floor.
 */
export function wouldWeakenFloor(
    floor: AuthenticatedSecurityFloor,
    attemptedMinimum: IsolationLevel,
): boolean {
    return ISOLATION_RANK[attemptedMinimum] < ISOLATION_RANK[floor.minimumIsolation];
}
