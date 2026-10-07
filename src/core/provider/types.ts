/**
 * Phase 2A — Generic provider contracts.
 *
 * Provider selection priority is independent of plugin boot priority:
 *   - plugin boot: lower number → earlier
 *   - provider:    higher number → preferred
 *
 * Eligibility ≠ registration ≠ selection ≠ execution.
 */

/** Well-known categories. Open string allows later categories without core churn. */
export type ProviderCategoryId = 'dependency.install' | (string & {});

/**
 * Base registration record. Category-specific implementations are typed via
 * ProviderRegistration<TImpl>.
 */
export interface ProviderRegistration<TImpl = unknown> {
    /** Stable identity within a category (e.g. "npm", "bun"). */
    readonly id: string;
    readonly category: ProviderCategoryId;
    /** Semver-ish informational version of the provider implementation. */
    readonly version: string;
    /**
     * Selection priority. Higher wins among eligible providers.
     * Must not be confused with PluginManifest.priority.
     */
    readonly priority: number;
    /** Owning plugin id when supplied by a plugin; undefined for core-seeded. */
    readonly pluginId?: string;
    /**
     * Whether the supplying context is trusted under Phase 1 policy.
     * Core-seeded providers are trusted. Plugin-supplied must reflect trust decision.
     */
    readonly trusted: boolean;
    /** Runtime readiness (process available, config present, etc.). */
    readonly available: boolean;
    /** Optional capability tags for future fine-grained filtering. */
    readonly capabilities?: readonly string[];
    readonly implementation: TImpl;
}

export type ProviderEligibilityReason =
    | 'ok'
    | 'untrusted'
    | 'unavailable'
    | 'category_mismatch'
    | 'disabled';

export interface ProviderEligibility {
    readonly eligible: boolean;
    readonly reason: ProviderEligibilityReason;
}

export interface ProviderSelectionSuccess<TImpl = unknown> {
    readonly ok: true;
    readonly provider: ProviderRegistration<TImpl>;
}

export interface ProviderSelectionFailure {
    readonly ok: false;
    readonly code: 'none_eligible' | 'priority_conflict' | 'unknown_category';
    readonly message: string;
    readonly candidates?: readonly string[];
}

/**
 * Selection result. Default `TImpl = unknown` is the intentional erased form
 * for open categories / internal heterogeneous storage. Known categories use
 * `ProviderSelectionResult<KnownProviderImplementations[C]>` via selectKnown().
 */
export type ProviderSelectionResult<TImpl = unknown> =
    | ProviderSelectionSuccess<TImpl>
    | ProviderSelectionFailure;

/** Plugin-facing declaration (runtime). Signed-manifest declarations are TARGET. */
export interface ProviderDeclaration {
    readonly category: ProviderCategoryId;
    readonly id: string;
    readonly version?: string;
    readonly priority: number;
    readonly capabilities?: readonly string[];
}
