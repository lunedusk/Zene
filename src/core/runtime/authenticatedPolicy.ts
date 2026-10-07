/**
 * Phase 2E — Authenticated runtime requirements vs operator preference.
 *
 * Operator may strengthen isolation; explicit weakening of an authenticated
 * floor is a hard rejection (not a silent upgrade).
 */

import type { IsolationLevel, RuntimePolicy } from './types.js';
import { ISOLATION_RANK } from './types.js';
import {
    mergeSecurityFloor,
    type AuthenticatedSecurityFloor,
    type OperatorRuntimePreference,
} from '#core/config/securityFloor.js';
import { selectRuntime } from './selector.js';
import { probeRuntimeAvailability } from './availability.js';
import type { RuntimeSelectionResult } from './types.js';

const floors = new Map<string, AuthenticatedSecurityFloor>();

export class RuntimeFloorViolationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuntimeFloorViolationError';
    }
}

export function setAuthenticatedRuntimeFloor(
    pluginId: string,
    floor: AuthenticatedSecurityFloor,
): void {
    floors.set(pluginId, {
        minimumIsolation: floor.minimumIsolation,
        requiredCapabilities: [...floor.requiredCapabilities],
    });
}

export function getAuthenticatedRuntimeFloor(
    pluginId: string,
): AuthenticatedSecurityFloor | undefined {
    return floors.get(pluginId);
}

/**
 * Restricted: cannot clear an active authenticated floor.
 * Ordinary operator/runtime code must not drop a signed isolation requirement.
 * Only allowed when the floor was never set (no-op) — active floors are immutable
 * for the process lifetime of the authorization.
 */
export function clearAuthenticatedRuntimeFloor(pluginId: string): void {
    if (floors.has(pluginId)) {
        throw new RuntimeFloorViolationError(
            `Refusing to clear authenticated runtime floor for '${pluginId}' while authorization is active.`,
        );
    }
}

/** Test-only: force-remove floor after plugin context is fully torn down. */
export function __testOnly_clearAuthenticatedRuntimeFloor(pluginId: string): void {
    floors.delete(pluginId);
}

/**
 * Build effective RuntimePolicy: authenticated floor + operator preference.
 * When an authenticated floor exists, operator must not request a weaker preferred/minimum.
 */
export function effectiveRuntimePolicy(
    pluginId: string,
    operator: OperatorRuntimePreference & { allowFallback?: boolean },
): RuntimePolicy {
    const floor = floors.get(pluginId);

    if (floor) {
        const floorRank = ISOLATION_RANK[floor.minimumIsolation];
        if (
            operator.preferred !== undefined &&
            ISOLATION_RANK[operator.preferred] < floorRank
        ) {
            throw new RuntimeFloorViolationError(
                `Operator preferred runtime '${operator.preferred}' weakens authenticated floor '${floor.minimumIsolation}' for plugin '${pluginId}'.`,
            );
        }
        if (
            operator.minimum !== undefined &&
            ISOLATION_RANK[operator.minimum] < floorRank
        ) {
            throw new RuntimeFloorViolationError(
                `Operator minimum runtime '${operator.minimum}' weakens authenticated floor '${floor.minimumIsolation}' for plugin '${pluginId}'.`,
            );
        }
        if (operator.allowed && operator.allowed.length > 0) {
            const allBelow = operator.allowed.every(
                (l) => ISOLATION_RANK[l] < floorRank,
            );
            if (allBelow) {
                throw new RuntimeFloorViolationError(
                    `Operator allowed runtimes all weaken authenticated floor '${floor.minimumIsolation}' for plugin '${pluginId}'.`,
                );
            }
        }
    }

    // No authenticated floor (legacy/bypass/unsigned): operator preference only.
    if (!floor) {
        const level =
            operator.preferred ??
            operator.minimum ??
            ('process' as IsolationLevel);
        const allowed =
            operator.allowed && operator.allowed.length > 0
                ? [...operator.allowed]
                : [level];
        return {
            preferred: level,
            minimum: operator.minimum ?? level,
            allowed,
            allowFallback: operator.allowFallback ?? false,
        };
    }

    const merged = mergeSecurityFloor(floor, operator);
    return {
        preferred: merged.preferred,
        minimum: merged.minimumIsolation,
        allowed: merged.allowed,
        allowFallback: operator.allowFallback ?? false,
    };
}

export function selectWithAuthenticatedFloor(
    pluginId: string,
    operator: OperatorRuntimePreference & {
        allowFallback?: boolean;
        requiredCapabilities?: readonly string[];
    },
    availability = probeRuntimeAvailability(),
): RuntimeSelectionResult {
    const policy = effectiveRuntimePolicy(pluginId, operator);
    const floor = floors.get(pluginId);
    const caps = new Set([
        ...(floor?.requiredCapabilities ?? []),
        ...(operator.requiredCapabilities ?? []),
    ]);
    void caps;
    return selectRuntime(policy, availability);
}
