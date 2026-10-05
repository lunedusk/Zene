/**
 * Phase 4 — Durable search repository (KV-backed via dash-data store).
 * Candidate retrieval only — authorization is performed by SearchService.
 */

import { kvGet, kvSet } from '../../../../dash-data/src/lib/store.js';
import type { SearchCandidate, SearchResultKind } from './searchAuthz.js';

const NS = 'dash_search_index';
const NS_META = 'dash_search_meta';

export interface DurableSearchEntry extends SearchCandidate {
    readonly updatedAt: number;
    readonly tokens: readonly string[];
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9._-]+/i)
        .filter((t) => t.length > 0);
}

function entryKey(kind: SearchResultKind, id: string): string {
    return `${kind}:${id}`;
}

export async function durableUpsert(c: SearchCandidate): Promise<void> {
    const key = entryKey(c.kind, c.id);
    const tokens = tokenize(`${c.title} ${c.snippet ?? ''} ${c.pluginId ?? ''} ${c.guildId ?? ''}`);
    const entry: DurableSearchEntry = { ...c, updatedAt: Date.now(), tokens };
    await kvSet(NS, key, entry);
    await touchMeta();
}

export async function durableRemove(kind: SearchResultKind, id: string): Promise<void> {
    await kvSet(NS, entryKey(kind, id), null);
    await touchMeta();
}

export async function durableClear(): Promise<void> {
    const all = await listAllEntries();
    for (const e of all) {
        await kvSet(NS, entryKey(e.kind, e.id), null);
    }
    await touchMeta();
}

async function touchMeta(): Promise<void> {
    await kvSet(NS_META, 'updatedAt', Date.now());
}

export async function durableIndexUpdatedAt(): Promise<number | null> {
    const v = await kvGet(NS_META, 'updatedAt');
    return typeof v === 'number' ? v : null;
}

/**
 * List all durable entries. Uses index of keys stored under meta when available;
 * falls back to scanning known seeds + any upserted keys tracked in meta set.
 */
async function listAllEntries(): Promise<DurableSearchEntry[]> {
    const keyListRaw = await kvGet(NS_META, 'keys');
    const keys = Array.isArray(keyListRaw) ? (keyListRaw as string[]) : [];
    const out: DurableSearchEntry[] = [];
    for (const k of keys) {
        const raw = await kvGet(NS, k);
        if (raw && typeof raw === 'object') out.push(raw as DurableSearchEntry);
    }
    return out;
}

async function trackKey(key: string): Promise<void> {
    const keyListRaw = await kvGet(NS_META, 'keys');
    const keys = Array.isArray(keyListRaw) ? (keyListRaw as string[]) : [];
    if (!keys.includes(key)) {
        keys.push(key);
        await kvSet(NS_META, 'keys', keys.slice(-10_000));
    }
}

export async function durableUpsertTracked(c: SearchCandidate): Promise<void> {
    const key = entryKey(c.kind, c.id);
    await durableUpsert(c);
    await trackKey(key);
}

/**
 * Candidate query — NOT authorization.
 */
export async function durableQueryCandidates(
    query: string,
    options?: { kinds?: readonly SearchResultKind[]; limit?: number },
): Promise<SearchCandidate[]> {
    const q = query.trim().toLowerCase();
    const tokens = q ? tokenize(q) : [];
    let list = await listAllEntries();
    if (options?.kinds && options.kinds.length > 0) {
        const set = new Set(options.kinds);
        list = list.filter((e) => set.has(e.kind));
    }
    if (tokens.length > 0) {
        list = list.filter(
            (e) =>
                tokens.every(
                    (t) => e.tokens.some((et) => et.includes(t)) || e.title.toLowerCase().includes(t),
                ),
        );
    }
    list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return a.id.localeCompare(b.id);
    });
    const limit = options?.limit ?? 50;
    return list.slice(0, limit).map(({ updatedAt: _u, tokens: _t, ...c }) => c);
}

export async function ensureDurableSearchSeed(): Promise<void> {
    const existing = await listAllEntries();
    if (existing.length > 0) return;
    await durableUpsertTracked({ id: 'dash.home', kind: 'page', title: 'Dashboard Home' });
    await durableUpsertTracked({ id: 'dash.registry', kind: 'page', title: 'Plugin Registry' });
    await durableUpsertTracked({ id: 'docs.getting-started', kind: 'doc', title: 'Getting Started' });
}

/** Backend availability probe */
export type SearchBackendStatus = 'ok' | 'unavailable';

export async function probeSearchBackend(): Promise<SearchBackendStatus> {
    try {
        await kvSet(NS_META, 'probe', Date.now());
        return 'ok';
    } catch {
        return 'unavailable';
    }
}
