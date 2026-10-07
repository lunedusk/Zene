export type {
    ProviderCategoryId,
    ProviderRegistration,
    ProviderEligibility,
    ProviderEligibilityReason,
    ProviderSelectionResult,
    ProviderSelectionSuccess,
    ProviderSelectionFailure,
    ProviderDeclaration,
} from './types.js';
export type {
    KnownProviderCategory,
    KnownProviderImplementations,
} from './categories.js';
export { ProviderRegistry, providerRegistry } from './registry.js';
export {
    DEPENDENCY_INSTALL_CATEGORY,
    seedDependencyInstallProviders,
    selectDependencyInstallProvider,
} from './dependencyInstall.js';

export {
    createProviderBinding,
    getProviderBinding,
    assertProviderBindingUsable,
    invalidateBindingsForRuntime,
    invalidateBindingsForPlugin,
    type ProviderBindingIdentity,
} from './binding.js';

export {
    setAuthenticatedProviderDeclarations,
    getAuthenticatedProviderDeclarations,
    assertProviderRegistrationAllowed,
    type AuthenticatedProviderDeclaration,
} from './declarations.js';

export {
    assertProviderFullyAuthorized,
    isProviderCategoryAuthorized,
    allowProviderCategory,
    clearProviderCategoryAllowlist,
    PRIVILEGED_PROVIDER_CATEGORIES,
} from './authorization.js';
