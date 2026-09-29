/**
 * Phase 2B — Canonical identity + session foundation (types + contracts).
 * Discord remains compatible primary subject until full migration.
 */

export type IdentityProviderKind =
    | 'discord'
    | 'oidc'
    | 'saml'
    | 'email'
    | 'passkey'
    | 'security_key'
    | 'password';

export interface IdentityRecord {
    readonly id: string;
    readonly userId: string;
    readonly provider: IdentityProviderKind;
    readonly providerSubject: string;
    readonly metadata?: Record<string, unknown>;
    readonly createdAt: number;
    readonly linkedAt: number;
}

export interface CanonicalUserRecord {
    readonly id: string;
    readonly primaryDiscordSubject?: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface SessionRecord {
    readonly sessionId: string;
    readonly userId: string;
    readonly identityId?: string;
    readonly provider?: IdentityProviderKind;
    readonly createdAt: number;
    readonly lastSeenAt: number;
    readonly expiresAt: number;
    readonly revokedAt?: number;
    readonly deviceLabel?: string;
    readonly ipHash?: string;
    readonly userAgentHash?: string;
    readonly authMethod?: string;
    /** Elevated auth until this epoch ms; not a permission grant. */
    readonly sudoUntil?: number;
}

export interface IdentityProviderConfig {
    readonly provider: IdentityProviderKind;
    readonly enabled: boolean;
    /** SecretManager references — never plaintext secrets in API responses. */
    readonly secretRefs?: Record<string, string>;
    readonly publicConfig?: Record<string, unknown>;
}

export function isSessionActive(s: SessionRecord, now = Date.now()): boolean {
    if (s.revokedAt && s.revokedAt <= now) return false;
    if (s.expiresAt <= now) return false;
    return true;
}

export function isSudoValid(s: SessionRecord, now = Date.now()): boolean {
    return typeof s.sudoUntil === 'number' && s.sudoUntil > now;
}
