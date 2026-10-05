



import { kvGet, kvSet, kvDel, newId } from '../lib/store.js';
import type {
    CanonicalUserRecord,
    IdentityRecord,
    IdentityProviderKind,
    SessionRecord,
} from '#core/types/identitySession.js';

const NS_USER = 'identity_user';
const NS_IDENT = 'identity_link';
const NS_SESS = 'identity_session';
const NS_IDENT_BY_SUBJECT = 'identity_by_subject';

export async function createCanonicalUser(primaryDiscordSubject?: string): Promise<CanonicalUserRecord> {
    const id = newId('user');
    const now = Date.now();
    const rec: CanonicalUserRecord = {
        id,
        primaryDiscordSubject,
        createdAt: now,
        updatedAt: now,
    };
    await kvSet(NS_USER, id, rec);
    if (primaryDiscordSubject) {
        await kvSet(NS_IDENT_BY_SUBJECT, `discord:${primaryDiscordSubject}`, { userId: id });
    }
    return rec;
}

export async function getCanonicalUser(userId: string): Promise<CanonicalUserRecord | null> {
    const raw = await kvGet(NS_USER, userId);
    return raw && typeof raw === 'object' ? (raw as CanonicalUserRecord) : null;
}

export async function findUserIdByProviderSubject(
    provider: IdentityProviderKind,
    subject: string,
): Promise<string | null> {
    const raw = await kvGet(NS_IDENT_BY_SUBJECT, `${provider}:${subject}`);
    if (!raw || typeof raw !== 'object') return null;
    const userId = (raw as { userId?: string }).userId;
    return typeof userId === 'string' ? userId : null;
}

export async function linkIdentity(input: {
    userId: string;
    provider: IdentityProviderKind;
    providerSubject: string;
    metadata?: Record<string, unknown>;
}): Promise<IdentityRecord> {
    const existingUser = await findUserIdByProviderSubject(input.provider, input.providerSubject);
    if (existingUser && existingUser !== input.userId) {
        throw new Error('IDENTITY_SUBJECT_IN_USE');
    }
    const id = newId('ident');
    const now = Date.now();
    const rec: IdentityRecord = {
        id,
        userId: input.userId,
        provider: input.provider,
        providerSubject: input.providerSubject,
        metadata: input.metadata,
        createdAt: now,
        linkedAt: now,
    };
    await kvSet(NS_IDENT, id, rec);
    await kvSet(NS_IDENT_BY_SUBJECT, `${input.provider}:${input.providerSubject}`, {
        userId: input.userId,
        identityId: id,
    });
    return rec;
}

export async function createSession(input: {
    userId: string;
    identityId?: string;
    provider?: IdentityProviderKind;
    ttlMs?: number;
    deviceLabel?: string;
    ipHash?: string;
    userAgentHash?: string;
    authMethod?: string;
}): Promise<SessionRecord> {
    const sessionId = newId('sess');
    const now = Date.now();
    const rec: SessionRecord = {
        sessionId,
        userId: input.userId,
        identityId: input.identityId,
        provider: input.provider,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000),
        deviceLabel: input.deviceLabel,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        authMethod: input.authMethod,
    };
    await kvSet(NS_SESS, sessionId, rec);
    return rec;
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
    const raw = await kvGet(NS_SESS, sessionId);
    return raw && typeof raw === 'object' ? (raw as SessionRecord) : null;
}

export async function touchSession(sessionId: string): Promise<SessionRecord | null> {
    const s = await getSession(sessionId);
    if (!s) return null;
    const next = { ...s, lastSeenAt: Date.now() };
    await kvSet(NS_SESS, sessionId, next);
    return next;
}

export async function revokeSession(sessionId: string): Promise<boolean> {
    const s = await getSession(sessionId);
    if (!s) return false;
    const next = { ...s, revokedAt: Date.now() };
    await kvSet(NS_SESS, sessionId, next);
    return true;
}

export async function setSudo(sessionId: string, durationMs: number): Promise<SessionRecord | null> {
    const s = await getSession(sessionId);
    if (!s) return null;
    const next = { ...s, sudoUntil: Date.now() + durationMs };
    await kvSet(NS_SESS, sessionId, next);
    return next;
}


export async function revokeAllSessionsForUser(userId: string, knownSessionIds: string[]): Promise<number> {
    let n = 0;
    for (const id of knownSessionIds) {
        const s = await getSession(id);
        if (s && s.userId === userId) {
            await revokeSession(id);
            n += 1;
        }
    }
    return n;
}

export async function deleteSessionRecord(sessionId: string): Promise<void> {
    await kvDel(NS_SESS, sessionId);
}
