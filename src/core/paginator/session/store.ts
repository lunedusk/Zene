
import type { RenderMode } from '../types/models.js';
import type { PackedPage } from '../split/atomic.js';

export interface PaginatorSession {
    readonly id: string;
    readonly userId: string;
    readonly channelId: string;
    readonly mode: RenderMode;
    readonly title?: string;
    readonly accentColor?: number;
    readonly pages: readonly PackedPage[];
    readonly authorOnly: boolean;
    readonly ephemeral: boolean;
    page: number;
    expiresAt: number;
}

const sessions = new Map<string, PaginatorSession>();
const byUser = new Map<string, Set<string>>();

const DEFAULT_TTL = 10 * 60 * 1000;
const DEFAULT_MAX_PER_USER = 5;

export function putSession(session: PaginatorSession, maxPerUser = DEFAULT_MAX_PER_USER): void {
    const set = byUser.get(session.userId) ?? new Set<string>();
    if (set.size >= maxPerUser) {
        const oldest = [...set][0];
        if (oldest) {
            sessions.delete(oldest);
            set.delete(oldest);
        }
    }
    set.add(session.id);
    byUser.set(session.userId, set);
    sessions.set(session.id, session);
}

export function getSession(id: string): PaginatorSession | undefined {
    const s = sessions.get(id);
    if (!s) return undefined;
    if (Date.now() > s.expiresAt) {
        deleteSession(id);
        return undefined;
    }
    return s;
}

export function deleteSession(id: string): void {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    const set = byUser.get(s.userId);
    if (set) {
        set.delete(id);
        if (set.size === 0) byUser.delete(s.userId);
    }
}

export function clearUserSessions(userId: string): void {
    const set = byUser.get(userId);
    if (!set) return;
    for (const id of set) sessions.delete(id);
    byUser.delete(userId);
}

export function touchSession(id: string, ttlMs = DEFAULT_TTL): void {
    const s = sessions.get(id);
    if (!s) return;
    s.expiresAt = Date.now() + ttlMs;
}

export function sessionPagePayload(session: PaginatorSession): { text: string; meta: { page: number; pages: number; totalUnits: number } } {
    const pages = session.pages.length || 1;
    const page = Math.min(Math.max(1, session.page), pages);
    const packed = session.pages[page - 1];
    const totalUnits = session.pages.reduce((n, p) => n + p.units.length, 0);
    return {
        text: packed?.text ?? '',
        meta: { page, pages, totalUnits },
    };
}

export { DEFAULT_TTL, DEFAULT_MAX_PER_USER };
