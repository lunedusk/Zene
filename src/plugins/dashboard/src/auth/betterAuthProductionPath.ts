/**
 * Phase 4 — Production Better Auth enable path (safe defaults).
 * Does not enable without validated secret + native SQL driver for dashboard backend.
 */

import { createBetterAuthServer, type BetterAuthServerHandle } from './betterAuthServer.js';
import {
    DEFAULT_SESSION_POLICY,
    type BetterAuthBoundaryConfig,
} from './betterAuthBoundary.js';
import { ensureBetterAuthSchema } from './betterAuthSchema.js';
import { resolveBetterAuthNativeDatabase } from './betterAuthDatabase.js';
import { registerBetterAuthSessionResolver } from './sessionResolver.js';

export type ProductionBaEnableResult =
    | { ok: true; handle: BetterAuthServerHandle }
    | {
          ok: false;
          reason:
              | 'MISSING_SECRET'
              | 'SECRET_TOO_SHORT'
              | 'SCHEMA_FAILED'
              | 'ADAPTER_FAILED'
              | 'INIT_FAILED';
          message: string;
      };

const MIN_SECRET_LEN = 32;

/**
 * Enable Better Auth only when configuration is production-safe.
 * Never logs the secret.
 */
export async function enableBetterAuthProduction(input: {
    readonly secret: string | undefined;
    readonly baseURL: string;
    readonly trustedOrigins?: readonly string[];
    readonly discord?: BetterAuthBoundaryConfig['discord'];
}): Promise<ProductionBaEnableResult> {
    if (!input.secret || input.secret.trim().length === 0) {
        return { ok: false, reason: 'MISSING_SECRET', message: 'Better Auth secret is required' };
    }
    if (input.secret.trim().length < MIN_SECRET_LEN) {
        return {
            ok: false,
            reason: 'SECRET_TOO_SHORT',
            message: `Better Auth secret must be at least ${MIN_SECRET_LEN} characters`,
        };
    }

    let database: unknown;
    try {
        const native = await resolveBetterAuthNativeDatabase();
        database = native.handle;
    } catch (e) {
        return {
            ok: false,
            reason: 'ADAPTER_FAILED',
            message: e instanceof Error ? e.message : 'adapter_failed',
        };
    }

    const schema = await ensureBetterAuthSchema();
    if (!schema.ok) {
        return {
            ok: false,
            reason: 'SCHEMA_FAILED',
            message: schema.message,
        };
    }

    const config: BetterAuthBoundaryConfig = {
        baseURL: input.baseURL,
        secret: input.secret.trim(),
        trustedOrigins: [...(input.trustedOrigins ?? [])],
        discord: input.discord,
        session: { ...DEFAULT_SESSION_POLICY },
    };

    const init = await createBetterAuthServer({ config, database });
    if (!init.ok) {
        return {
            ok: false,
            reason: 'INIT_FAILED',
            message: `${init.reason}: ${init.message}`,
        };
    }

    registerBetterAuthSessionResolver(async (req) => init.handle.getSession(req));
    return { ok: true, handle: init.handle };
}
