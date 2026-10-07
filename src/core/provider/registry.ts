/**
 * Phase 2A — Central provider registry and deterministic selection.
 */

import { getLogger } from '#core/utils/logger.js';
import type {
    KnownProviderCategory,
    KnownProviderImplementations,
} from './categories.js';
import type {
    ProviderCategoryId,
    ProviderEligibility,
    ProviderRegistration,
    ProviderSelectionResult,
} from './types.js';

const log = getLogger('ProviderRegistry');

function registrationKey(category: ProviderCategoryId, id: string): string {
    return `${category}::${id}`;
}

export class ProviderRegistry {
    /** Heterogeneous storage — implementation type is erased at the boundary. */
    readonly #byKey = new Map<string, ProviderRegistration>();

    register<TImpl>(provider: ProviderRegistration<TImpl>): void {
        if (!provider.id.trim()) {
            throw new Error('Provider id must be non-empty.');
        }
        if (!provider.category.trim()) {
            throw new Error('Provider category must be non-empty.');
        }
        if (!Number.isInteger(provider.priority)) {
            throw new Error(
                `Provider priority must be an integer (got ${String(provider.priority)} for ${provider.category}/${provider.id}).`,
            );
        }

        const key = registrationKey(provider.category, provider.id);
        if (this.#byKey.has(key)) {
            throw new Error(
                `Provider already registered: category=${provider.category} id=${provider.id}`,
            );
        }
        // Erase into internal store; typed APIs reconstruct by category.
        this.#byKey.set(key, provider as ProviderRegistration);
        log.debug(
            `Registered provider ${provider.category}/${provider.id} priority=${provider.priority} trusted=${provider.trusted} available=${provider.available}`,
        );
    }

    unregister(category: ProviderCategoryId, id: string): boolean {
        return this.#byKey.delete(registrationKey(category, id));
    }

    /**
     * Untyped/open category lookup. Prefer {@link getKnown} for core categories.
     */
    get(
        category: ProviderCategoryId,
        id: string,
    ): ProviderRegistration | undefined {
        return this.#byKey.get(registrationKey(category, id));
    }

    /**
     * Typed lookup for categories listed in {@link KnownProviderImplementations}.
     */
    getKnown<C extends KnownProviderCategory>(
        category: C,
        id: string,
    ): ProviderRegistration<KnownProviderImplementations[C]> | undefined {
        const found = this.#byKey.get(registrationKey(category, id));
        if (!found) return undefined;
        return found as ProviderRegistration<KnownProviderImplementations[C]>;
    }

    list(category?: ProviderCategoryId): readonly ProviderRegistration[] {
        const all = [...this.#byKey.values()];
        if (category === undefined) return all;
        return all.filter((p) => p.category === category);
    }

    evaluateEligibility(provider: ProviderRegistration): ProviderEligibility {
        if (!provider.trusted) {
            return { eligible: false, reason: 'untrusted' };
        }
        if (!provider.available) {
            return { eligible: false, reason: 'unavailable' };
        }
        return { eligible: true, reason: 'ok' };
    }

    /**
     * Select highest-priority eligible provider in an open category.
     * Implementation is intentionally erased (`unknown`) — use {@link selectKnown}
     * for core categories with a compile-time implementation mapping.
     * Equal priority among eligible providers → deterministic conflict (not silent pick).
     */
    select(category: ProviderCategoryId): ProviderSelectionResult<unknown> {
        return this.#selectErased(category);
    }

    /**
     * Typed selection for categories in {@link KnownProviderImplementations}.
     * Reconstructs implementation type from the category key (not caller-supplied T).
     */
    selectKnown<C extends KnownProviderCategory>(
        category: C,
    ): ProviderSelectionResult<KnownProviderImplementations[C]> {
        const result = this.#selectErased(category);
        if (!result.ok) return result;
        return {
            ok: true,
            provider: result.provider as ProviderRegistration<
                KnownProviderImplementations[C]
            >,
        };
    }

    /** Internal heterogeneous selection — implementation type erased. */
    #selectErased(category: ProviderCategoryId): ProviderSelectionResult<unknown> {
        const candidates = this.list(category);
        if (candidates.length === 0) {
            return {
                ok: false,
                code: 'unknown_category',
                message: `No providers registered for category '${category}'.`,
            };
        }

        const eligible = candidates.filter((p) => this.evaluateEligibility(p).eligible);
        if (eligible.length === 0) {
            return {
                ok: false,
                code: 'none_eligible',
                message: `No eligible providers for category '${category}' (all untrusted/unavailable).`,
                candidates: candidates.map((p) => p.id),
            };
        }

        let bestPriority = -Infinity;
        for (const p of eligible) {
            if (p.priority > bestPriority) bestPriority = p.priority;
        }

        const top = eligible.filter((p) => p.priority === bestPriority);
        if (top.length > 1) {
            const ids = top.map((p) => p.id).sort();
            return {
                ok: false,
                code: 'priority_conflict',
                message:
                    `Provider priority conflict in category '${category}': ` +
                    `equal priority ${bestPriority} for [${ids.join(', ')}]. ` +
                    `Resolve by adjusting provider priorities (higher wins; ties are errors).`,
                candidates: ids,
            };
        }

        return {
            ok: true,
            provider: top[0]!,
        };
    }

    clear(): void {
        this.#byKey.clear();
    }

    get size(): number {
        return this.#byKey.size;
    }
}

/** Process-wide registry. Core seeds defaults; trusted plugins may register after trust. */
export const providerRegistry = new ProviderRegistry();
