/**
 * Phase 2D — Detect which isolation backends are usable in this process/deployment.
 * Does not start Docker/Pterodactyl; only probes capability flags.
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
 * Probe availability without side effects beyond optional module load attempts.
 */
export function probeRuntimeAvailability(
    env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
    let worker = false;
    try {
        // Presence of worker_threads is enough; actual Worker created later.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- static probe only
        void import('node:worker_threads');
        worker = true;
    } catch {
        worker = false;
    }
    // Dynamic import returns a promise — treat worker as available on Node platforms.
    worker = typeof process !== 'undefined' && !!process.versions?.node;

    let childProcess = false;
    try {
        childProcess = typeof process !== 'undefined' && !!process.versions?.node;
    } catch {
        childProcess = false;
    }

    const dockerExplicit = (env.ZENE_DOCKER_RUNTIME ?? '').toLowerCase();
    const container =
        dockerExplicit === '1' ||
        dockerExplicit === 'true' ||
        dockerExplicit === 'yes' ||
        (env.ZENE_CONTAINER_RUNTIME ?? '').trim() !== '';

    const external =
        (env.ZENE_EXTERNAL_RUNTIME ?? '').trim() !== '' ||
        (env.PTERODACTYL_URL ?? '').trim() !== '';

    return {
        'in-process': true,
        worker,
        process: childProcess,
        container,
        external,
    };
}

export function isLevelAvailable(
    level: IsolationLevel,
    availability: RuntimeAvailability,
): boolean {
    return availability[level] === true;
}
