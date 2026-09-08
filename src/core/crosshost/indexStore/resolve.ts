import type { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';
import type { CrossHostEnv } from '../types.js';
import { createRedisIndex } from './redisIndex.js';
import type { IndexResolveResult } from './types.js';

const log = getLogger('CrossHost:IndexResolve');

/**
 * Cross-Host secondary index is Redis-only.
 * Postgres index backend was removed; audit/error bodies live on shared Surreal under CH.
 */
export async function resolveIndexBackend(
    env: CrossHostEnv,
    redis: Redis,
    channelPrefix: string,
): Promise<IndexResolveResult> {
    if (!env.indexEnabled) {
        return { enabled: false, reason: 'CROSS_HOST_INDEX_ENABLED=false' };
    }

    if (env.indexBackend !== 'redis') {
        log.warn(
            `CROSS_HOST_INDEX_BACKEND=${env.indexBackend} is no longer supported; only redis is available. Falling back to redis.`,
        );
    }

    log.info('Index backend: redis');
    return { enabled: true, backend: createRedisIndex(redis, channelPrefix) };
}
