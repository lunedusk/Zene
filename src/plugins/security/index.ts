import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { featureRequirements } from '#core/manager/featureRequirements.js';
import { PermissionFlagsBits } from 'discord.js';
import type FreezeControllerHandler from './src/handlers/freezeController.js';
import type ModerationBridgeHandler from './src/handlers/moderationBridge.js';
import type ViolationTrackerHandler from './src/handlers/violationTracker.js';
import { SECURITY_BITS_TO_REGISTER } from './src/lib/bits.js';

export default class SecurityPlugin extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'security',
        name: 'Security',
        version: '1.6.0',
        description:
            'Server-specific moderation, AutoMod, anti-nuke, verification, and raid protection.',
        author: 'Lunedusk',
        dependencies: ['core', 'permissions'],
        zene_version: '>=0.5.4',
        node_version: '>=20',
        priority: 20,
        emoji: '🛡️',
        nodeDependencies: {
            'hash-wasm': '^4.12.0',
            'canvas': '^3.1.0',
        },
    };

    public async onSetup(): Promise<void> {
        this.registerFeatureRequirements();

        try {
            for (const entry of SECURITY_BITS_TO_REGISTER) {
                await this.heart.permissions.registerBit(
                    entry.bit,
                    entry.description,
                    this.manifest.id,
                    entry.rank,
                );
            }
            this.log.info(`Registered ${SECURITY_BITS_TO_REGISTER.length} security permission bit(s).`);
        } catch (err: unknown) {
            this.log.warn(
                `Bit registration issue: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    public async onEnable(): Promise<void> {
        this.scheduleTempbans();
        this.scheduleInvitePauseRefresh();
        this.scheduleStrikeExpiry();
        this.scheduleTempRoles();
        this.log.info('Security plugin is live (Phase 7: tempRole punishments + attachment rate).');
    }

    public async onDisable(): Promise<void> {
        this.log.info('Security plugin shutting down.');
    }


    private scheduleTempRoles(): void {
        const scheduler = this.heart.system.scheduler;
        const taskName = 'security.processTempRoles';

        scheduler.registerTask(taskName, async () => {
            const handler = this.heart.system.handler.$get<
                import('./src/handlers/tempRole.js').default
            >('security', 'tempRole');
            if (!handler) return;
            try {
                const n = await handler.processExpired();
                if (n > 0) this.log.info(`Removed ${n} expired temp role(s).`);
            } catch (err: unknown) {
                this.log.warn(
                    `Temp role processor error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        });

        void scheduler.every(taskName, { minutes: 1 }).catch((err: unknown) => {
            this.log.debug(
                `Temp role schedule: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
    }

    private scheduleTempbans(): void {
        const scheduler = this.heart.system.scheduler;
        const taskName = 'security.processTempbans';

        scheduler.registerTask(taskName, async () => {
            const bridge = this.heart.system.handler.$get<ModerationBridgeHandler>(
                'security',
                'moderationBridge',
            );
            if (!bridge) return;
            try {
                const n = await bridge.processDueTempbans();
                if (n > 0) this.log.info(`Processed ${n} expired tempban(s).`);
            } catch (err: unknown) {
                this.log.warn(
                    `Tempban processor error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        });

        void scheduler.every(taskName, { minutes: 1 }).catch((err: unknown) => {
            this.log.debug(
                `Tempban schedule: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
    }

    private scheduleInvitePauseRefresh(): void {
        const scheduler = this.heart.system.scheduler;
        const taskName = 'security.refreshInvitePause';

        scheduler.registerTask(taskName, async () => {
            const freeze = this.heart.system.handler.$get<FreezeControllerHandler>(
                'security',
                'freezeController',
            );
            if (!freeze) return;
            try {
                const n = await freeze.refreshInvitePauses();
                if (n > 0) this.log.info(`Refreshed invite pause on ${n} guild(s).`);
            } catch (err: unknown) {
                this.log.warn(
                    `Invite pause refresh error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        });

        void scheduler.every(taskName, { hours: 1 }).catch((err: unknown) => {
            this.log.debug(
                `Invite pause schedule: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
    }

    private scheduleStrikeExpiry(): void {
        const scheduler = this.heart.system.scheduler;
        const taskName = 'security.strikeExpiry';

        scheduler.registerTask(taskName, async () => {
            const tracker = this.heart.system.handler.$get<ViolationTrackerHandler>(
                'security',
                'violationTracker',
            );
            if (!tracker) return;
            try {
                const n = await tracker.processStrikeExpiry(7, 1);
                if (n > 0) this.log.info(`Strike expiry decayed ${n} user(s).`);
            } catch (err: unknown) {
                this.log.warn(
                    `Strike expiry error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        });

        void scheduler.every(taskName, { hours: 6 }).catch((err: unknown) => {
            this.log.debug(
                `Strike expiry schedule: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
    }

    private registerFeatureRequirements(): void {
        featureRequirements.register({
            id: 'security.moderation',
            pluginId: this.manifest.id,
            description: 'Security moderation actions (ban/kick/timeout)',
            intents: ['GuildMembers', 'GuildModeration'],
            permissions: [
                PermissionFlagsBits.BanMembers,
                PermissionFlagsBits.KickMembers,
                PermissionFlagsBits.ModerateMembers,
            ],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.lockdown',
            pluginId: this.manifest.id,
            description: 'Lockdown / freeze (channel locks + invite pause)',
            intents: [],
            permissions: [
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageGuild,
                PermissionFlagsBits.ManageMessages,
            ],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.snipe',
            pluginId: this.manifest.id,
            description: 'Snipe deleted messages',
            intents: ['GuildMessages', 'MessageContent'],
            permissions: [],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.automod',
            pluginId: this.manifest.id,
            description: 'AutoMod message filters (requires Message Content intent)',
            intents: ['GuildMessages', 'MessageContent'],
            permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.antinuke',
            pluginId: this.manifest.id,
            description: 'Anti-nuke audit monitoring',
            intents: ['GuildModeration'],
            permissions: [
                PermissionFlagsBits.ViewAuditLog,
                PermissionFlagsBits.BanMembers,
                PermissionFlagsBits.KickMembers,
                PermissionFlagsBits.ManageRoles,
                PermissionFlagsBits.ModerateMembers,
            ],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.raid',
            pluginId: this.manifest.id,
            description: 'Raid join-rate protection — threshold on joins, optional quarantine role',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.KickMembers],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.verify',
            pluginId: this.manifest.id,
            description: 'Canvas captcha verification gate for new members',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.tempRole',
            pluginId: this.manifest.id,
            description: 'Temporary role grants that expire on a schedule',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ManageRoles],
            softDisabled: false,
        });
        featureRequirements.register({
            id: 'security.strikes',
            pluginId: this.manifest.id,
            description: 'Strike / violation point tracking and automatic follow-up actions',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ModerateMembers],
            softDisabled: false,
        });
    }
}
