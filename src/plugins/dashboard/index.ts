import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { CUSTOM_BITS_TO_REGISTER } from './src/lib/bits.js';
import type PermissionsHandler from '../permissions/src/handlers/manager.js';
import type DashboardAnalyticsHandler from './src/handlers/analytics.js';

import { featureRequirements } from '#core/manager/featureRequirements.js';

export default class DashboardPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id: 'dashboard',
        name: 'Dashboard API',
        version: '1.2.0',
        description: 'REST API surface consumed by the web dashboard.',
        dependencies: ['dash-data', 'api', 'permissions', 'token'],
        zene_version: '>=0.5.4',
        node_version: '>=20',
        priority: 10,
    };

    public async onSetup(): Promise<void> {
        this.registerDashboardFeatureRequirements();
        const perms = this.heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
        if (perms) {
            const ranks: Record<string, number> = {
                'plugin.dashboard.members.notes': 50,
                'plugin.dashboard.infractions.manage': 120,
            };
            for (const { bit, description } of CUSTOM_BITS_TO_REGISTER) {
                await perms.registerBit(bit, description, this.heart.id, ranks[bit]);
            }
            this.log.info(`Registered ${CUSTOM_BITS_TO_REGISTER.length} custom dashboard permission bit(s).`);
        } else {
            this.log.warn('permissions handler unavailable during onSetup — custom bits were not registered.');
        }
    }

    public async onEnable(): Promise<void> {
        this.log.info('Dashboard API is live.');

        try {
            const { bootstrapPhase4 } = await import('./src/lib/bootstrapPhase4.js');
            const result = await bootstrapPhase4({
                cutoverPhase: 2,
                betterAuth: {
                    enabled: false,
                },
            });
            this.log.info(
                `Phase4 bootstrap: schema=${result.schema.ok} rateLimitRedis=${result.rateLimitRedis} betterAuth=${result.betterAuth.ok} cutover=${result.cutoverPhase}`,
            );
            if (!result.schema.ok) {
                this.log.warn(`Better Auth schema ensure: ${result.schema.message ?? 'failed'}`);
            }
        } catch (e) {
            this.log.warn(`Phase4 bootstrap deferred: ${e instanceof Error ? e.message : 'unknown'}`);
        }

        try {
            const perms = this.heart.system.handler.$get('permissions', 'manager') as
                | PermissionsHandler
                | undefined;
            if (perms) {
                const { bindRealtimeActorRefreshToPermissions, wrapPermissionsInvalidateUser } =
                    await import('./src/lib/realtime/permissionsManagerBinding.js');
                bindRealtimeActorRefreshToPermissions(async (userId, guildId) => {
                    return perms.resolve(userId, guildId);
                });
                const originalInvalidate = perms.invalidateUser.bind(perms);
                perms.invalidateUser = wrapPermissionsInvalidateUser(originalInvalidate);
                this.log.info('Realtime auth bound to PermissionsManager resolve/invalidate');
            } else {
                this.log.warn('Permissions handler unavailable — realtime auth refresh not bound');
            }
        } catch (e) {
            this.log.warn(
                `Realtime PermissionsManager binding deferred: ${e instanceof Error ? e.message : 'unknown'}`,
            );
        }

        try {
            this.heart.system.events.on(
                'command:executed',
                (payload: { pluginId: string; commandName: string }) => {
                    const analytics = this.heart.system.handler.$get('dashboard', 'analytics') as
                        | DashboardAnalyticsHandler
                        | undefined;
                    void analytics?.recordCommand(payload.pluginId, payload.commandName);
                },
            );
        } catch (e) {
            this.log.debug(`command:executed event not available — analytics will rely on direct handler calls. (${(e as Error).message})`);
        }
    }

    public async onDisable(): Promise<void> {
        this.log.info('Dashboard API shutting down.');
    }
    private registerDashboardFeatureRequirements(): void {
        featureRequirements.register({
            id: 'dashboard.http',
            pluginId: 'dashboard',
            description: 'Dashboard admin HTTP routes',
            permissions: [],
        });
        featureRequirements.register({
            id: 'dashboard.discordOAuth',
            pluginId: 'dashboard',
            description: 'Dashboard Discord identity',
            intents: ['Guilds'],
            permissions: [],
        });
    }
}
