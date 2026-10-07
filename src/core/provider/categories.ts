/**
 * Phase 2A — Compile-time map from known provider categories to implementation types.
 *
 * Internal registry storage remains heterogeneous (erased).
 * Public selection for *known* categories reconstructs the correct implementation type.
 * Open-ended categories use register() + select() (implementation erased);
 * core categories use selectKnown() / getKnown() for typed implementations.
 */

import type { DependencyInstallBackend } from '#core/helpers/dependency/backends.js';

/**
 * Categories whose implementation type is fixed by core.
 * Extend this map when a new core category is providerized.
 */
export interface KnownProviderImplementations {
    readonly 'dependency.install': DependencyInstallBackend;
}

export type KnownProviderCategory = keyof KnownProviderImplementations;
