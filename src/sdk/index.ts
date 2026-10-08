export { SDK_VERSION, SDK_COMPAT_RANGE, type SdkVersion } from './version.js';
export {
    type PluginId,
    type ContributionId,
    type RuntimeGeneration,
    type DataScope,
    type PrivacyClass,
    type PluginIdentity,
    type SdkCapabilityRequirement,
    type SdkRuntimeRequirements,
    type SdkDependencyKind,
    type SdkDependencyDeclaration,
    type SdkSessionContext,
    type SdkErrorBody,
    SdkError,
} from './types.js';
export {
    type SdkBridge,
    type SdkBridgeLog,
    type SdkBridgeConfig,
    type SdkBridgeEventBus,
    type SdkBridgeProvider,
    type SdkBridgeResource,
    type SdkBridgeData,
    type SdkBridgeDashboard,
    type SdkBridgeHttp,
    type SdkBridgeCommands,
    type SdkRootCommandRegistration,
    type SdkCommandExtension,
    type SdkDashboardContributionInput,
    type SdkBridgeCrossHost,
    registerSdkBridge,
    getSdkBridge,
    clearSdkBridge,
    assertBridgeAuthorized,
    assertBridgeGeneration,
} from './bridge.js';
export { createPluginSdk, type PluginSdk } from './plugin/context.js';
export {
    type DashboardContribution,
    type DashboardContributionKind,
    type DashboardScope,
    registerDashboardContribution,
    revokeDashboardContribution,
    listDashboardContributions,
} from './dashboard/contributions.js';
export {
    type DataTypeDefinition,
    registerDataType,
    accessData,
    exportData,
    deleteData,
} from './data.js';
/** Core-private adapter — not part of the publishable @lunedusk/zene-sdk package. */
export {
    installPluginSdkBridge,
    uninstallPluginSdkBridge,
} from './coreBridgeFactory.js';
