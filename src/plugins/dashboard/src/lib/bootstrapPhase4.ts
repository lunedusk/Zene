



import { redisDB } from '#core/database/redis.js';
import { ensureBetterAuthSchema, setAuthCutoverPhase, getAuthCutoverPhase } from '../auth/betterAuthSchema.js';
import { setDistributedRateLimitRedis } from './rateLimit/distributedStore.js';
import { createBetterAuthServer } from '../auth/betterAuthServer.js';
import { DEFAULT_SESSION_POLICY, type BetterAuthBoundaryConfig } from '../auth/betterAuthBoundary.js';
import { ensureDashboardAdapter } from '../../../dash-data/src/lib/store.js';
import { registerBuiltinDashboardProviders } from './dataRightsProviders.js';
import { ensureScheduledPublishHandlerRegistered } from './scheduledPublishHandler.js';

export interface Phase4BootstrapResult {
    readonly schema: { ok: boolean; message?: string };
    readonly rateLimitRedis: boolean;
    readonly betterAuth: { ok: boolean; message?: string };
    readonly cutoverPhase: number;
}




export function wireRateLimitRedisFromRegistry(): boolean {
    for (const alias of ['crosshost', 'main', 'default']) {
        const clients = redisDB.tryGet(alias);
        if (clients?.main) {
            setDistributedRateLimitRedis({
                incr: (key) => clients.main.incr(key),
                pexpire: (key, ms) => clients.main.pexpire(key, ms),
                pttl: (key) => clients.main.pttl(key),
            });
            return true;
        }
    }
    setDistributedRateLimitRedis(null);
    return false;
}


export function rewireRateLimitRedis(): boolean {
    return wireRateLimitRedisFromRegistry();
}

export async function bootstrapPhase4(options?: {
    betterAuth?: Partial<BetterAuthBoundaryConfig> & { enabled?: boolean };
    cutoverPhase?: 2 | 3 | 4;
}): Promise<Phase4BootstrapResult> {
    if (options?.cutoverPhase) {
        setAuthCutoverPhase(options.cutoverPhase);
    }

    const schemaResult = await ensureBetterAuthSchema();
    const rateLimitRedis = wireRateLimitRedisFromRegistry();

    registerBuiltinDashboardProviders();
    ensureScheduledPublishHandlerRegistered();

    let betterAuth: Phase4BootstrapResult['betterAuth'] = {
        ok: false,
        message: 'not_requested',
    };

    if (options?.betterAuth?.enabled) {
        try {
            const adapter = await ensureDashboardAdapter();
            const config: BetterAuthBoundaryConfig = {
                baseURL: options.betterAuth.baseURL ?? 'http://localhost:3000',
                secret: options.betterAuth.secret ?? '',
                trustedOrigins: options.betterAuth.trustedOrigins ?? ['http://localhost:5173'],
                discord: options.betterAuth.discord,
                session: options.betterAuth.session ?? { ...DEFAULT_SESSION_POLICY },
            };
            const init = await createBetterAuthServer({
                config,
                database: adapter,
            });
            if (init.ok) {
                betterAuth = { ok: true, message: 'initialized' };

                (globalThis as { __zeneBetterAuthHandle?: typeof init.handle }).__zeneBetterAuthHandle =
                    init.handle;
            } else {
                betterAuth = { ok: false, message: `${init.reason}: ${init.message}` };
            }
        } catch (e) {
            betterAuth = {
                ok: false,
                message: e instanceof Error ? e.message : 'better_auth_init_failed',
            };
        }
    }

    return {
        schema: schemaResult.ok
            ? { ok: true }
            : { ok: false, message: schemaResult.ok === false ? schemaResult.message : 'schema_failed' },
        rateLimitRedis,
        betterAuth,
        cutoverPhase: getAuthCutoverPhase(),
    };
}
