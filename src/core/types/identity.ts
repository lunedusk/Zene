/**
 * Canonical identity boundary (Phase 1 types only).
 * No new identity database; Discord subject remains the live authorization subject.
 */

export type IdentityProviderId =
    | 'discord'
    | 'github'
    | 'google'
    | 'x'
    | 'apple'
    | 'microsoft'
    | 'oidc'
    | 'saml'
    | 'password'
    | 'passkey'
    | 'totp'
    | 'security_key';

export interface IdentityRef {
    readonly provider: IdentityProviderId;
    /** Provider-stable subject (e.g. Discord snowflake). */
    readonly subject: string;
}

/**
 * Future canonical user. Phase 1 does not migrate consumers onto this id.
 */
export interface CanonicalUser {
    readonly id: string;
    readonly identities: readonly IdentityRef[];
    readonly primaryDiscordSubject?: string;
    readonly createdAt?: number;
}

/**
 * Map legacy Discord user id to identity boundary without changing storage keys.
 */
export function discordIdentity(discordUserId: string): IdentityRef {
    return { provider: 'discord', subject: discordUserId };
}

/**
 * Until downstream migration, authorization subject remains the Discord id.
 */
export function authorizationSubjectFromDiscord(discordUserId: string): string {
    return discordUserId;
}
