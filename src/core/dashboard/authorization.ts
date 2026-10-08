/**
 * Dashboard authorization: authentication ≠ authorization ≠ resource scope.
 *
 * Pipeline (strict order):
 * 1. session authenticity
 * 2. reject conflicting/forged client authority claims
 * 3. resolve contribution from Core registry
 * 4. resolve authoritative resource/guild scope
 * 5. evaluate operator bypass only for permission bits
 * 6. evaluate contribution permission requirements
 */

import {
    type DashboardPrincipal,
    type DashboardSessionRecord,
    principalHasBits,
    DashboardAuthError,
    getDashboardSessionRecord,
} from './authContext.js';
import {
    getContribution,
    resolveContributionByApiPath,
    type DashboardContributionRecord,
} from './contributionRegistry.js';

export interface AuthorizeDashboardRequestInput {
    readonly session: DashboardSessionRecord | undefined;
    readonly contributionPluginId?: string;
    readonly contributionId?: string;
    readonly apiPath?: string;
    /** Authoritative resource selector from server routing (optional). */
    readonly requestedGuildId?: string;
    /**
     * Client-supplied claims from headers/body.
     * Never trusted as authority. Conflicting values → forbidden.
     */
    readonly clientClaims?: {
        userId?: string;
        guildId?: string;
        pluginId?: string;
        permissionBits?: readonly string[];
        roleIds?: readonly string[];
        isMember?: boolean;
        trustOutcome?: string;
        signerFingerprint?: string;
    };
}

export interface AuthorizeDashboardRequestResult {
    readonly principal: DashboardPrincipal;
    readonly contribution?: DashboardContributionRecord;
    readonly guildId?: string;
}

/**
 * Reject any client field that attempts to assert identity, membership,
 * permissions, trust, or plugin ownership.
 */
function assertNoForgedAuthorityClaims(
    principal: DashboardPrincipal,
    claims: AuthorizeDashboardRequestInput['clientClaims'],
    contribution: DashboardContributionRecord | undefined,
): void {
    if (!claims) return;

    if (claims.userId !== undefined && claims.userId !== principal.userId) {
        throw new DashboardAuthError(
            'context_mismatch',
            'Client userId conflicts with authenticated principal',
        );
    }

    // permissionBits in the request are never an accepted authority surface
    if (claims.permissionBits !== undefined) {
        throw new DashboardAuthError(
            'forbidden',
            'Client permissionBits are not accepted as authority',
        );
    }

    if (claims.roleIds !== undefined) {
        throw new DashboardAuthError(
            'forbidden',
            'Client roleIds are not accepted as authority',
        );
    }

    if (claims.isMember !== undefined) {
        throw new DashboardAuthError(
            'forbidden',
            'Client membership claims are not accepted as authority',
        );
    }

    if (claims.trustOutcome !== undefined || claims.signerFingerprint !== undefined) {
        throw new DashboardAuthError(
            'forbidden',
            'Client trust/signer claims are not accepted as authority',
        );
    }

    if (claims.pluginId !== undefined) {
        if (contribution) {
            if (claims.pluginId !== contribution.pluginId) {
                throw new DashboardAuthError(
                    'context_mismatch',
                    'Client pluginId conflicts with contribution owner',
                );
            }
        } else {
            // Plugin claim without a resolved contribution is still an authority assertion
            throw new DashboardAuthError(
                'forbidden',
                'Client pluginId cannot select plugin ownership',
            );
        }
    }
}

function resolveContribution(
    input: AuthorizeDashboardRequestInput,
): DashboardContributionRecord | undefined {
    if (input.contributionPluginId && input.contributionId) {
        const contribution = getContribution(
            input.contributionPluginId,
            input.contributionId,
        );
        if (!contribution || contribution.state !== 'active') {
            throw new DashboardAuthError(
                'contribution_missing',
                'Contribution not available',
            );
        }
        return contribution;
    }
    if (input.apiPath) {
        const contribution = resolveContributionByApiPath(input.apiPath);
        if (!contribution || contribution.state !== 'active') {
            throw new DashboardAuthError(
                'contribution_missing',
                'No active API contribution for path',
            );
        }
        return contribution;
    }
    return undefined;
}

/**
 * Guild selector: prefer server-provided requestedGuildId.
 * Client guildId may only act as an optional selector when requestedGuildId is omitted,
 * and is always validated against Core membership — never trusted as proof of access.
 * Forged membership (client guild not in principal.guildIds) is always rejected,
 * including for env owners (bypass applies only to permission evaluation later).
 */
function resolveGuildScope(
    principal: DashboardPrincipal,
    contribution: DashboardContributionRecord | undefined,
    requestedGuildId: string | undefined,
    clientGuildId: string | undefined,
): string | undefined {
    const selector = requestedGuildId ?? clientGuildId;
    if (selector === undefined) return undefined;

    // Conflicting dual selectors
    if (
        requestedGuildId !== undefined &&
        clientGuildId !== undefined &&
        requestedGuildId !== clientGuildId
    ) {
        throw new DashboardAuthError(
            'context_mismatch',
            'Client guildId conflicts with requested resource scope',
        );
    }

    const needsGuildScope =
        contribution?.scope === 'guild' || contribution?.scope === 'server';

    // Always validate membership against Core principal — no owner bypass here
    if (!principal.guildIds.includes(selector)) {
        throw new DashboardAuthError(
            'forbidden',
            'Authenticated principal is not a member of the requested guild',
        );
    }

    if (needsGuildScope || clientGuildId !== undefined || requestedGuildId !== undefined) {
        return selector;
    }
    return selector;
}

export function authorizeDashboardRequest(
    input: AuthorizeDashboardRequestInput,
): AuthorizeDashboardRequestResult {
    // 1. Session authenticity — always re-resolve from the authoritative store.
    // Caller-held snapshots must not authorize after logout/revoke/expiry.
    if (!input.session?.sessionId) {
        throw new DashboardAuthError('unauthenticated', 'Authentication required');
    }
    const session = getDashboardSessionRecord(input.session.sessionId);
    if (!session) {
        // Missing, revoked, or expired in the Core store
        if (input.session.revoked || Date.now() > input.session.expiresAt) {
            throw new DashboardAuthError(
                input.session.revoked ? 'unauthenticated' : 'session_expired',
                input.session.revoked ? 'Authentication required' : 'Session expired',
            );
        }
        throw new DashboardAuthError('unauthenticated', 'Authentication required');
    }

    const principal = session.principal;

    // 2–3. Resolve contribution first so plugin claim can be compared, then forged claims
    const contribution = resolveContribution(input);

    // 2. Forged / conflicting authority claims (before any operator bypass)
    assertNoForgedAuthorityClaims(principal, input.clientClaims, contribution);

    // 4. Authoritative guild/resource scope (membership validated; no owner bypass)
    const guildId = resolveGuildScope(
        principal,
        contribution,
        input.requestedGuildId,
        input.clientClaims?.guildId,
    );

    // 5–6. Permission evaluation: operator bypass may apply only here
    if (contribution && contribution.permissionBits.length > 0) {
        if (!principalHasBits(principal, contribution.permissionBits, 'all')) {
            throw new DashboardAuthError(
                'forbidden',
                'Missing contribution permissions',
            );
        }
    }

    return { principal, contribution, guildId };
}
