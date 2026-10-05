











export const BETTER_AUTH_TARGET_VERSION = '1.7.6' as const;





export interface BetterAuthBoundaryConfig {
    readonly baseURL: string;
    readonly secret: string;
    readonly trustedOrigins: readonly string[];

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















export const AUTH_MIGRATION_PHASE = 2 as const;
