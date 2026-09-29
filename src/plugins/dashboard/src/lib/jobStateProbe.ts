/** Shared job transition map for tests (mirrors JobsService). */
export const ALLOWED_TRANSITIONS_PROBE: Record<string, readonly string[]> = {
    queued: ['running', 'cancelled'],
    running: ['succeeded', 'failed', 'retrying', 'cancelled'],
    retrying: ['running', 'cancelled', 'failed'],
    succeeded: [],
    failed: ['queued'],
    cancelled: [],
};
