/**
 * Phase 5 — Concurrent session policy (authentication boundary only).
 *
 * Better Auth owns session lifecycle (create / list / revoke / expire).
 * Zene owns authorization after identity is resolved.
 *
 * Policy (production):
 * - Multiple concurrent sessions per user are ALLOWED (multi-device).
 * - Soft limit: MAX_ACTIVE_SESSIONS_PER_USER (oldest revoked when exceeded, if BA API supports list+revoke).
 * - Logout-one: revoke single session by id/token via Better Auth.
 * - Logout-all: revoke all sessions for user except optionally current.
 * - Password change / MFA enroll: SHOULD revoke other sessions (security event).
 * - Expired / revoked sessions: resolveSessionIdentity → authority 'none'.
 */

export const CONCURRENT_SESSION_POLICY = {
    /** Soft max active sessions per user; 0 = unlimited */
    maxActiveSessionsPerUser: 10,
    /** On password change, revoke all other sessions */
    revokeOthersOnPasswordChange: true,
    /** On MFA enable/disable, revoke all other sessions */
    revokeOthersOnMfaChange: true,
    /** Session absolute TTL is owned by Better Auth session.expiresIn */
    betterAuthOwnsTtl: true as const,
    /** Zene never stores parallel password hashes for user sessions */
    zeneDoesNotOwnUserSessionStore: true as const,
} as const;

export type ConcurrentSessionPolicy = typeof CONCURRENT_SESSION_POLICY;

export interface SessionListItem {
    readonly sessionId: string;
    readonly createdAt?: number;
    readonly expiresAt?: number;
    readonly userAgent?: string;
    readonly ip?: string;
    readonly current?: boolean;
}

/**
 * Decide which session ids should be revoked when max concurrent is exceeded.
 * Oldest first (by createdAt); never revoke the current session id if provided.
 */
export function sessionsToRevokeForCap(
    sessions: readonly SessionListItem[],
    maxActive: number,
    currentSessionId?: string,
): string[] {
    if (maxActive <= 0) return [];
    const sorted = [...sessions].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const keep = new Set<string>();
    if (currentSessionId) keep.add(currentSessionId);

    // Prefer keeping newest sessions
    const newestFirst = [...sorted].reverse();
    for (const s of newestFirst) {
        if (keep.size >= maxActive) break;
        keep.add(s.sessionId);
    }

    return sorted.filter((s) => !keep.has(s.sessionId)).map((s) => s.sessionId);
}

export function shouldRevokeOthersOnSecurityEvent(
    event: 'password_change' | 'mfa_change' | 'compromise',
): boolean {
    if (event === 'compromise') return true;
    if (event === 'password_change') return CONCURRENT_SESSION_POLICY.revokeOthersOnPasswordChange;
    if (event === 'mfa_change') return CONCURRENT_SESSION_POLICY.revokeOthersOnMfaChange;
    return false;
}
