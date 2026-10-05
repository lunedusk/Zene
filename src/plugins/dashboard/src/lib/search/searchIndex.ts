




import type { SearchCandidate, SearchResultKind } from './searchAuthz.js';

export interface SearchIndexEntry extends SearchCandidate {
    readonly updatedAt: number;
    readonly tokens: readonly string[];
}

const entries = new Map<string, SearchIndexEntry>();

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9._-]+/i)
        .filter((t) => t.length > 0);
}

function entryKey(kind: SearchResultKind, id: string): string {
    return `${kind}:${id}`;
}

export function upsertSearchEntry(c: SearchCandidate): void {
    const key = entryKey(c.kind, c.id);
    const tokens = tokenize(`${c.title} ${c.snippet ?? ''} ${c.pluginId ?? ''} ${c.guildId ?? ''}`);
    entries.set(key, { ...c, updatedAt: Date.now(), tokens });
}

export function removeSearchEntry(kind: SearchResultKind, id: string): void {
    entries.delete(entryKey(kind, id));
}

export function clearSearchIndex(): void {
    entries.clear();
}

export function listSearchEntries(): SearchIndexEntry[] {
    return [...entries.values()];
}





export function querySearchCandidates(query: string, options?: { kinds?: readonly SearchResultKind[]; limit?: number }): SearchCandidate[] {
    const q = query.trim().toLowerCase();
    const tokens = q ? tokenize(q) : [];
    let list = [...entries.values()];
    if (options?.kinds && options.kinds.length > 0) {
        const set = new Set(options.kinds);
        list = list.filter((e) => set.has(e.kind));
    }
    if (tokens.length > 0) {
        list = list.filter((e) => tokens.every((t) => e.tokens.some((et) => et.includes(t)) || e.title.toLowerCase().includes(t)));
    }
    list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return a.id.localeCompare(b.id);
    });
    const limit = options?.limit ?? 50;
    return list.slice(0, limit).map(({ updatedAt: _u, tokens: _t, ...c }) => c);
}


export function ensureDefaultSearchSeed(): void {
    if (entries.size > 0) return;
    upsertSearchEntry({ id: 'dash.home', kind: 'page', title: 'Dashboard Home' });
    upsertSearchEntry({ id: 'dash.registry', kind: 'page', title: 'Plugin Registry' });
    upsertSearchEntry({ id: 'docs.getting-started', kind: 'doc', title: 'Getting Started' });
}
