import { SDK_VERSION } from '../version.js';
import { getSdkBridge, assertBridgeAuthorized, type SdkBridge } from '../bridge.js';
import type {
    PluginIdentity,
    SdkSessionContext,
    SdkRuntimeRequirements,
    SdkDependencyDeclaration,
} from '../types.js';
import { SdkError } from '../types.js';

export interface PluginSdk {
    readonly identity: PluginIdentity;
    readonly session: SdkSessionContext;
    readonly sdkVersion: typeof SDK_VERSION;
    readonly runtimeRequirements: SdkRuntimeRequirements;
    readonly dependencies: readonly SdkDependencyDeclaration[];
    log: SdkBridge['log'];
    config: SdkBridge['config'];
    events: SdkBridge['events'];
    providers: SdkBridge['providers'];
    resources: SdkBridge['resources'];
    data: SdkBridge['data'];
    dashboard: SdkBridge['dashboard'];
    http: SdkBridge['http'];
    commands: SdkBridge['commands'];
    crossHost: SdkBridge['crossHost'];
    scheduler: SdkBridge['scheduler'];
    cooldowns: SdkBridge['cooldowns'];
    permissions: SdkBridge['permissions'];
    features: SdkBridge['features'];
    locale: SdkBridge['locale'];
    emoji: SdkBridge['emoji'];
    cache: SdkBridge['cache'];
    diagnostics: SdkBridge['diagnostics'];
    guild: SdkBridge['guild'];
}

export function createPluginSdk(
    identity: PluginIdentity,
    session?: { readonly runtimeId: string; readonly generation: number },
): PluginSdk {
    const bridge = session
        ? getSdkBridge(identity.id, session.runtimeId, session.generation)
        : getSdkBridge(identity.id);
    if (bridge.session.pluginId !== identity.id) {
        throw new SdkError({
            code: 'SDK_IDENTITY_MISMATCH',
            message: 'Plugin identity does not match bridge session',
        });
    }
    assertBridgeAuthorized(bridge, 'createPluginSdk');
    return {
        identity,
        session: bridge.session,
        sdkVersion: SDK_VERSION,
        runtimeRequirements: bridge.runtimeRequirements,
        dependencies: bridge.dependencies,
        log: bridge.log,
        config: bridge.config,
        events: bridge.events,
        providers: bridge.providers,
        resources: bridge.resources,
        data: bridge.data,
        dashboard: bridge.dashboard,
        http: bridge.http,
        commands: bridge.commands,
        crossHost: bridge.crossHost,
        scheduler: bridge.scheduler,
        cooldowns: bridge.cooldowns,
        permissions: bridge.permissions,
        features: bridge.features,
        locale: bridge.locale,
        emoji: bridge.emoji,
        cache: bridge.cache,
        diagnostics: bridge.diagnostics,
        guild: bridge.guild,
    };
}
