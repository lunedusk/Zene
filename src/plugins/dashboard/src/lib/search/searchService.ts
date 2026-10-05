/**
 * Phase 4 — SearchService: candidate retrieval + authorization filter + pagination.
 * Repository never authorizes; this layer does.
 */

import type { RequestContext } from '../requestContext.js';
import { ServiceError, serviceOk, type ServiceResult } from '../requestContext.js';
import {
    authorizeSearchCandidate,
    type SearchCandidate,
    type SearchResultKind,
} from './searchAuthz.js';
import {
    durableQueryCandidates,
    ensureDurableSearchSeed,
    probeSearchBackend,
} from './durableSearchRepository.js';
import { querySearchCandidates, ensureDefaultSearchSeed } from './searchIndex.js';

export interface SearchQueryInput {
    readonly q: string;
    readonly kinds?: readonly SearchResultKind[];
    readonly page?: number;
    readonly limit?: number;
    readonly guildId?: string;
}

export interface SearchPage {
    readonly items: SearchCandidate[];
    readonly page: number;
    readonly limit: number;
    /** Count AFTER authorization filtering — never pre-auth count. */
    readonly totalAuthorized: number;
    readonly backend: 'durable' | 'memory_fallback';
}

export async function searchAuthorized(
    ctx: RequestContext,
    input: SearchQueryInput,
): Promise<ServiceResult<SearchPage>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const backendStatus = await probeSearchBackend();

    let candidates: SearchCandidate[];
    let backend: SearchPage['backend'] = 'durable';

    if (backendStatus === 'ok') {
        await ensureDurableSearchSeed();
        // Over-fetch so post-authz pagination is meaningful
        candidates = await durableQueryCandidates(input.q, {
            kinds: input.kinds,
            limit: Math.min(500, limit * page + limit),
        });
    } else {
        // Explicit degradation: memory seed only — still authorize; do not pretend durable authority
        ensureDefaultSearchSeed();
        candidates = querySearchCandidates(input.q, {
            kinds: input.kinds,
            limit: Math.min(500, limit * page + limit),
        });
        backend = 'memory_fallback';
    }

    if (input.guildId) {
        candidates = candidates.filter((c) => !c.guildId || c.guildId === input.guildId);
    }

    const authorized = candidates.filter((c) =>
        authorizeSearchCandidate(
            {
                userId: ctx.actor.userId,
                isEnvOwner: ctx.actor.isEnvOwner,
                resolved: ctx.actor.resolved,
            },
            c,
        ),
    );

    const totalAuthorized = authorized.length;
    const start = (page - 1) * limit;
    const items = authorized.slice(start, start + limit);

    return serviceOk(
        { items, page, limit, totalAuthorized, backend },
        { requestId: ctx.requestId },
    );
}

export function searchBackendUnavailableError(): ServiceError {
    return new ServiceError('UNAVAILABLE', 'Search backend unavailable', 503);
}
