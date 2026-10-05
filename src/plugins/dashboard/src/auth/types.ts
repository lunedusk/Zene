






import type { IdentityProviderId, IdentityRef, CanonicalUser } from '#core/types/identity.js';


export interface AuthSessionSnapshot {
    readonly sessionId: string;
    readonly userId: string;
    readonly expiresAt: number;
    readonly createdAt?: number;
    readonly provider?: IdentityProviderId | 'better_auth';
    readonly revoked?: boolean;
}

export interface AuthUserSnapshot {
    readonly id: string;
    readonly email?: string | null;
    readonly name?: string | null;
    readonly image?: string | null;
    readonly emailVerified?: boolean;
}





export interface BridgedAuthIdentity {
    readonly authUserId: string;
    readonly session: AuthSessionSnapshot;
    readonly identities: readonly IdentityRef[];

    readonly authorizationSubject: string;
    readonly canonical?: CanonicalUser;
}

export type AuthBridgeFailure =
    | { readonly kind: 'unauthenticated'; readonly reason: string }
    | { readonly kind: 'revoked'; readonly reason: string }
    | { readonly kind: 'expired'; readonly reason: string }
    | { readonly kind: 'no_authorization_subject'; readonly reason: string };
