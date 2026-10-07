export type {
    IsolationLevel,
    RuntimeHealth,
    RuntimePolicy,
    RuntimeCapabilityMatrix,
    RuntimeLaunchRequest,
    RuntimeSelectionResult,
    RuntimeSelectionSuccess,
    RuntimeSelectionFailure,
    RuntimeMessage,
    RuntimeHandle,
    InProcessLifecycleHooks,
} from './types.js';
export {
    ISOLATION_RANK,
    DEFAULT_RUNTIME_POLICY,
    RUNTIME_CAPABILITY_MATRIX,
} from './types.js';
export {
    probeRuntimeAvailability,
    isLevelAvailable,
    type RuntimeAvailability,
} from './availability.js';
export { selectRuntime, buildCandidateOrder, capabilitiesSatisfied } from './selector.js';
export { launchRuntime, type IsolatedRuntimeHandle } from './backends.js';
export {
    RuntimeManager,
    runtimeManager,
    isolationAtLeast,
    resolvePluginRuntimePolicy,
    RuntimeEstablishError,
} from './manager.js';
export {
    RUNTIME_PROTOCOL_VERSION,
    type HostToCoreMessage,
    type CoreToHostMessage,
} from './protocol.js';
export { resolveHostArtifact, resolvePluginEntryArtifact } from './hostResolve.js';

export { IsolatedHandlerProxy, countOwned } from './bridge.js';

export {
    setAuthenticatedRuntimeFloor,
    getAuthenticatedRuntimeFloor,
    clearAuthenticatedRuntimeFloor,
    __testOnly_clearAuthenticatedRuntimeFloor,
    effectiveRuntimePolicy,
    selectWithAuthenticatedFloor,
    RuntimeFloorViolationError,
} from './authenticatedPolicy.js';

export { validateHostToCoreMessage, ProtocolValidationError, assertResponseCorrelation } from './messageValidation.js';

export { createPluginRuntimeRecord, getActivePluginRuntimeRecord, deactivatePluginRuntimeRecord, listActivePluginRuntimeRecords, countLoadedPluginRuntimeRecords } from './pluginRuntimeRecord.js';
