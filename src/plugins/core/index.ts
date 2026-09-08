import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { ActivityType, type PresenceStatusData, type Client, PermissionFlagsBits } from 'discord.js';
import { guildGate } from '#core/manager/guildGate.js';
import { guildAccess } from '#core/manager/guildAccess.js';
import { guildLocale } from '#core/manager/guildLocale.js';
import { resolveCoreDataBackend } from '#core/database/backendSelector.js';
import {
    featureRequirements
} from '#core/manager/featureRequirements.js';

type ConfigActivityType = 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING' | 'CUSTOM';

interface ActivityConfig {
    name: string;
    type: ConfigActivityType;
    url?: string;
}

interface PresenceConfig {
    enabled: boolean;
    updateIntervalSeconds: number;
    status: PresenceStatusData;
    activities: ActivityConfig[];
    dataBackend?: { engine?: string; alias?: string };
    guildGate?: { enabled?: boolean };
    guildAccess?: {
        enabled?: boolean;
        conflictPriority?: 'blacklist' | 'whitelist';
        emptyWhitelistMeans?: 'allow_all' | 'deny_all';
        leaveOnBoot?: boolean;
        leaveOnJoin?: boolean;
        allowOwner?: boolean;
        leaveReason?: string;
    };
    guildLocale?: { enabled?: boolean };
    guildLangFiles?: { enabled?: boolean };
    help?: {
        filterByPermissions?: boolean;
        maxCharsPerPage?: number;
        ephemeral?: boolean;
    };
}

export default class Core extends BasePlugin {
    public readonly manifest: PluginManifest = {
        id: 'core',
        name: 'Core',
        version: '1.2.0',
        author: 'Lunedusk',
        zene_version: '>=0.5.4',
        node_version: '>=20',
        dependencies: ['api', 'permissions']
    };

    private config!: PresenceConfig;
    private rotationTimer: NodeJS.Timeout | null = null;
    private currentIndex = 0;
    private gatesOk = false;

    private readonly ActivityTypeMap: Record<string, ActivityType> = {
        PLAYING: ActivityType.Playing,
        STREAMING: ActivityType.Streaming,
        LISTENING: ActivityType.Listening,
        WATCHING: ActivityType.Watching,
        COMPETING: ActivityType.Competing,
        CUSTOM: ActivityType.Custom
    };

    public async onSetup(): Promise<void> {
        this.log.info('Fetching presence configuration...');

        const rawConfig = this.heart.assets.config.get<PresenceConfig>('core');

        if (!rawConfig) {
            this.log.warn('No core config found. Presence engine disabled; dataBackend soft-resolve.');
            this.config = {
                enabled: false,
                updateIntervalSeconds: 0,
                status: 'online',
                activities: [],
                guildGate: { enabled: true },
                guildAccess: { enabled: true },
            };
        } else {
            this.config = rawConfig;
        }

        const live = () => this.heart.assets.config.get<PresenceConfig>('core') ?? this.config;
        const dbCfg = live()?.dataBackend;

        try {
            const resolved = resolveCoreDataBackend({
                engine: dbCfg?.engine,
                alias: dbCfg?.alias,
            });
            await guildGate.init({ engine: resolved.engine, alias: resolved.alias });
            this.gatesOk = true;
        } catch (e1) {
            this.log.warn(`GuildGate init soft-failed: ${(e1 as Error).message}`);
            this.gatesOk = false;
        }

        try {
            const resolved = resolveCoreDataBackend({
                engine: dbCfg?.engine,
                alias: dbCfg?.alias,
            });
            await guildAccess.init({ engine: resolved.engine, alias: resolved.alias });
        } catch (e) {
            this.log.warn(`GuildAccess init soft-failed: ${(e as Error).message}`);
        }

        try {
            const resolved = resolveCoreDataBackend({
                engine: dbCfg?.engine,
                alias: dbCfg?.alias,
            });
            await guildLocale.init({ engine: resolved.engine, alias: resolved.alias });
        } catch (e) {
            this.log.warn(`GuildLocale init soft-failed: ${(e as Error).message}`);
        }
    }

    public async onEnable(): Promise<void> {
        const client = (this.heart as any).client as Client<true>;
        if (!client) {
            throw new Error('Fatal: Discord Client is not accessible on the Heart object.');
        }

        this.registerCoreFeatureRequirements();
        featureRequirements.warnMissingIntents(client);

        await this.enforceAccessOnBoot(client);

        const live = this.heart.assets.config.get<PresenceConfig>('core') ?? this.config;
        if (!live?.enabled || !live?.activities?.length) {
            this.log.warn('Presence engine is disabled or has no activities configured. Idling.');
            return;
        }
        this.config = live;

        this.applyPresence(client);

        if (this.config.activities.length > 1) {
            const intervalMs = Math.max(this.config.updateIntervalSeconds * 1000, 15000);
            this.rotationTimer = setInterval(() => {
                this.currentIndex = (this.currentIndex + 1) % this.config.activities.length;
                this.applyPresence(client);
            }, intervalMs);
            this.log.info(
                `Presence rotation engine active. Cycling ${this.config.activities.length} activities every ${intervalMs / 1000}s.`
            );
        } else {
            this.log.info('Static presence locked and applied.');
        }
    }

    public async onDisable(): Promise<void> {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
            this.log.debug('Rotation loop terminated gracefully.');
        }

        const client = (this.heart as any).client as Client<true>;
        if (client && this.config?.enabled) {
            client.user.setPresence({ activities: [], status: 'online' });
            this.log.info('Presence purged from Discord Gateway.');
        }
    }

    private async enforceAccessOnBoot(client: Client<true>): Promise<void> {
        if (!guildAccess.isReady()) return;
        const policy = guildAccess.getPolicy();
        if (!policy.enabled || !policy.leaveOnBoot) return;

        const guilds = [...client.guilds.cache.values()];
        for (const guild of guilds) {
            if (guildAccess.isGuildAllowed(guild.id)) continue;
            try {
                this.log.warn(`GuildAccess leaving guild ${guild.id} (${guild.name}) on boot: ${policy.leaveReason}`);
                await guild.leave();
            } catch (err) {
                this.log.error(`GuildAccess boot leave failed for ${guild.id}: ${(err as Error).message}`);
            }
        }
    }

    private applyPresence(client: Client<true>): void {
        const live = this.heart.assets.config.get<PresenceConfig>('core') ?? this.config;
        if (!live?.activities?.length) return;
        this.config = live;
        const activity = this.config.activities[this.currentIndex % this.config.activities.length];
        const rawType = activity.type?.toUpperCase() || 'PLAYING';
        const typeEnum = this.ActivityTypeMap[rawType] ?? ActivityType.Playing;

        try {
            client.user.setPresence({
                status: this.config.status ?? 'online',
                activities: [
                    {
                        name: activity.name,
                        type: typeEnum as any,
                        url: typeEnum === ActivityType.Streaming ? activity.url : undefined
                    }
                ]
            });
            this.log.debug(`Presence updated -> [${rawType}] ${activity.name}`);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Failed to update presence to Discord Gateway: ${err.message}`);
        }
    }
    private registerCoreFeatureRequirements(): void {
        featureRequirements.register({
            id: 'core.guildAccess.ownerAuthorize',
            pluginId: 'core',
            description: 'Owner-authorize on bot invite (audit log)',
            permissions: [PermissionFlagsBits.ViewAuditLog],
        });
        featureRequirements.register({
            id: 'core.guildAccess.leavePolicy',
            pluginId: 'core',
            description: 'Guild leave blacklist/whitelist enforcement',
            permissions: [],
        });
        featureRequirements.register({
            id: 'core.guildGate',
            pluginId: 'core',
            description: 'Guild / plugin soft gate checks',
            permissions: [],
        });
        featureRequirements.register({
            id: 'core.moderation.ban',
            pluginId: 'core',
            description: 'Ban and unban members in configured guilds',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.BanMembers],
        });
        featureRequirements.register({
            id: 'core.moderation.kick',
            pluginId: 'core',
            description: 'Kick members from configured guilds',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.KickMembers],
        });
        featureRequirements.register({
            id: 'core.moderation.timeout',
            pluginId: 'core',
            description: 'Timeout members or remove an existing timeout',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ModerateMembers],
        });
        featureRequirements.register({
            id: 'core.moderation.roles',
            pluginId: 'core',
            description: 'Add or remove roles on members',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ManageRoles],
        });
        featureRequirements.register({
            id: 'core.moderation.nick',
            pluginId: 'core',
            description: 'Set or clear member nicknames',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ManageNicknames],
        });
        featureRequirements.register({
            id: 'core.handlers.channelActions',
            pluginId: 'core',
            description: 'Channel lock / unlock (SendMessages overwrites)',
            permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
        });
        featureRequirements.register({
            id: 'core.handlers.messageActions',
            pluginId: 'core',
            description: 'Message send / delete / purge',
            permissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
            intents: ['Guilds', 'GuildMessages'],
        });
        featureRequirements.register({
            id: 'core.handlers.voiceActions',
            pluginId: 'core',
            description: 'Voice mute / deafen / move',
            permissions: [PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers],
            intents: ['GuildVoiceStates'],
        });
        featureRequirements.register({
            id: 'core.handlers.emojiActions',
            pluginId: 'core',
            description: 'Guild emoji listing / management',
            permissions: [PermissionFlagsBits.ManageGuildExpressions],
            intents: ['Guilds'],
        });
        featureRequirements.register({
            id: 'core.handlers.guildActions',
            pluginId: 'core',
            description: 'Guild settings / invites / metadata',
            permissions: [PermissionFlagsBits.ManageGuild],
            intents: ['Guilds'],
        });
        featureRequirements.register({
            id: 'core.handlers.memberActions',
            pluginId: 'core',
            description: 'Member resolve and member-scoped actions',
            intents: ['GuildMembers'],
            permissions: [PermissionFlagsBits.ViewChannel],
        });
        featureRequirements.register({
            id: 'core.handlers.announce',
            pluginId: 'core',
            description: 'Announce / broadcast messages',
            permissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.MentionEveryone],
        });
        featureRequirements.register({
            id: 'core.presence',
            pluginId: 'core',
            description: 'Presence / activity rotation',
            permissions: [],
        });
        featureRequirements.register({
            id: 'core.commands.admin',
            pluginId: 'core',
            description: 'Admin slash surface (metrics, gate, access, fleet)',
            permissions: [],
        });
    }
}
