














export const CONCURRENT_SESSION_POLICY = {

    maxActiveSessionsPerUser: 10,

    revokeOthersOnPasswordChange: true,

    revokeOthersOnMfaChange: true,

    betterAuthOwnsTtl: true as const,

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





export function sessionsToRevokeForCap(
    sessions: readonly SessionListItem[],
    maxActive: number,
    currentSessionId?: string,
): string[] {
    if (maxActive <= 0) return [];
    const sorted = [...sessions].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const keep = new Set<string>();
    if (currentSessionId) keep.add(currentSessionId);


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
