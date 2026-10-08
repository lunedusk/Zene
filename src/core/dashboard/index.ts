export {
    registerContribution,
    revokeContribution,
    revokeAllForPlugin,
    listContributions,
    getContribution,
    resolveContributionByApiPath,
    clearAllContributions,
    type DashboardContributionRecord,
    type DashboardContributionKind,
    type DashboardScope,
    type ContributionRegistrationState,
} from './contributionRegistry.js';

export {
    putDashboardSession,
    getDashboardSession,
    getDashboardSessionRecord,
    establishDashboardSession,
    revokeDashboardSession,
    clearDashboardSession,
    logoutDashboardSession,
    touchDashboardSession,
    principalHasBits,
    assertDashboardAuthorized,
    createOpaqueSessionId,
    createCsrfSecret,
    hashSessionId,
    sessionCookieHeader,
    DASHBOARD_SESSION_COOKIE,
    DashboardAuthError,
    type DashboardPrincipal,
    type DashboardAuthContext,
    type DashboardSessionRecord,
    type DashboardAuthProvider,
} from './authContext.js';

export {
    beginOAuthTransaction,
    consumeOAuthCallback,
    exchangeAuthorizationCode,
    injectDiscordTokenExchange,
    defaultDiscordTokenExchange,
    clearOAuthTransactions,
    createCodeVerifier,
    createCodeChallenge,
    type OAuthTransaction,
    type DiscordTokenResponse,
    type DiscordTokenExchangeFn,
} from './oauth.js';

export {
    issueCsrfToken,
    validateCsrfToken,
    validateOrigin,
} from './csrf.js';

export {
    authorizeDashboardRequest,
    type AuthorizeDashboardRequestInput,
    type AuthorizeDashboardRequestResult,
} from './authorization.js';

export {
    createDashboardContributionRouter,
    registerContributionHandler,
    clearContributionHandlers,
    listApiContributionPaths,
    type ContributionHandler,
} from './apiRouter.js';

export {
    listPrivacyCategories,
    requestDataExport,
    requestDataDeletion,
} from './privacy.js';

export {
    dashboardSecurityHeaders,
    corsAllowlist,
} from './securityHeaders.js';

export { rateLimit, clearRateLimits } from './rateLimit.js';

export {
    establishCoreSessionFromLogin,
    ensureCoreSessionForAdapterIdentity,
    logoutCoreDashboardSession,
    revokeCoreDashboardSession,
    type LoginIdentityInput,
    type EstablishedCoreLogin,
} from './sessionAdapter.js';

export {
    establishRealtimeConnection,
    subscribeRealtime,
    assertRealtimeGeneration,
    closeRealtimeConnection,
    invalidateRealtimeForSession,
    invalidateRealtimeForPlugin,
    getRealtimeConnection,
    listRealtimeSubscriptions,
    clearAllRealtime,
    DashboardRealtimeError,
    type RealtimeConnection,
    type RealtimeSubscription,
    type RealtimeErrorCode,
} from './realtime.js';

export {
    listFrontendContributions,
    getFrontendContribution,
    registerContributionActionHandler,
    clearContributionActionHandlers,
    invokeContributionAction,
    type FrontendContributionView,
    type ContributionActionHandler,
} from './contributionFrontend.js';
