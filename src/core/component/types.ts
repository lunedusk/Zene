/**
 * Phase 2C — Component-level dependency declarations (runtime).
 *
 * Not claimed as signed canonical metadata. Loading-affecting signed fields remain TARGET.
 * Separate from plugin boot priority and provider selection priority.
 */

export type ComponentKind =
    | 'handler'
    | 'command'
    | 'event'
    | 'route'
    | 'interaction'
    | 'middleware'
    | 'service'
    | 'custom';

export type ComponentDepKind =
    | 'component'
    | 'plugin'
    | 'provider-category';

export interface ComponentDependency {
    readonly kind: ComponentDepKind;
    /** component id, plugin id, or provider category id */
    readonly id: string;
    readonly required?: boolean;
}

export interface ComponentDeclaration {
    readonly id: string;
    readonly kind: ComponentKind;
    readonly pluginId: string;
    readonly dependencies?: readonly ComponentDependency[];
}

export type ComponentResolutionStatus =
    | 'available'
    | 'missing'
    | 'disabled'
    | 'failed'
    | 'incompatible'
    | 'circular';

export interface ComponentResolution {
    readonly componentId: string;
    readonly status: ComponentResolutionStatus;
    readonly reasons: readonly string[];
    /** Topological order of this component and its dependency closure (deps first). */
    readonly order?: readonly string[];
}
