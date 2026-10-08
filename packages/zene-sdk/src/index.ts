export {
    SDK_VERSION,
    SDK_COMPAT_RANGE,
    SDK_CONTRACT_VERSION,
    getSdkCompatibilityInfo,
    isSdkContractCompatible,
    type SdkVersion,
    type SdkContractVersion,
    type SdkCompatibilityInfo,
} from './version.js';

export {
    type PluginId,
    type ContributionId,
    type RuntimeGeneration,
    type DataScope,
    type PrivacyClass,
    type PluginIdentity,
    type SdkCapabilityRequirement,
    type SdkIsolationLevel,
    type SdkRuntimeRequirements,
    type SdkDependencyKind,
    type SdkDependencyDeclaration,
    type SdkTrustOutcome,
    type SdkSessionContext,
    type SdkErrorBody,
    SdkError,
} from './types.js';

export type { SdkHttpRouterHandle, SdkBridgeHttp } from './http.js';
export type { SdkCommandRequirements, SdkBridgeCommandsNeutral } from './commands.js';

export type {
    BridgeLogLevel,
    SdkBridgeLog,
    SdkBridgeConfig,
    SdkBridgeEventBus,
    SdkBridgeProvider,
    SdkBridgeResource,
    SdkBridgeData,
    SdkDashboardContributionRegistration,
    SdkDashboardContributionView,
    SdkDashboardContributionInput,
    SdkBridgeDashboard,
    SdkBridgeCommands,
    SdkBridgeCrossHost,
    SdkBridge,
} from './bridge.js';

export { assertBridgeAuthorized, assertBridgeGeneration } from './bridge.js';

export type {
    SdkBridgeScheduler,
    SdkBridgeCooldowns,
    SdkBridgePermissions,
    SdkBridgeFeatures,
    SdkFeatureDeclaration,
    SdkBridgeLocale,
    SdkBridgeEmoji,
    SdkBridgeCache,
    SdkBridgeDiagnostics,
    SdkBridgeGuild,
    SdkCooldownContext,
} from './domains.js';

export { createPluginSdk, type PluginSdk } from './plugin.js';

export {
    type DashboardContribution,
    type DashboardContributionKind,
    type DashboardScope,
    registerDashboardContribution,
    revokeDashboardContribution,
    listDashboardContributions,
} from './dashboard.js';

export {
    type DataTypeDefinition,
    registerDataType,
    accessData,
    exportData,
    deleteData,
} from './data.js';

export {
    crossHostSend,
    crossHostRequest,
    crossHostOn,
    crossHostOff,
    crossHostIsAvailable,
    crossHostMachineId,
    crossHostPeers,
    type SdkCrossHostMeta,
    type SdkCrossHostHandler,
} from './crosshost.js';
