/**
 * Better Auth integration boundary (foundation).
 *
 * This module documents and exposes the intended server configuration surface.
 * Full Better Auth server wiring is gated on:
 * 1. adding `better-auth` dependency at the chosen version;
 * 2. generating schema into the production SQL adapter path;
 * 3. non-destructive migration of existing dash sessions.
 *
 * DO NOT use Better Auth roles as Zene permission substitutes.
 */

export const BETTER_AUTH_TARGET_VERSION = '1.7.6' as const;

/**
 * Conceptual Better Auth configuration — implementation attaches when package is installed.
 * Database must be the existing production SQL path (postgres preferred; no second SQLite app DB).
 */
export interface BetterAuthBoundaryConfig {
    readonly baseURL: string;
    readonly secret: string;
    readonly trustedOrigins: readonly string[];
    /** Discord OAuth via Better Auth social provider when migrated. */
    readonly discord?: {
        readonly clientId: string;
        readonly clientSecret: string;
    };
    readonly session: {
        readonly expiresInSeconds: number;
        readonly updateAgeSeconds: number;
        readonly cookieCacheEnabled: boolean;
    };
}

export const DEFAULT_SESSION_POLICY = {
    expiresInSeconds: 60 * 60 * 24 * 7,
    updateAgeSeconds: 60 * 60 * 24,
    cookieCacheEnabled: false,
} as const;

/**
 * Machine / service / plugin tokens remain Zene TokenManager territory.
 * Dashboard *user* sessions migrate to Better Auth.
 */
export type TokenOwnership =
    | 'better_auth_user_session'
    | 'zene_machine_token'
    | 'zene_plugin_token'
    | 'zene_internal_service_token';

export function classifyTokenPurpose(kind: string): TokenOwnership {
    switch (kind) {
        case 'dash_session':
        case 'user_session':
            return 'better_auth_user_session';
        case 'plugin':
            return 'zene_plugin_token';
        case 'service':
        case 'machine':
            return 'zene_machine_token';
        default:
            return 'zene_internal_service_token';
    }
}

/**
 * Migration phases (non-destructive).
 * Phase 1: introduce boundary + bridge (current).
 * Phase 2: Dashboard routes accept Better Auth session (parallel to legacy).
 * Phase 3: Issue only Better Auth sessions for new logins.
 * Phase 4: Remove legacy dash session issuer after verified cutover.
 */
/**
 * Migration phases (non-destructive).
 * 1 — boundary + bridge only
 * 2 — parallel Better Auth + legacy (Phase 4)
 * 3 — new logins Better Auth only
 * 4 — legacy issuer removed
 */
export const AUTH_MIGRATION_PHASE = 2 as const;
