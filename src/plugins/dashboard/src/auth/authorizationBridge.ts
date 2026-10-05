/**
 * AuthorizationBridge — authentication (Better Auth) → Zene authorization.
 *
 * Never uses Better Auth roles/permissions as Zene authorization substitutes.
 */

import type { ResolvedPermissions } from '#core/types/permissions.js';
import { resolveActorPermissions } from '#core/permissions/capabilities.js';
import { isEnvBotOwner } from '#core/permissions/hierarchy.js';
import type { BridgedAuthIdentity, AuthBridgeFailure, AuthSessionSnapshot } from './types.js';
import type { IdentityRef } from '#core/types/identity.js';
import { discordIdentity } from '#core/types/identity.js';

export interface AuthorizationDecision {
    readonly ok: true;
    readonly actorUserId: string;
    readonly isEnvOwner: boolean;
    readonly resolved: ResolvedPermissions;
    readonly session: AuthSessionSnapshot;
}

export type AuthorizationBridgeResult = AuthorizationDecision | AuthBridgeFailure;

/**
 * Map Better Auth user + linked identities to the Zene authorization subject.
 * Prefer Discord subject when linked; otherwise fall back to canonical auth user id
 * only when the permissions layer is prepared to resolve it (documented migration).
 */
export function resolveAuthorizationSubject(
    authUserId: string,
    identities: readonly IdentityRef[],
): { subject: string; via: 'discord' | 'auth_user' } {
    const discord = identities.find((i) => i.provider === 'discord');
    if (discord) {
        return { subject: discord.subject, via: 'discord' };
    }
    return { subject: authUserId, via: 'auth_user' };
}

export function buildBridgedIdentity(input: {
    authUserId: string;
    session: AuthSessionSnapshot;
    identities?: readonly IdentityRef[];
    discordUserId?: string;
}): BridgedAuthIdentity {
    const identities: IdentityRef[] = [...(input.identities ?? [])];
    if (input.discordUserId && !identities.some((i) => i.provider === 'discord' && i.subject === input.discordUserId)) {
        identities.push(discordIdentity(input.discordUserId));
    }
    const { subject } = resolveAuthorizationSubject(input.authUserId, identities);
    return {
        authUserId: input.authUserId,
        session: input.session,
        identities,
        authorizationSubject: subject,
    };
}

/**
 * Validate session snapshot shape then load fresh Zene permissions for the subject.
 */
export async function bridgeAuthToZeneAuthorization(
    identity: BridgedAuthIdentity,
    nowMs: number = Date.now(),
): Promise<AuthorizationBridgeResult> {
    if (identity.session.revoked) {
        return { kind: 'revoked', reason: 'session_revoked' };
    }
    if (identity.session.expiresAt <= nowMs) {
        return { kind: 'expired', reason: 'session_expired' };
    }
    if (!identity.authorizationSubject) {
        return { kind: 'no_authorization_subject', reason: 'missing_subject' };
    }

    const actor = await resolveActorPermissions(identity.authorizationSubject);
    return {
        ok: true,
        actorUserId: identity.authorizationSubject,
        isEnvOwner: actor.isEnvOwner || isEnvBotOwner(identity.authorizationSubject),
        resolved: actor.resolved,
        session: identity.session,
    };
}

/**
 * Compatibility: existing Discord-only dash session maps into bridge identity.
 * Used during migration Phase 1–2 while custom dash tokens still exist.
 */
export function bridgedIdentityFromLegacyDashSession(input: {
    userId: string;
    sessionId: string;
    expiresAt: number;
}): BridgedAuthIdentity {
    return buildBridgedIdentity({
        authUserId: input.userId,
        discordUserId: input.userId,
        session: {
            sessionId: input.sessionId,
            userId: input.userId,
            expiresAt: input.expiresAt,
            provider: 'discord',
        },
    });
}
