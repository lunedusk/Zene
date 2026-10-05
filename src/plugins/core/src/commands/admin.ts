import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import {
    SlashCommandBuilder,
    AttachmentBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    MessageFlags,
    InteractionContextType
} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import type { ContainerSpec } from '#core/builders/componentsv2Builder/types.js';
import { Cooldown } from '#core/decorators/cooldown.js';
import { guildGate } from '#core/manager/guildGate.js';
import type PermissionsHandler from '../../../permissions/src/handlers/manager.js';
import { HelpUtils } from '../utils/helpUtils.js';
import { reloadEnvFromDisk } from '#core/helpers/envReload.js';
import { listRegisteredCaches, getRegisteredCache } from '#core/helpers/cache.js';
import { actorFromUser } from '#core/audit/actor.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { guildAccess } from '#core/manager/guildAccess.js';
import { configManager } from '#core/manager/config.js';
import { secrets } from '#core/helpers/secretManager.js';
import { BOT_OWNER_BIT } from '../lib/bits.js';

type AdminMode = 'standalone' | 'sharded' | 'crosshost';

function detectAdminMode(): AdminMode {
    if (secrets.getBoolean('CROSS_HOST', false)) return 'crosshost';
    if (secrets.getBoolean('isSharded', false)) return 'sharded';
    return 'standalone';
}

export default class AdminCommand extends BaseCommand {
    public readonly data = ((): SlashCommandBuilder => {
        const mode = detectAdminMode();
        let b = new SlashCommandBuilder()
            .setName('admin')
            .setDescription(this.t('commands.admin.description'))
            .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
            .addSubcommand(sub =>
                sub
                    .setName('restart')
                    .setDescription(this.t('commands.admin.restart.description'))
                    .addStringOption(opt =>
                        opt
                            .setName('reason')
                            .setDescription(this.t('commands.admin.restart.reasonDescription'))
                            .setRequired(false)
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('bit-holders')
                    .setDescription(this.t('commands.admin.bitHolders.description'))
                    .addStringOption(opt =>
                        opt
                            .setName('bit')
                            .setDescription(this.t('commands.admin.bitHolders.bitDescription'))
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addIntegerOption(opt =>
                        opt
                            .setName('page')
                            .setDescription(this.t('commands.admin.bitHolders.pageDescription'))
                            .setRequired(false)
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('metrics')
                    .setDescription(this.t('commands.admin.metrics.description'))
            )
            .addSubcommand(sub =>
                sub
                    .setName('status')
                    .setDescription(this.t('commands.admin.status.description'))
            )
            .addSubcommandGroup(group =>
                group
                    .setName('reload')
                    .setDescription('Reload framework assets')
                    .addSubcommand(sub =>
                        sub
                            .setName('config')
                            .setDescription(this.t('commands.admin.reload.configDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('file')
                                    .setDescription(this.t('commands.admin.reload.fileDescription'))
                                    .setAutocomplete(true)
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('lang')
                            .setDescription(this.t('commands.admin.reload.langDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('namespace')
                                    .setDescription(this.t('commands.admin.reload.namespaceDescription'))
                                    .setAutocomplete(true)
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub.setName('emoji').setDescription(this.t('commands.admin.reload.emojiDescription'))
                    )
                    .addSubcommand(sub =>
                        sub.setName('env').setDescription(this.t('commands.admin.reload.envDescription'))
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('plugin')
                            .setDescription(this.t('commands.admin.reload.pluginDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('id')
                                    .setDescription(this.t('commands.admin.reload.idDescription'))
                                    .setAutocomplete(true)
                                    .setRequired(true)
                            )
                    )
            )
            .addSubcommandGroup(group =>
                group
                    .setName('cache')
                    .setDescription('Manage memory caches')
                    .addSubcommand(sub =>
                        sub.setName('list').setDescription(this.t('commands.admin.cache.listDescription'))
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('pop')
                            .setDescription(this.t('commands.admin.cache.popDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('target')
                                    .setDescription(this.t('commands.admin.cache.targetDescription'))
                                    .setAutocomplete(true)
                                    .setRequired(true)
                            )
                    )
            )
            .addSubcommandGroup(group =>
                group
                    .setName('gate')
                    .setDescription('Manage guild and plugin access gates')
                    .addSubcommand(sub =>
                        sub
                            .setName('guild-block')
                            .setDescription(this.t('commands.admin.gate.guildBlockDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('guild')
                                    .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('reason')
                                    .setDescription(this.t('commands.admin.gate.reasonDescription'))
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('guild-unblock')
                            .setDescription(this.t('commands.admin.gate.guildUnblockDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('guild')
                                    .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub.setName('guild-list').setDescription(this.t('commands.admin.gate.guildListDescription'))
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('plugin-block')
                            .setDescription(this.t('commands.admin.gate.pluginBlockDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('plugin')
                                    .setDescription(this.t('commands.admin.gate.pluginIdDescription'))
                                    .setAutocomplete(true)
                                    .setRequired(true)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('guild')
                                    .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('reason')
                                    .setDescription(this.t('commands.admin.gate.reasonDescription'))
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('plugin-unblock')
                            .setDescription(this.t('commands.admin.gate.pluginUnblockDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('plugin')
                                    .setDescription(this.t('commands.admin.gate.pluginIdDescription'))
                                    .setAutocomplete(true)
                                    .setRequired(true)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('guild')
                                    .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('plugin-list')
                            .setDescription(this.t('commands.admin.gate.pluginListDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('guild')
                                    .setDescription(this.t('commands.admin.gate.guildIdDescription'))
                                    .setRequired(false)
                            )
                    )
            )
            .addSubcommandGroup(group =>
                group
                    .setName('access')
                    .setDescription(this.t('commands.admin.access.title'))
                    .addSubcommand(sub =>
                        sub
                            .setName('blacklist-add')
                            .setDescription(this.t('commands.admin.access.blacklistAddDescription'))
                            .addStringOption(opt =>
                                opt.setName('guild').setDescription('Guild id').setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt.setName('reason').setDescription('Optional reason').setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('blacklist-remove')
                            .setDescription(this.t('commands.admin.access.blacklistRemoveDescription'))
                            .addStringOption(opt =>
                                opt.setName('guild').setDescription('Guild id').setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub.setName('blacklist-list').setDescription(this.t('commands.admin.access.blacklistListDescription'))
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('whitelist-add')
                            .setDescription(this.t('commands.admin.access.whitelistAddDescription'))
                            .addStringOption(opt =>
                                opt.setName('guild').setDescription('Guild id').setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt.setName('reason').setDescription('Optional reason').setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('whitelist-remove')
                            .setDescription(this.t('commands.admin.access.whitelistRemoveDescription'))
                            .addStringOption(opt =>
                                opt.setName('guild').setDescription('Guild id').setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub.setName('whitelist-list').setDescription(this.t('commands.admin.access.whitelistListDescription'))
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('check')
                            .setDescription(this.t('commands.admin.access.checkDescription'))
                            .addStringOption(opt =>
                                opt.setName('guild').setDescription('Guild id').setRequired(false)
                            )
                    )
            )
            .addSubcommandGroup(group =>
                group
                    .setName('audit')
                    .setDescription('View system audit logs')
                    .addSubcommand(sub =>
                        sub
                            .setName('list')
                            .setDescription(this.t('commands.admin.audit.listDescription'))
                            .addIntegerOption(opt =>
                                opt
                                    .setName('limit')
                                    .setDescription(this.t('commands.admin.audit.limitDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('actor')
                                    .setDescription(this.t('commands.admin.audit.actorDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('action')
                                    .setDescription(this.t('commands.admin.audit.actionDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('outcome')
                                    .setDescription(this.t('commands.admin.audit.outcomeDescription'))
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('get')
                            .setDescription(this.t('commands.admin.audit.getDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('id')
                                    .setDescription(this.t('commands.admin.audit.idDescription'))
                                    .setRequired(true)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('export')
                            .setDescription(this.t('commands.admin.audit.exportDescription'))
                    )
            )
            .addSubcommandGroup(group =>
                group
                    .setName('error')
                    .setDescription('View system errors')
                    .addSubcommand(sub =>
                        sub
                            .setName('list')
                            .setDescription(this.t('commands.admin.errors.listDescription'))
                            .addIntegerOption(opt =>
                                opt
                                    .setName('limit')
                                    .setDescription(this.t('commands.admin.errors.limitDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('code')
                                    .setDescription(this.t('commands.admin.errors.codeDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('category')
                                    .setDescription(this.t('commands.admin.errors.categoryDescription'))
                                    .setRequired(false)
                            )
                            .addStringOption(opt =>
                                opt
                                    .setName('severity')
                                    .setDescription(this.t('commands.admin.errors.severityDescription'))
                                    .setRequired(false)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('get')
                            .setDescription(this.t('commands.admin.errors.getDescription'))
                            .addStringOption(opt =>
                                opt
                                    .setName('id')
                                    .setDescription(this.t('commands.admin.errors.idDescription'))
                                    .setRequired(true)
                            )
                    )
                    .addSubcommand(sub =>
                        sub
                            .setName('export')
                            .setDescription(this.t('commands.admin.errors.exportDescription'))
                    )
            );

        if (mode === 'sharded' || mode === 'crosshost') {
            b = b
                .addSubcommand(sub =>
                    sub
                        .setName('shard-info')
                        .setDescription(this.t('commands.admin.shardInfo.description'))
                        .addIntegerOption(opt =>
                            opt
                                .setName('shard')
                                .setDescription(this.t('commands.admin.shardInfo.shardDescription'))
                                .setRequired(false)
                                .setAutocomplete(true)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('guild')
                                .setDescription(this.t('commands.admin.shardInfo.guildDescription'))
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('shards')
                        .setDescription(this.t('commands.admin.shards.description'))
                        .addIntegerOption(opt =>
                            opt
                                .setName('page')
                                .setDescription(this.t('commands.admin.shards.pageDescription'))
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('guild-shard')
                        .setDescription(this.t('commands.admin.guildShard.description'))
                        .addStringOption(opt =>
                            opt
                                .setName('guild')
                                .setDescription(this.t('commands.admin.guildShard.guildDescription'))
                                .setRequired(true)
                        )
                );
        }

        if (mode === 'crosshost') {
            b = b
                .addSubcommand(sub =>
                    sub
                        .setName('fleet-info')
                        .setDescription(this.t('commands.admin.fleetInfo.description'))
                )
                .addSubcommand(sub =>
                    sub
                        .setName('fleet-restart')
                        .setDescription(this.t('commands.admin.fleetRestart.description'))
                        .addStringOption(opt =>
                            opt
                                .setName('reason')
                                .setDescription(this.t('commands.admin.restart.reasonDescription'))
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('worker-restart')
                        .setDescription(this.t('commands.admin.workerRestart.description'))
                        .addStringOption(opt =>
                            opt
                                .setName('machine')
                                .setDescription(this.t('commands.admin.workerRestart.machineDescription'))
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('reason')
                                .setDescription(this.t('commands.admin.restart.reasonDescription'))
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('shard-shift')
                        .setDescription(this.t('commands.admin.shardShift.description'))
                        .addIntegerOption(opt =>
                            opt
                                .setName('shard')
                                .setDescription(this.t('commands.admin.shardShift.shardDescription'))
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                        .addStringOption(opt =>
                            opt
                                .setName('machine')
                                .setDescription(this.t('commands.admin.shardShift.machineDescription'))
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                );
        }

        return b as SlashCommandBuilder;
    })();

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: true
    };

    private async requireBotOwner(interaction: ChatInputCommandInteraction): Promise<boolean> {
        return this.requireAnyBit(interaction, [BOT_OWNER_BIT]);
    }

    private async requireAnyBit(
        interaction: ChatInputCommandInteraction,
        bits: readonly string[],
    ): Promise<boolean> {
        const perms = this.heart.system.handler.$get('permissions', 'manager') as
            | PermissionsHandler
            | undefined;
        if (!perms) {
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.access'),
                this.t('commands.admin.messages.unavailable'),
            );
            return false;
        }
        const guildId = interaction.guildId ?? undefined;
        const resolved = await perms.resolve(interaction.user.id, guildId);
        if (resolved?.botOwner) return true;
        if (await perms.hasBit(interaction.user.id, BOT_OWNER_BIT, guildId)) return true;
        for (const bit of bits) {
            if (bit === BOT_OWNER_BIT) continue;
            if (await perms.hasBit(interaction.user.id, bit, guildId)) return true;
        }
        await this.replyContainer(
            interaction,
            false,
            this.t('commands.admin.titles.access'),
            this.t('commands.admin.messages.denied'),
        );
        return false;
    }

    private bitForSub(sub: string): readonly string[] | 'owner' {
        switch (sub) {
            case 'metrics':
            case 'status':
                return ['bot.fleet.view', 'bot.shard.view', 'bot.crosshost.view'];
            case 'shard-info':
            case 'shards':
            case 'guild-shard':
                return ['bot.shard.view', 'bot.crosshost.view'];
            case 'fleet-info':
                return ['bot.fleet.view', 'bot.crosshost.view'];
            case 'fleet-restart':
                return ['bot.fleet.restart'];
            case 'worker-restart':
                return ['bot.worker.restart', 'bot.fleet.restart'];
            case 'shard-shift':
                return ['bot.shard.shift', 'bot.crosshost.manage'];
            case 'cache-list':
            case 'cache-pop':
                return ['bot.cache.manage'];
            case 'reload-config':
            case 'reload-env':
                return ['bot.config.reload'];
            case 'reload-lang':
                return ['bot.lang.reload'];
            case 'access-blacklist-add':
            case 'access-blacklist-remove':
            case 'access-blacklist-list':
            case 'access-whitelist-add':
            case 'access-whitelist-remove':
            case 'access-whitelist-list':
            case 'access-check':
                return 'owner';
            case 'audit-export':
                return ['bot.audit.export', 'bot.audit.view'];
            case 'error-export':
                return ['bot.errors.export', 'bot.errors.view'];
            default:
                return 'owner';
        }
    }

    private resolveGuildId(interaction: ChatInputCommandInteraction): string | null {
        return interaction.options.getString('guild') || interaction.guildId || null;
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const groupName = interaction.options.getSubcommandGroup(false);
        const subName = interaction.options.getSubcommand(true);
        const sub = groupName ? `${groupName}-${subName}` : subName;

        const need = this.bitForSub(sub);
        if (need === 'owner') {
            if (!(await this.requireBotOwner(interaction))) return;
        } else if (!(await this.requireAnyBit(interaction, need))) {
            return;
        }

        try {
            if (sub === 'restart') return this.handleRestart(interaction);
            if (sub === 'metrics' || sub === 'status') return this.handleMetrics(interaction);
            if (sub === 'shard-info') return this.handleShardInfo(interaction);
            if (sub === 'shards') return this.handleShardsList(interaction);
            if (sub === 'guild-shard') return this.handleGuildShard(interaction);
            if (sub === 'fleet-info') return this.handleFleetInfo(interaction);
            if (sub === 'fleet-restart') return this.handleFleetRestart(interaction);
            if (sub === 'worker-restart') return this.handleWorkerRestart(interaction);
            if (sub === 'shard-shift') return this.handleShardShift(interaction);
            if (sub.startsWith('reload-')) return this.handleReload(interaction, sub);
            if (sub === 'cache-list' || sub === 'cache-pop') return this.handleCache(interaction, sub);
            if (sub === 'audit-list' || sub === 'audit-get') return this.handleAudit(interaction, sub);
            if (sub === 'error-list' || sub === 'error-get' || sub === 'error-export') return this.handleErrors(interaction, sub);
            if (sub === 'audit-export') return this.handleAudit(interaction, sub);
            if (sub === 'bit-holders') return this.handleBitHolders(interaction);
            if (sub.startsWith('gate-')) return this.handleGate(interaction, sub);
            if (sub.startsWith('access-')) return this.handleAccess(interaction, sub);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Admin command error: ${err.message}`);
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.system'),
                this.t('commands.admin.messages.fatalError', { error: err.message })
            );
        }
    }

    @Cooldown('core-admin-restart', { limit: 1, windowMs: 30_000 })
    private async handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
        const reason = interaction.options.getString('reason') ?? 'No reason provided';
        this.log.warn(`Restart by ${interaction.user.tag} (${interaction.user.id}): ${reason}`);
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.restart'),
            this.t('commands.admin.restart.acknowledged', {
                user: interaction.user.tag,
                reason
            })
        );
        setTimeout(() => process.exit(0), 1000);
    }

    private async handleReload(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        if (sub === 'reload-config') {
            const file = interaction.options.getString('file');
            const manager = this.heart.assets.config;
            const success =
                !file || file === 'all' ? await manager.reloadAll() : await manager.reloadFile(file);
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.reload.config',
                target: file ?? 'all',
                outcome: success ? 'success' : 'fail',
            });
            const loaded = manager.getLoadedConfigs?.() ?? [];
            const details = success
                ? this.t('commands.admin.reload.configSuccess', {
                      count: loaded.length,
                      grid: this.formatGrid(loaded)
                  })
                : this.t('commands.admin.reload.configError', { file: file ?? 'all' });
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.config'), details);
        }
        if (sub === 'reload-lang') {
            const namespace = interaction.options.getString('namespace');
            const manager = this.heart.assets.lang;
            const success =
                !namespace || namespace === 'all'
                    ? await manager.reloadAll()
                    : await manager.reloadFile(namespace);
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.reload.lang',
                target: namespace ?? 'all',
                outcome: success ? 'success' : 'fail',
            });
            const loaded = manager.getLoadedNamespaces?.() ?? [];
            const details = success
                ? this.t('commands.admin.reload.langSuccess', {
                      count: loaded.length,
                      grid: this.formatGrid(loaded)
                  })
                : this.t('commands.admin.reload.langError', { namespace: namespace ?? 'all' });
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.lang'), details);
        }
        if (sub === 'reload-emoji') {
            const manager =
                this.heart.assets.emoji;
            if (!manager) throw new Error('EmojiManager is not accessible.');
            const success = await manager.reload();
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.reload.emoji',
                target: 'emoji',
                outcome: success ? 'success' : 'fail',
            });
            const count = Object.keys(manager.getAll?.() || {}).length;
            const details = success
                ? this.t('commands.admin.reload.emojiSuccess', { count })
                : this.t('commands.admin.reload.emojiError');
            return this.replyContainer(interaction, success, this.t('commands.admin.titles.emoji'), details);
        }
        if (sub === 'reload-env') {
            try {
                const result = reloadEnvFromDisk();
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'admin.reload.env',
                    target: 'env',
                    outcome: 'success',
                    meta: { count: result.updated.length },
                });
                const details = this.t('commands.admin.reload.envSuccess', {
                    files: result.filesRead.length ? result.filesRead.join(', ') : 'none',
                    updated: String(result.updated.length),
                    skipped: String(result.skipped.length),
                    skippedList: result.skipped.length ? result.skipped.join(', ') : '—',
                });
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.env'),
                    details,
                );
            } catch (err) {
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'admin.reload.env',
                    target: 'env',
                    outcome: 'fail',
                    reason: 'error',
                });
                throw err;
            }
        }
        if (sub === 'reload-plugin') {
            const pluginId = interaction.options.getString('id', true);
            return this.handlePluginReload(interaction, pluginId);
        }
    }

    @Cooldown('core-admin-reload-plugin', { limit: 1, windowMs: 30_000 })
    private async handlePluginReload(
        interaction: ChatInputCommandInteraction,
        pluginId: string
    ): Promise<void> {
        const manager =
            (await import('#core/loader/index.js')).pluginManager;
        if (!manager) throw new Error('PluginManager is not accessible.');
        const results = await manager.reload(pluginId, interaction.client);
        const success = results.success.includes(pluginId);
        let details = this.t('commands.admin.reload.pluginError', { pluginId });
        if (success) {
            HelpUtils.clearCache(pluginId);
            const plugin = manager.registry.get(pluginId);
            if (plugin) {
                details = this.t('commands.admin.reload.pluginSuccess', {
                    name: plugin.manifest.name,
                    version: plugin.manifest.version,
                    cmdCount: await this.getModuleCount(pluginId, 'commands'),
                    eventCount: await this.getModuleCount(pluginId, 'events'),
                    routeCount: await this.getModuleCount(pluginId, 'routes')
                });
            }
        }
        return this.replyContainer(interaction, success, this.t('commands.admin.titles.plugin'), details);
    }

    private async handleCache(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        if (sub === 'cache-list') {
            const listed = listRegisteredCaches();
            if (listed.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.cache'),
                    this.t('commands.admin.cache.listEmpty'),
                );
            }
            const lines = listed.map((e) =>
                this.t('commands.admin.cache.listLine', {
                    name: e.name,
                    size: String(e.size),
                }),
            );
            const details = this.t('commands.admin.cache.listHeader', {
                count: String(listed.length),
                grid: lines.join('\n'),
            });
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.cache'),
                details,
            );
        }

        const target = interaction.options.getString('target', true).trim();
        const cache = getRegisteredCache(target);
        if (!cache) {
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'admin.cache.pop',
                target,
                outcome: 'fail',
                reason: 'unknown_cache',
            });
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.cache'),
                this.t('commands.admin.cache.unknown', { target }),
            );
        }
        cache.clear();
        void this.heart.system.audit.record({
            ...actorFromUser(interaction.user.id),
            action: 'admin.cache.pop',
            target,
            outcome: 'success',
            meta: { cacheName: target },
        });
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.cache'),
            this.t('commands.admin.cache.popped', { target }),
        );
    }


    private async handleAccess(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        try {
            const core = configManager.get<{ guildAccess?: { enabled?: boolean } }>('core');
            if (core?.guildAccess?.enabled === false) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.access.title'),
                    this.t('commands.admin.access.disabled'),
                );
            }
        } catch {

        }

        if (!guildAccess.isReady()) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.access.title'),
                this.t('commands.admin.access.notReady'),
            );
        }

        const guildId = this.resolveGuildId(interaction);
        if (sub.endsWith('-list')) {
            const kind = sub.includes('blacklist') ? ('blacklist' as const) : ('whitelist' as const);
            const rows = await guildAccess.list(kind);
            if (rows.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.access.title'),
                    this.t('commands.admin.access.listEmpty'),
                );
            }
            const units = rows.map((r, i) => ({
                id: `${kind}:${i}`,
                text: this.t('commands.admin.access.listLine', {
                    guild: r.guildId,
                    reason: r.reason ?? '—',
                    by: r.updatedBy ?? '—',
                }),
            }));
            const paginator = this.heart.paginator.create({
                units,
                mode: 'cv2',
                title: this.t('commands.admin.access.listHeader', { kind, count: String(rows.length) }),
                accentColor: 0x5865f2,
                session: { ephemeral: true, authorOnly: true },
                split: { preferUnits: 10, maxUnitsPerPage: 15 },
            });
            await paginator.reply(interaction);
            return;
        }

        if (sub === 'access-check') {
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.access.title'),
                    this.t('commands.admin.access.needGuild'),
                );
            }
            const allowed = guildAccess.isGuildAllowed(guildId);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.access.title'),
                this.t('commands.admin.access.checkResult', {
                    guild: guildId,
                    allowed: String(allowed),
                    blacklist: String(guildAccess.isOnBlacklist(guildId)),
                    whitelist: String(guildAccess.isOnWhitelist(guildId)),
                    ownerAuthorized: String(guildAccess.isOwnerAuthorized(guildId)),
                }),
            );
        }

        if (!guildId) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.access.title'),
                this.t('commands.admin.access.needGuild'),
            );
        }

        const reason = interaction.options.getString('reason') ?? null;
        if (sub === 'access-blacklist-add') {
            await guildAccess.addToList('blacklist', guildId, interaction.user.id, reason);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.access.title'),
                this.t('commands.admin.access.blacklisted', { guild: guildId }),
            );
        }
        if (sub === 'access-blacklist-remove') {
            const ok = await guildAccess.removeFromList('blacklist', guildId);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.access.title'),
                ok
                    ? this.t('commands.admin.access.unblacklisted', { guild: guildId })
                    : this.t('commands.admin.access.notOnBlacklist', { guild: guildId }),
            );
        }
        if (sub === 'access-whitelist-add') {
            await guildAccess.addToList('whitelist', guildId, interaction.user.id, reason);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.access.title'),
                this.t('commands.admin.access.whitelisted', { guild: guildId }),
            );
        }
        if (sub === 'access-whitelist-remove') {
            const ok = await guildAccess.removeFromList('whitelist', guildId);
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.access.title'),
                ok
                    ? this.t('commands.admin.access.unwhitelisted', { guild: guildId })
                    : this.t('commands.admin.access.notOnWhitelist', { guild: guildId }),
            );
        }
    }

    private async handleGate(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        try {
            const core = configManager.get<{ guildGate?: { enabled?: boolean } }>('core');
            if (core?.guildGate?.enabled === false) {
                return this.replyContainer(interaction, false, this.t('commands.admin.titles.system'), this.t('commands.admin.gate.disabled'));
            }
        } catch {                }
        if (!guildGate.isReady()) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.notReady')
            );
        }

        if (sub === 'gate-guild-block') {
            const guildId = this.resolveGuildId(interaction);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const reason = interaction.options.getString('reason');
            try {
                await guildGate.blockGuild(guildId, interaction.user.id, reason);
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.guild.block',
                    target: guildId,
                    outcome: 'success',
                    reason: reason ?? undefined,
                });
            } catch (err) {
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.guild.block',
                    target: guildId,
                    outcome: 'fail',
                    reason: 'error',
                });
                throw err;
            }
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.guildBlocked', { guild: guildId, reason: reason ?? '—' })
            );
        }

        if (sub === 'gate-guild-unblock') {
            const guildId = this.resolveGuildId(interaction);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const ok = await guildGate.unblockGuild(guildId);
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'gate.guild.unblock',
                target: guildId,
                outcome: ok ? 'success' : 'fail',
                reason: ok ? undefined : 'not_blocked',
            });
            return this.replyContainer(
                interaction,
                ok,
                this.t('commands.admin.titles.gate'),
                ok
                    ? this.t('commands.admin.gate.guildUnblocked', { guild: guildId })
                    : this.t('commands.admin.gate.guildNotBlocked', { guild: guildId })
            );
        }

        if (sub === 'gate-guild-list') {
            const rows = await guildGate.listBlockedGuilds();
            const body =
                rows.length === 0
                    ? this.t('commands.admin.gate.listEmpty')
                    : rows
                          .slice(0, 25)
                          .map(r => `> \`${r.guildId}\`${r.reason ? ` — ${r.reason}` : ''}`)
                          .join('\n');
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.guildListHeader', { count: rows.length }) + '\n' + body
            );
        }

        if (sub === 'gate-plugin-block') {
            const guildId = this.resolveGuildId(interaction);
            const pluginId = interaction.options.getString('plugin', true);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const reason = interaction.options.getString('reason');
            try {
                await guildGate.blockPlugin(guildId, pluginId, interaction.user.id, reason);
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.plugin.block',
                    target: pluginId,
                    outcome: 'success',
                    reason: reason ?? undefined,
                    meta: { guildId },
                });
            } catch (err) {
                void this.heart.system.audit.record({
                    ...actorFromUser(interaction.user.id),
                    action: 'gate.plugin.block',
                    target: pluginId,
                    outcome: 'fail',
                    reason: 'error',
                    meta: { guildId },
                });
                throw err;
            }
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.pluginBlocked', {
                    plugin: pluginId,
                    guild: guildId,
                    reason: reason ?? '—'
                })
            );
        }

        if (sub === 'gate-plugin-unblock') {
            const guildId = this.resolveGuildId(interaction);
            const pluginId = interaction.options.getString('plugin', true);
            if (!guildId) {
                return this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.gate'),
                    this.t('commands.admin.gate.needGuild')
                );
            }
            const ok = await guildGate.unblockPlugin(guildId, pluginId);
            void this.heart.system.audit.record({
                ...actorFromUser(interaction.user.id),
                action: 'gate.plugin.unblock',
                target: pluginId,
                outcome: ok ? 'success' : 'fail',
                reason: ok ? undefined : 'not_blocked',
                meta: { guildId },
            });
            return this.replyContainer(
                interaction,
                ok,
                this.t('commands.admin.titles.gate'),
                ok
                    ? this.t('commands.admin.gate.pluginUnblocked', { plugin: pluginId, guild: guildId })
                    : this.t('commands.admin.gate.pluginNotBlocked', { plugin: pluginId, guild: guildId })
            );
        }

        if (sub === 'gate-plugin-list') {
            const guildId = interaction.options.getString('guild') || undefined;
            const rows = await guildGate.listBlockedPlugins(guildId);
            const body =
                rows.length === 0
                    ? this.t('commands.admin.gate.listEmpty')
                    : rows
                          .slice(0, 25)
                          .map(
                              r =>
                                  `> \`${r.pluginId}\` @ \`${r.guildId}\`${r.reason ? ` — ${r.reason}` : ''}`
                          )
                          .join('\n');
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.gate'),
                this.t('commands.admin.gate.pluginListHeader', { count: rows.length }) + '\n' + body
            );
        }
    }

    private async handleErrors(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        if (sub === 'error-list') {
            const limit = 10;
            const code = interaction.options.getString('code') ?? undefined;
            const category = interaction.options.getString('category') ?? undefined;
            const severity = interaction.options.getString('severity') ?? undefined;
            const entries = await this.heart.system.errors.list({
                code,
                category,
                severity,
                limit,
            });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.errors'),
                    this.t('commands.admin.errors.listEmpty'),
                );
            }
            const summary = this.t('commands.admin.errors.listHeader', {
                count: entries.length,
                grid: '',
            }).replace(/\n+$/, '');
            const units = [
                { id: 'summary', text: summary },
                ...entries.map((e, i) => ({
                    id: `err:${i}`,
                    text: this.t('commands.admin.errors.listLine', {
                        id: e.id,
                        code: e.code,
                        count: e.count,
                        severity: e.severity,
                        category: e.category,
                        firstSeen: String(e.firstSeen),
                        lastSeen: String(e.lastSeen),
                    }),
                })),
            ];
            const paginator = this.heart.paginator.create({
                units,
                mode: 'cv2',
                title: this.t('commands.admin.titles.errors'),
                accentColor: 0xed4245,
                session: { ephemeral: true, authorOnly: true },
                split: { preferUnits: 8, maxUnitsPerPage: 12 },
            });
            await paginator.reply(interaction);
            return;
        }

        if (sub === 'error-export') {
            const entries = await this.heart.system.errors.list({ limit: 100_000 });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.errors'),
                    this.t('commands.admin.errors.exportEmpty'),
                );
            }
            const body = JSON.stringify(entries, null, 2);
            const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), {
                name: `error-export-${Date.now()}.json`,
            });
            await interaction.editReply({
                content: this.t('commands.admin.errors.exportDone', { count: entries.length }),
                files: [file],
            });
            return;
        }

        const id = interaction.options.getString('id', true).trim();
        const entry = await this.heart.system.errors.getById(id);
        if (!entry) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.errors'),
                this.t('commands.admin.errors.notFound', { id }),
            );
        }
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.errors'),
            this.t('commands.admin.errors.getHeader', { id: entry.id }) +
                '\n' +
                this.t('commands.admin.errors.getBody', {
                    code: entry.code,
                    category: entry.category,
                    severity: entry.severity,
                    count: entry.count,
                    message: entry.message,
                    firstSeen: String(entry.firstSeen),
                    lastSeen: String(entry.lastSeen),
                    context: JSON.stringify(entry.context),
                }),
        );
    }

    private async handleAudit(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        if (sub === 'audit-list') {
            const limit = 10;
            const actor = interaction.options.getString('actor') ?? undefined;
            const action = interaction.options.getString('action') ?? undefined;
            const outcomeRaw = interaction.options.getString('outcome');
            const outcome =
                outcomeRaw === 'success' || outcomeRaw === 'fail' ? outcomeRaw : undefined;
            const entries = await this.heart.system.audit.list({
                actorId: actor,
                action,
                outcome,
                limit,
            });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.audit'),
                    this.t('commands.admin.audit.listEmpty'),
                );
            }
            const summary = this.t('commands.admin.audit.listHeader', {
                count: entries.length,
                grid: '',
            }).replace(/\n+$/, '');
            const units = [
                { id: 'summary', text: summary },
                ...entries.map((e, i) => ({
                    id: `audit:${i}`,
                    text: this.t('commands.admin.audit.listLine', {
                        id: e.id,
                        action: e.action,
                        outcome: e.outcome,
                        actor: `${e.actorType}:${e.actorId}`,
                        target: e.target,
                        when: String(e.createdAt),
                    }),
                })),
            ];
            const paginator = this.heart.paginator.create({
                units,
                mode: 'cv2',
                title: this.t('commands.admin.titles.audit'),
                accentColor: 0x5865f2,
                session: { ephemeral: true, authorOnly: true },
                split: { preferUnits: 8, maxUnitsPerPage: 12 },
            });
            await paginator.reply(interaction);
            return;
        }

        if (sub === 'audit-export') {
            const entries = await this.heart.system.audit.list({ limit: 100_000 });
            if (entries.length === 0) {
                return this.replyContainer(
                    interaction,
                    true,
                    this.t('commands.admin.titles.audit'),
                    this.t('commands.admin.audit.exportEmpty'),
                );
            }
            const body = JSON.stringify(entries, null, 2);
            const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), {
                name: `audit-export-${Date.now()}.json`,
            });
            await interaction.editReply({
                content: this.t('commands.admin.audit.exportDone', { count: entries.length }),
                files: [file],
            });
            return;
        }

        const id = interaction.options.getString('id', true).trim();
        const entry = await this.heart.system.audit.getById(id);
        if (!entry) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.audit'),
                this.t('commands.admin.audit.notFound', { id }),
            );
        }
        const metaStr = JSON.stringify(entry.meta);
        return this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.audit'),
            this.t('commands.admin.audit.getHeader', { id: entry.id }) +
                '\n' +
                this.t('commands.admin.audit.getBody', {
                    action: entry.action,
                    outcome: entry.outcome,
                    actorType: entry.actorType,
                    actorId: entry.actorId,
                    target: entry.target,
                    reason: entry.reason ?? '—',
                    createdAt: String(entry.createdAt),
                    meta: metaStr,
                }),
        );
    }

    private async handleBitHolders(interaction: ChatInputCommandInteraction): Promise<void> {
        const bit = interaction.options.getString('bit', true).trim();
        const pageRaw = interaction.options.getInteger('page');
        const page = Math.max(1, pageRaw ?? 1);

        if (!permissionsManager) {
            return this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.bitHolders'),
                this.t('commands.admin.bitHolders.unavailable'),
            );
        }

        const { botWide, byGuild } = await permissionsManager.findHoldersOfBit(bit);
        type Section = { title: string; members: string[] };
        const sections: Section[] = [];
        if (botWide.length > 0) {
            sections.push({
                title: this.t('commands.admin.bitHolders.sectionBotWide'),
                members: botWide,
            });
        }
        const guildIds = [...byGuild.keys()].sort();
        for (const gid of guildIds) {
            const members = byGuild.get(gid) ?? [];
            if (members.length === 0) continue;
            sections.push({
                title: this.t('commands.admin.bitHolders.sectionGuild', { guildId: gid }),
                members,
            });
        }

        if (sections.length === 0) {
            return this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.bitHolders'),
                this.t('commands.admin.bitHolders.empty', { bit }),
            );
        }

        const units: { id: string; text: string }[] = [];
        let unitIdx = 0;
        for (const section of sections) {
            units.push({
                id: `sec:${unitIdx++}`,
                text: `**${section.title}**`,
            });
            for (const uid of section.members) {
                units.push({
                    id: `m:${unitIdx++}`,
                    text: this.t('commands.admin.bitHolders.memberLine', { userId: uid }),
                });
            }
        }

        const title = this.t('commands.admin.titles.bitHolders');

        const paginator = this.heart.paginator.create({
            units,
            mode: 'cv2',
            title: `${title} · \`${bit}\``,
            initialPage: page,
            accentColor: 0x5865f2,
            session: { ephemeral: true, authorOnly: true },
            split: { preferUnits: 8, maxUnitsPerPage: 12 },
        });

        await paginator.reply(interaction);
    }

    private formatGrid(items: string[], columns: number = 3): string {
        if (!items?.length) return '> *None*';
        const rows: string[] = [];
        for (let i = 0; i < items.length; i += columns) {
            rows.push('> ' + items.slice(i, i + columns).map(item => `\`${item}\``).join(' • '));
        }
        return rows.join('\n');
    }

    private async getModuleCount(pluginId: string, folder: string): Promise<number> {
        try {
            const dir = path.join(process.cwd(), 'plugins', pluginId, 'src', folder);
            const files = await fs.readdir(dir, { withFileTypes: true });
            return files.filter(f => f.isFile() && (f.name.endsWith('.js') || f.name.endsWith('.ts'))).length;
        } catch {
            return 0;
        }
    }

    private async handleMetrics(interaction: ChatInputCommandInteraction): Promise<void> {
        const c = this.heart.control;
        const client = this.heart.client;
        const shards = c.shards();
        let ecosystemLine = '';
        try {
            const { listCommandTree } = await import('#core/loader/commandRegistry.js');
            const tree = listCommandTree();
            const roots = tree.roots.length;
            const subs = tree.roots.reduce((n, r) => n + r.subHandlers.length, 0);
            ecosystemLine = `**Ecosystem:** ${roots} root command(s) · ${subs} sub-handler(s) · frozen=${tree.frozen ? 'yes' : 'no'}`;
            try {
                const plugins = await HelpUtils.fetchEcosystemData(this.heart, interaction);
                const totalCmds = plugins.reduce((acc, p) => acc + p.commands.length, 0);
                ecosystemLine = this.t('commands.help.homeDesc', {
                    plugins: plugins.length,
                    commands: totalCmds,
                    emoji_menu: HelpUtils.getEmoji(this.heart, 'menu'),
                    emoji_command: HelpUtils.getEmoji(this.heart, 'command'),
                }).replace(/\n+/g, ' · ');
            } catch {

            }
        } catch {
            ecosystemLine = '';
        }
        const lines = [
            ...(ecosystemLine ? [ecosystemLine] : []),
            `**Mode:** ${detectAdminMode()}`,
            `**PID:** ${c.pid()}`,
            `**Uptime:** ${Math.floor(c.uptimeMs() / 1000)}s`,
            `**Node:** ${c.nodeVersion()}`,
            `**Guilds (this process):** ${client.guilds.cache.size}`,
            `**Users cached:** ${client.users.cache.size}`,
            `**Cross-Host:** ${c.isCrossHost() ? 'yes' : 'no'}`,
            `**Role:** ${c.role() ?? '—'}`,
            `**Machine:** ${c.machineId() ?? '—'}`,
            `**Shards:** ${shards.length ? shards.join(', ') : '—'}`,
        ];
        if (c.isCrossHost()) {
            const peers = this.heart.crossHost.peers();
            lines.push(`**Peers:** ${peers.length ? peers.join(', ') : '—'}`);
        }
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.metrics'),
            lines.join('\n'),
        );
    }

    private async handleShardInfo(interaction: ChatInputCommandInteraction): Promise<void> {
        const want = interaction.options.getInteger('shard');
        const guildOpt = interaction.options.getString('guild');
        const local = [...this.heart.control.shards()];
        const client = this.heart.client;
        const totalShards = Math.max(1, client.shard?.count ?? (local.length > 0 ? local.length : 1));
        const machine = this.heart.control.machineId() ?? '—';

        if (guildOpt) {
            const sid = Number((BigInt(guildOpt.trim()) >> 22n) % BigInt(totalShards));
            const onProcess = local.includes(sid);
            const g = client.guilds.cache.get(guildOpt.trim());
            await this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.shard'),
                [
                    `**Guild:** ${guildOpt.trim()}`,
                    `**Name:** ${g?.name ?? '—'}`,
                    `**Shard:** ${sid} / ${totalShards}`,
                    `**On this process:** ${onProcess ? 'yes' : 'no'}`,
                    `**Worker:** ${machine}`,
                ].join('\n'),
            );
            return;
        }

        const shardList =
            want !== null && want !== undefined
                ? [want]
                : local.length
                  ? local
                  : client.shard?.ids
                    ? [...client.shard.ids]
                    : [];
        if (shardList.length === 0) {
            await this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.shard'),
                this.t('commands.admin.shardInfo.none'),
            );
            return;
        }
        const lines = shardList.map((id) => {
            const onProcess = local.includes(id) || (client.shard?.ids.includes(id) ?? false);
            const guildApprox = client.guilds.cache.filter(
                (g) => Number((BigInt(g.id) >> 22n) % BigInt(totalShards)) === id,
            ).size;
            return `**Shard ${id}:** ${onProcess ? 'local' : 'remote'} · guilds≈${guildApprox} · worker=${machine}`;
        });
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.shard'),
            lines.join('\n'),
        );
    }

    private async handleShardsList(interaction: ChatInputCommandInteraction): Promise<void> {
        const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
        const perPage = 8;
        const client = this.heart.client;
        const local = [...this.heart.control.shards()];
        const totalShards = Math.max(
            1,
            client.shard?.count ?? (local.length > 0 ? Math.max(...local) + 1 : 1),
        );
        const machine = this.heart.control.machineId() ?? '—';
        const allIds = Array.from({ length: totalShards }, (_, i) => i);
        const totalPages = Math.max(1, Math.ceil(allIds.length / perPage));
        const safePage = Math.min(page, totalPages);
        const slice = allIds.slice((safePage - 1) * perPage, safePage * perPage);
        const lines = slice.map((id) => {
            const onProcess = local.includes(id);
            const guildApprox = client.guilds.cache.filter(
                (g) => Number((BigInt(g.id) >> 22n) % BigInt(totalShards)) === id,
            ).size;
            return (
                `**#${id}** · ${onProcess ? 'this worker' : 'other'} · guilds≈${guildApprox}` +
                (onProcess ? ` · machine=${machine}` : '')
            );
        });
        const header = this.t('commands.admin.shards.header', {
            page: String(safePage),
            pages: String(totalPages),
            total: String(totalShards),
            local: String(local.length),
        });
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.shard'),
            `${header}\n${lines.join('\n')}`,
        );
    }

    private async handleGuildShard(interaction: ChatInputCommandInteraction): Promise<void> {
        const raw = interaction.options.getString('guild', true);
        const ids = raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d{5,32}$/.test(s));
        if (ids.length === 0) {
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.shard'),
                this.t('commands.admin.guildShard.invalid'),
            );
            return;
        }
        const client = this.heart.client;
        const local = [...this.heart.control.shards()];
        const totalShards = Math.max(1, client.shard?.count ?? (local.length > 0 ? local.length : 1));
        const machine = this.heart.control.machineId() ?? '—';
        const lines = ids.slice(0, 25).map((guildId) => {
            const sid = Number((BigInt(guildId) >> 22n) % BigInt(totalShards));
            const g = client.guilds.cache.get(guildId);
            const onProcess = local.includes(sid);
            return `**${guildId}** ${g ? `(${g.name})` : ''} → shard **${sid}** · ${onProcess ? `local (${machine})` : 'not local'}`;
        });
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.shard'),
            lines.join('\n'),
        );
    }

    private async handleFleetInfo(interaction: ChatInputCommandInteraction): Promise<void> {
        const c = this.heart.control;
        const lines = [
            `**Role:** ${c.role() ?? '—'}`,
            `**Machine:** ${c.machineId() ?? '—'}`,
            `**Local shards:** ${c.shards().join(', ') || '—'}`,
            `**Guilds (local):** ${this.heart.client.guilds.cache.size}`,
            `**Peers:** ${this.heart.crossHost.peers().join(', ') || '—'}`,
            `**Uptime:** ${Math.floor(c.uptimeMs() / 1000)}s`,
        ];
        try {
            const cluster = this.heart.system.handler.$get('core', 'clusterInfo') as
                | { fleetSnapshot?: () => Promise<Record<string, unknown> | null> }
                | undefined;
            if (cluster?.fleetSnapshot) {
                const snap = await cluster.fleetSnapshot();
                if (snap) {
                    lines.push(`**Fleet snapshot:** \`\`\`json\n${JSON.stringify(snap, null, 2).slice(0, 1500)}\n\`\`\``);
                }
            }
        } catch {
        }
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.fleet'),
            lines.join('\n'),
        );
    }

    private async handleFleetRestart(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.heart.control.isCrossHost()) {
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.fleet'),
                this.t('errors.discord.not_available_here'),
            );
            return;
        }
        const reason = interaction.options.getString('reason') ?? 'admin fleet-restart';
        await this.replyContainer(
            interaction,
            true,
            this.t('commands.admin.titles.fleet'),
            this.t('commands.admin.fleetRestart.acknowledged', {
                user: interaction.user.tag,
                reason,
            }),
        );
        void this.heart.control.shutdownFleet(reason).catch((err: unknown) => {
            this.log.error('Fleet restart failed', err);
        });
    }

    private async handleWorkerRestart(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.heart.control.isCrossHost()) {
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.worker'),
                this.t('errors.discord.not_available_here'),
            );
            return;
        }
        const machine = interaction.options.getString('machine', true);
        const reason = interaction.options.getString('reason') ?? 'admin worker-restart';
        try {
            await this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.worker'),
                this.t('commands.admin.workerRestart.acknowledged', {
                    machine,
                    user: interaction.user.tag,
                    reason,
                }),
            );
            await this.heart.control.shutdownMachine(machine, reason);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.worker'),
                this.t('commands.admin.messages.fatalError', { error: msg }),
            );
        }
    }

    private async handleShardShift(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.heart.control.isCrossHost()) {
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.shard'),
                this.t('errors.discord.not_available_here'),
            );
            return;
        }
        const shard = interaction.options.getInteger('shard', true);
        const machine = interaction.options.getString('machine', true);
        try {
            const { requestShardShift, isClusterClientReady } = await import(
                '#core/crosshost/worker/clusterClient.js'
            );
            if (!isClusterClientReady()) {
                await this.replyContainer(
                    interaction,
                    false,
                    this.t('commands.admin.titles.shard'),
                    this.t('errors.discord.fleet_unreachable'),
                );
                return;
            }
            const result = await requestShardShift(shard, machine);
            await this.replyContainer(
                interaction,
                true,
                this.t('commands.admin.titles.shard'),
                this.t('commands.admin.shardShift.done', {
                    shard: String(shard),
                    machine,
                    from: result.from ?? '—',
                    generation: String(result.generation),
                }),
            );
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await this.replyContainer(
                interaction,
                false,
                this.t('commands.admin.titles.shard'),
                this.t('commands.admin.messages.fatalError', { error: msg }),
            );
        }
    }

    private async replyContainer(
        interaction: ChatInputCommandInteraction,
        success: boolean,
        title: string,
        details: string
    ): Promise<void> {
        const layoutKey = success ? 'layouts.containerSuccess' : 'layouts.containerError';
        const rawJson = this.t(layoutKey, { title });
        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        const container = layout.components[0] as ContainerSpec;
        const detailsChild = container?.children?.[2];
        if (detailsChild && detailsChild.type === 'text') {
            detailsChild.content = details;
        }
        await interaction.editReply(buildComponentsV2(layout));
    }

    public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const groupName = interaction.options.getSubcommandGroup(false);
        const subName = interaction.options.getSubcommand(true);
        const sub = groupName ? `${groupName}-${subName}` : subName;
        const focused = interaction.options.getFocused(true);
        const q = focused.value.toLowerCase();
        let choices: string[] = [];

        try {
            if (sub === 'reload-config' && focused.name === 'file') {
                const configDir = path.join(process.cwd(), 'configuration');
                const files = await fs.readdir(configDir).catch(() => []);
                choices = files.filter(f => f.endsWith('.json5')).map(f => f.replace('.json5', ''));
                choices.unshift('all');
            } else if (sub === 'reload-lang' && focused.name === 'namespace') {
                const langDir = path.join(process.cwd(), 'configuration', 'lang');
                const files = await fs.readdir(langDir).catch(() => []);
                choices = Array.from(new Set(files.map(f => f.split('_')[0])));
                choices.unshift('all');
            } else if (
                (sub === 'reload-plugin' || sub === 'gate-plugin-block' || sub === 'gate-plugin-unblock') &&
                focused.name === 'id' || focused.name === 'plugin'
            ) {
                const pluginsDir = path.join(process.cwd(), 'plugins');
                const entries = await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
                choices = entries.filter(e => e.isDirectory()).map(e => e.name);
            } else if (sub === 'cache-pop' && focused.name === 'target') {
                choices = listRegisteredCaches().map((e) => e.name);
            } else if (sub === 'bit-holders' && focused.name === 'bit') {
                if (permissionsManager) {
                    const bits = await permissionsManager.listBits();
                    choices = bits.map((b) => String(b._id));
                }
            } else if (
                (sub === 'worker-restart' || sub === 'shard-shift') &&
                focused.name === 'machine'
            ) {
                const peers = [...this.heart.crossHost.peers()];
                const self = this.heart.control.machineId();
                if (self) peers.unshift(self);
                choices = Array.from(new Set(peers.filter(Boolean)));
            } else if (
                (sub === 'shard-info' || sub === 'shard-shift') &&
                focused.name === 'shard'
            ) {
                const shards = this.heart.control.shards();
                choices = (shards.length ? shards : this.heart.client.shard?.ids ?? []).map(String);
            }
        } catch {

        }

        await interaction.respond(
            choices
                .filter(c => c.toLowerCase().includes(q))
                .slice(0, 25)
                .map(c => ({ name: c, value: c }))
        );
    }
}
