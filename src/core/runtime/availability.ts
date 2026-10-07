/**
 * Runtime backend availability — "available" means genuinely usable.
 * Container/External stay unavailable until real launch backends exist.
 */

import type { IsolationLevel } from './types.js';

export interface RuntimeAvailability {
    readonly 'in-process': true;
    readonly worker: boolean;
    readonly process: boolean;
    readonly container: boolean;
    readonly external: boolean;
}

/**
 * Probe availability without side effects beyond capability checks.
 * Env flags alone do NOT make container/external available.
 */
export function probeRuntimeAvailability(
    _env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
    const hasNode = typeof process !== 'undefined' && !!process.versions?.node;

    return {
        'in-process': true,
        worker: hasNode,
        process: hasNode,
        // launchContainer still not implemented — never report available
        container: false,
        external: false,
    };
}

export function isLevelAvailable(
    level: IsolationLevel,
    availability: RuntimeAvailability,
): boolean {
    return availability[level] === true;
}
