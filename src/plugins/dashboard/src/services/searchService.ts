



import type { RequestContext } from '../lib/requestContext.js';
import { serviceOk, type ServiceResult } from '../lib/requestContext.js';
import {
    ensureDefaultSearchSeed,
    querySearchCandidates,
    upsertSearchEntry,
    removeSearchEntry,
} from '../lib/search/searchIndex.js';
import {
    filterSearchResults,
    type SearchActor,
    type SearchCandidate,
    type SearchResultKind,
} from '../lib/search/searchAuthz.js';

export interface SearchQueryInput {
    q: string;
    page?: number;
    limit?: number;
    kinds?: SearchResultKind[];
}

export interface SearchResultItem {
    id: string;
    kind: SearchResultKind;
    title: string;
    snippet?: string;
    pluginId?: string;
    guildId?: string;
}

export interface SearchResponse {
    items: SearchResultItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
}

export class SearchService {
    async search(ctx: RequestContext, input: SearchQueryInput): Promise<ServiceResult<SearchResponse>> {
        ensureDefaultSearchSeed();
        const page = Math.max(1, input.page ?? 1);
        const limit = Math.min(50, Math.max(1, input.limit ?? 20));
        const actor: SearchActor = {
            userId: ctx.actor.userId,
            isEnvOwner: ctx.actor.isEnvOwner,
            resolved: ctx.actor.resolved,
        };

        const candidates = querySearchCandidates(input.q ?? '', {
            kinds: input.kinds,
            limit: 200,
        });
        const authorized = filterSearchResults(actor, candidates);
        const total = authorized.length;
        const offset = (page - 1) * limit;
        const slice = authorized.slice(offset, offset + limit);
        const items: SearchResultItem[] = slice.map((c) => ({
            id: c.id,
            kind: c.kind,
            title: c.title,
            snippet: c.snippet,
            pluginId: c.pluginId,
            guildId: c.guildId,
        }));
        return serviceOk(
            {
                items,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
            },
            { requestId: ctx.requestId },
        );
    }


    indexUpsert(c: SearchCandidate): void {
        upsertSearchEntry(c);
    }

    indexRemove(kind: SearchResultKind, id: string): void {
        removeSearchEntry(kind, id);
    }
}
