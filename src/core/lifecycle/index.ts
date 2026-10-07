export type {
    LifecyclePhase,
    LifecycleOperation,
    ResourceKind,
    ResourceHandle,
    CleanupFailure,
    CleanupReport,
    ModificationPolicy,
    ArtifactIntegrityState,
    LifecycleTransitionError,
} from './types.js';
export { DEFAULT_MODIFICATION_POLICY } from './types.js';
export { ResourceRegistry, resourceRegistry } from './resourceRegistry.js';
export {
    getModificationPolicy,
    setModificationPolicy,
    clearModificationPolicy,
    getArtifactIntegrityState,
    markArtifactVerified,
    markArtifactVerificationFailed,
    recordPhysicalSourceMutation,
    assertRuntimeExtensionAllowed,
    assertRuntimeReplacementAllowed,
} from './modificationPolicy.js';
export { LazyResource, type LazyResourceOptions } from './lazyResource.js';
export { LifecycleController, lifecycleController } from './controller.js';

export {
    guardDependentOperation,
    assertNoActiveDependents,
    findActiveDependents,
    type DependencyGuardResult,
} from './dependencyGuard.js';
