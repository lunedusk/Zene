import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { permissionsManager } from '#core/manager/permissions.js';
import { PermissionError } from '#core/types/permissions.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';
import {
    SlashCommandBuilder,
    MessageFlags,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
} from 'discord.js';
import type PermissionsHandler from '../handlers/manager.js';

export default class PermissionsCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('permissions')
        .setDescription(this.t('commands.permissions.description'))

        .addSubcommandGroup(group =>
            group.setName('roles')
                .setDescription(this.t('commands.permissions.rolesGroupDesc'))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription(this.t('commands.permissions.roles.listDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.scopeDesc'))
                                .setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('create')
                        .setDescription(this.t('commands.permissions.roles.createDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.scopeDesc'))
                                .setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addStringOption(opt => opt.setName('name').setDescription(this.t('commands.permissions.roles.nameDesc')).setRequired(true))
                        .addStringOption(opt => opt.setName('color').setDescription(this.t('commands.permissions.roles.colorDesc')).setRequired(true))
                        .addStringOption(opt => opt.setName('bits').setDescription(this.t('commands.permissions.roles.bitsDesc')).setRequired(true))
                )
                .addSubcommand(sub =>
                    sub.setName('delete')
                        .setDescription(this.t('commands.permissions.roles.deleteDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.scopeDesc'))
                                .setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addStringOption(opt => opt.setName('role').setDescription(this.t('commands.permissions.roles.roleDesc')).setRequired(true).setAutocomplete(true))
                )
                .addSubcommand(sub =>
                    sub.setName('edit')
                        .setDescription(this.t('commands.permissions.roles.editDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.scopeDesc'))
                                .setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addStringOption(opt => opt.setName('role').setDescription(this.t('commands.permissions.roles.roleDesc')).setRequired(true).setAutocomplete(true))
                        .addStringOption(opt => opt.setName('name').setDescription(this.t('commands.permissions.roles.newNameDesc')).setRequired(false))
                        .addStringOption(opt => opt.setName('color').setDescription(this.t('commands.permissions.roles.newColorDesc')).setRequired(false))
                        .addStringOption(opt => opt.setName('bits').setDescription(this.t('commands.permissions.roles.newBitsDesc')).setRequired(false))
                )
                .addSubcommand(sub =>
                    sub.setName('assign')
                        .setDescription(this.t('commands.permissions.roles.assignDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.scopeDesc'))
                                .setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addStringOption(opt => opt.setName('role').setDescription(this.t('commands.permissions.roles.roleDesc')).setRequired(true).setAutocomplete(true))
                        .addUserOption(opt => opt.setName('user').setDescription(this.t('commands.permissions.roles.userDesc')).setRequired(true))
                )
                .addSubcommand(sub =>
                    sub.setName('revoke')
                        .setDescription(this.t('commands.permissions.roles.revokeDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.scopeDesc'))
                                .setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addStringOption(opt => opt.setName('role').setDescription(this.t('commands.permissions.roles.roleDesc')).setRequired(true).setAutocomplete(true))
                        .addUserOption(opt => opt.setName('user').setDescription(this.t('commands.permissions.roles.userDesc')).setRequired(true))
                )
        )

        .addSubcommandGroup(group =>
            group.setName('bits')
                .setDescription(this.t('commands.permissions.bitsGroupDesc'))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription(this.t('commands.permissions.bits.listDesc'))
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription(this.t('commands.permissions.bits.scopeFilterDesc')).setRequired(false)
                                .addChoices({ name: 'Bot', value: 'bot' }, { name: 'Server', value: 'server' }, { name: 'Plugin', value: 'plugin' })
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('register')
                        .setDescription(this.t('commands.permissions.bits.registerDesc'))
                        .addStringOption(opt => opt.setName('bit').setDescription(this.t('commands.permissions.bits.bitDesc')).setRequired(true))
                        .addStringOption(opt => opt.setName('description').setDescription(this.t('commands.permissions.bits.descriptionDesc')).setRequired(true))
                )
        )

        .addSubcommandGroup(group =>
            group.setName('cache')
                .setDescription(this.t('commands.permissions.cacheGroupDesc'))
                .addSubcommand(sub =>
                    sub.setName('clear')
                        .setDescription(this.t('commands.permissions.cache.clearDesc'))
                        .addStringOption(opt =>
                            opt.setName('target').setDescription(this.t('commands.permissions.cache.targetDesc')).setRequired(true)
                                .addChoices({ name: 'Specific user', value: 'user' }, { name: 'This guild', value: 'guild' }, { name: 'Everything', value: 'all' })
                        )
                        .addUserOption(opt => opt.setName('user').setDescription(this.t('commands.permissions.cache.userDesc')).setRequired(false))
                )
        )

        .addSubcommandGroup(group =>
            group.setName('links')
                .setDescription('Discord role to perm role links')
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription('List Discord role links')
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription('bot or server').setRequired(false)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('link')
                        .setDescription('Link a Discord role to a perm role')
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription('bot or server').setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addRoleOption(opt => opt.setName('discord_role').setDescription('Discord role').setRequired(true))
                        .addStringOption(opt => opt.setName('perm_role').setDescription('Perm role id').setRequired(true))
                )
                .addSubcommand(sub =>
                    sub.setName('unlink')
                        .setDescription('Remove a Discord role link')
                        .addStringOption(opt =>
                            opt.setName('scope').setDescription('bot or server').setRequired(true)
                                .addChoices({ name: 'Bot-wide', value: 'bot' }, { name: 'Server', value: 'server' })
                        )
                        .addRoleOption(opt => opt.setName('discord_role').setDescription('Discord role').setRequired(true))
                        .addStringOption(opt => opt.setName('perm_role').setDescription('Perm role id').setRequired(true))
                )
                .addSubcommand(sub =>
                    sub.setName('sync')
                        .setDescription('Sync Discord roles to perm grants in this guild')
                )
        )

        .addSubcommandGroup(group =>
            group.setName('mirror')
                .setDescription('Per-guild Discord permission → server bit mirror (default off)')
                .addSubcommand(sub => sub.setName('status').setDescription('Show mirror status for this guild'))
                .addSubcommand(sub => sub.setName('enable').setDescription('Enable Discord permission mirror for this guild'))
                .addSubcommand(sub => sub.setName('disable').setDescription('Disable Discord permission mirror for this guild'))
        )

        .addSubcommand(sub =>
            sub.setName('resolve')
                .setDescription(this.t('commands.permissions.resolve.desc'))
                .addUserOption(opt => opt.setName('user').setDescription(this.t('commands.permissions.resolve.userDesc')).setRequired(false))
        );

    public readonly config: CommandConfig = {
        permissionLevel: 'owner',
        autoDefer: false,
        allowInDm: false,
    };

    private getHandler(): PermissionsHandler | undefined {
        return this.heart.system.handler.$get('permissions', 'manager') as PermissionsHandler | undefined;
    }

    private async requireBit(interaction: ChatInputCommandInteraction, bit: string, guildId?: string): Promise<boolean> {
        const handler = this.getHandler();
        if (!handler) return false;
        const has = await handler.hasBit(interaction.user.id, bit, guildId);
        if (!has) {
            await this.replyContainer(interaction, false, this.t('commands.permissions.titles.denied'), this.t('commands.permissions.no_permission', { bit }));
        }
        return has;
    }

    private async replyContainer(interaction: ChatInputCommandInteraction, success: boolean, title: string, details: string): Promise<void> {
        const layoutKey = success ? 'layouts.containerSuccess' : 'layouts.containerError';
        const rawJson = this.t(layoutKey, { title });

        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        const container = layout.components[0] as any;

        container.children[2].content = details;

        const payload = buildComponentsV2(layout);
        await interaction.editReply(payload);
    }

    private async replyInfo(interaction: ChatInputCommandInteraction, title: string, details: string): Promise<void> {
        const rawJson = this.t('layouts.containerInfo', { title });
        const layout: Cv2LayoutSpec = JSON.parse(rawJson);
        const container = layout.components[0] as any;

        container.children[2].content = details;

        const payload = buildComponentsV2(layout);
        await interaction.editReply(payload);
    }

    private formatGrid(items: string[], columns: number = 3): string {
        if (!items || items.length === 0) return '> *None*';
        const rows: string[] = [];
        for (let i = 0; i < items.length; i += columns) {
            rows.push('> ' + items.slice(i, i + columns).map(item => `\`${item}\``).join(' • '));
        }
        return rows.join('\n');
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const handler = this.getHandler();
        if (!handler) {
            return this.replyContainer(interaction, false, this.t('commands.permissions.titles.system'), this.t('commands.permissions.handler_unavailable'));
        }

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        try {
            switch (group) {
                case 'roles':  await this.handleRoles(interaction, handler, sub); break;
                case 'bits':   await this.handleBits(interaction, handler, sub); break;
                case 'cache':  await this.handleCache(interaction, handler, sub); break;
                case 'links':  await this.handleLinks(interaction, handler, sub); break;
                case 'mirror': await this.handleMirror(interaction, sub); break;
                default:
                    if (sub === 'resolve') await this.handleResolve(interaction, handler);
                    break;
            }
        } catch (err) {
            if (err instanceof PermissionError) {
                const detail = err.code === 'INVALID_BIT' ? this.t('commands.permissions.errors.invalidBit')
                    : err.code === 'INVALID_SCOPE' ? this.t('commands.permissions.errors.invalidScope')
                    : err.message;
                return this.replyContainer(interaction, false, this.t('commands.permissions.titles.denied'), detail);
            }
            const e = err instanceof Error ? err : new Error(String(err));
            this.log.error(`Permissions Command Exception: ${e.message}`);
            await this.replyContainer(interaction, false, this.t('commands.permissions.titles.system'), this.t('commands.permissions.errors.fatal', { error: e.message }));
        }
    }

    public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const handler = this.getHandler();
        if (!handler) { await interaction.respond([]); return; }

        const focused = interaction.options.getFocused().toLowerCase();
        const scope = interaction.options.getString('scope');

        if (scope === 'bot') {
            const roles = await handler.listBotRoles();
            await interaction.respond(roles
                .filter(r => r.name.toLowerCase().includes(focused) || r._id.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(r => ({ name: `${r.name} (${r._id})`, value: r._id }))
            );
        } else if (scope === 'server' && interaction.guildId) {
            const roles = await handler.listServerRoles(interaction.guildId);
            await interaction.respond(roles
                .filter(r => r.name.toLowerCase().includes(focused) || r._id.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(r => ({ name: `${r.name} (${r._id})`, value: r._id }))
            );
        } else {
            await interaction.respond([]);
        }
    }

    private async handleRoles(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, sub: string): Promise<void> {
        const scope = interaction.options.getString('scope', true) as 'bot' | 'server';
        const requiredBit = scope === 'bot' ? 'bot.members.ban' : 'server.members.ban';
        const guildId = interaction.guildId ?? undefined;

        if (!(await this.requireBit(interaction, requiredBit, guildId))) return;

        if (scope === 'server' && !guildId) {
            return this.replyContainer(interaction, false, this.t('commands.permissions.titles.roles'), this.t('commands.permissions.not_in_guild'));
        }

        switch (sub) {
            case 'list':   await this.rolesList(interaction, handler, scope, guildId); break;
            case 'create': await this.rolesCreate(interaction, handler, scope, guildId); break;
            case 'delete': await this.rolesDelete(interaction, handler, scope, guildId); break;
            case 'edit':   await this.rolesEdit(interaction, handler, scope, guildId); break;
            case 'assign': await this.rolesAssign(interaction, handler, scope, guildId); break;
            case 'revoke': await this.rolesRevoke(interaction, handler, scope, guildId); break;
        }
    }

    private async rolesList(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, scope: 'bot' | 'server', guildId?: string): Promise<void> {
        const roles = scope === 'bot' ? await handler.listBotRoles() : await handler.listServerRoles(guildId!);

        if (roles.length === 0) {
            return this.replyInfo(interaction, this.t('commands.permissions.titles.roles'), this.t('commands.permissions.messages.rolesEmpty'));
        }

        const lines = roles.map(r => {
            const bitGrid = this.formatGrid(r.bits, 4);
            return this.t('commands.permissions.messages.roleEntry', {
                name: r.name, id: r._id,
                bits: bitGrid, count: r.assignedUserIds.length,
            });
        });

        const title = scope === 'bot' ? this.t('commands.permissions.titles.botRoles') : this.t('commands.permissions.titles.serverRoles');
        await this.replyInfo(interaction, title, lines.join('\n\n'));
    }

    private async rolesCreate(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, scope: 'bot' | 'server', guildId?: string): Promise<void> {
        const name = interaction.options.getString('name', true);
        const color = interaction.options.getString('color', true);
        const bits = interaction.options.getString('bits', true).split(',').map(b => b.trim()).filter(Boolean);

        const role = scope === 'bot'
            ? await handler.createBotRole({ name, color, bits, createdBy: interaction.user.id }, interaction.user.id)
            : await handler.createServerRole(guildId!, { name, color, bits, createdBy: interaction.user.id });

        await this.replyContainer(interaction, true, this.t('commands.permissions.titles.roles'),
            this.t('commands.permissions.messages.roleCreated', { name: role.name, id: role._id, bits: this.formatGrid(role.bits, 4) }));
    }

    private async rolesDelete(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, scope: 'bot' | 'server', guildId?: string): Promise<void> {
        const roleId = interaction.options.getString('role', true);

        if (scope === 'bot') {
            await handler.deleteBotRole(roleId, interaction.user.id);
        } else {
            await handler.deleteServerRole(guildId!, roleId);
        }

        await this.replyContainer(interaction, true, this.t('commands.permissions.titles.roles'),
            this.t('commands.permissions.messages.roleDeleted', { roleId }));
    }

    private async rolesEdit(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, scope: 'bot' | 'server', guildId?: string): Promise<void> {
        const roleId = interaction.options.getString('role', true);
        const name = interaction.options.getString('name', false);
        const color = interaction.options.getString('color', false);
        const bitsRaw = interaction.options.getString('bits', false);

        if (!name && !color && !bitsRaw) {
            return this.replyContainer(interaction, false, this.t('commands.permissions.titles.roles'), this.t('commands.permissions.messages.noChanges'));
        }

        const data: Record<string, unknown> = {};
        if (name) data.name = name;
        if (color) data.color = color;
        if (bitsRaw) data.bits = bitsRaw.split(',').map(b => b.trim()).filter(Boolean);

        if (scope === 'bot') {
            await handler.updateBotRole(roleId, data as any, interaction.user.id);
        } else {
            await handler.updateServerRole(guildId!, roleId, data as any);
        }

        await this.replyContainer(interaction, true, this.t('commands.permissions.titles.roles'),
            this.t('commands.permissions.messages.roleEdited', { roleId }));
    }

    private async rolesAssign(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, scope: 'bot' | 'server', guildId?: string): Promise<void> {
        const roleId = interaction.options.getString('role', true);
        const user = interaction.options.getUser('user', true);

        if (scope === 'bot') {
            await handler.assignBotRole(roleId, [user.id], interaction.user.id);
        } else {
            await handler.assignServerRole(guildId!, roleId, [user.id]);
        }

        await this.replyContainer(interaction, true, this.t('commands.permissions.titles.roles'),
            this.t('commands.permissions.messages.roleAssigned', { userId: user.id, roleId }));
    }

    private async rolesRevoke(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, scope: 'bot' | 'server', guildId?: string): Promise<void> {
        const roleId = interaction.options.getString('role', true);
        const user = interaction.options.getUser('user', true);

        if (scope === 'bot') {
            await handler.revokeBotRole(roleId, [user.id], interaction.user.id);
        } else {
            await handler.revokeServerRole(guildId!, roleId, [user.id]);
        }

        await this.replyContainer(interaction, true, this.t('commands.permissions.titles.roles'),
            this.t('commands.permissions.messages.roleRevoked', { userId: user.id, roleId }));
    }

    private async handleBits(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, sub: string): Promise<void> {
        const guildId = interaction.guildId ?? undefined;
        if (!(await this.requireBit(interaction, 'bot.roles.manage', guildId))) return;

        switch (sub) {
            case 'list':     await this.bitsList(interaction, handler); break;
            case 'register': await this.bitsRegister(interaction, handler); break;
        }
    }

    private async bitsList(interaction: ChatInputCommandInteraction, handler: PermissionsHandler): Promise<void> {
        const scopeRaw = interaction.options.getString('scope', false) as 'bot' | 'server' | 'plugin' | null;
        const bits = await handler.listBits(scopeRaw ?? undefined);

        if (bits.length === 0) {
            return this.replyInfo(interaction, this.t('commands.permissions.titles.bits'), this.t('commands.permissions.messages.bitsEmpty'));
        }

        const units = bits.map((b, i) => ({
            id: `bit:${i}`,
            text: `\`${b._id}\` — ${b.description} **[${b.scope}]**`,
        }));

        const scopeLabel = scopeRaw ?? 'all';
        const paginator = this.heart.paginator.create({
            units,
            mode: 'cv2',
            title: `${this.t('commands.permissions.titles.bits')} · ${scopeLabel}`,
            accentColor: 0x5865f2,
            session: { ephemeral: true, authorOnly: true },
            split: { preferUnits: 10, maxUnitsPerPage: 15 },
        });
        await paginator.reply(interaction);
    }

    private async bitsRegister(interaction: ChatInputCommandInteraction, handler: PermissionsHandler): Promise<void> {
        const bit = interaction.options.getString('bit', true);
        const description = interaction.options.getString('description', true);

        await handler.registerBit(bit, description);
        await this.replyContainer(interaction, true, this.t('commands.permissions.titles.bits'),
            this.t('commands.permissions.messages.bitRegistered', { bit }));
    }

    private async handleResolve(interaction: ChatInputCommandInteraction, handler: PermissionsHandler): Promise<void> {
        const guildId = interaction.guildId ?? undefined;
        const targetUser = interaction.options.getUser('user', false) ?? interaction.user;
        const isSelf = targetUser.id === interaction.user.id;

        if (!isSelf && !(await this.requireBit(interaction, 'bot.members.view', guildId))) return;

        const resolved = await handler.resolve(targetUser.id, guildId, interaction.guild?.ownerId);

        let details: string;
        if (resolved.botOwner) {
            details = this.t('commands.permissions.messages.resolveOwner', { userId: targetUser.id });
        } else {
            const bitList = [...resolved.bits];
            const grid = bitList.length > 0 ? this.formatGrid(bitList, 3) : this.t('commands.permissions.messages.resolveBitsNone');
            details = this.t('commands.permissions.messages.resolveResult', { userId: targetUser.id, bits: grid, count: bitList.length });
        }

        await this.replyInfo(interaction, this.t('commands.permissions.titles.resolve'), details);
    }

    private async handleCache(interaction: ChatInputCommandInteraction, handler: PermissionsHandler, sub: string): Promise<void> {
        const guildId = interaction.guildId ?? undefined;
        if (!(await this.requireBit(interaction, 'bot.roles.manage', guildId))) return;
        if (sub !== 'clear') return;

        const target = interaction.options.getString('target', true);

        switch (target) {
            case 'user': {
                const user = interaction.options.getUser('user', false);
                if (!user) {
                    return this.replyContainer(interaction, false, this.t('commands.permissions.titles.cache'), this.t('commands.permissions.messages.cacheUserRequired'));
                }
                await handler.invalidateUser(user.id, guildId);
                return this.replyContainer(interaction, true, this.t('commands.permissions.titles.cache'),
                    this.t('commands.permissions.messages.cacheClearedUser', { userId: user.id }));
            }
            case 'guild': {
                if (!guildId) {
                    return this.replyContainer(interaction, false, this.t('commands.permissions.titles.cache'), this.t('commands.permissions.not_in_guild'));
                }
                await handler.invalidateGuild(guildId);
                return this.replyContainer(interaction, true, this.t('commands.permissions.titles.cache'),
                    this.t('commands.permissions.messages.cacheClearedGuild'));
            }
            case 'all': {
                await handler.clearCache();
                return this.replyContainer(interaction, true, this.t('commands.permissions.titles.cache'),
                    this.t('commands.permissions.messages.cacheClearedAll'));
            }
        }
    }
    private async handleLinks(
        interaction: ChatInputCommandInteraction,
        handler: PermissionsHandler,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId;
        if (!(await this.requireBit(interaction, 'bot.roles.manage', guildId ?? undefined))) return;

        if (sub === 'list') {
            const scopeRaw = interaction.options.getString('scope', false);
            const scope = scopeRaw === 'bot' || scopeRaw === 'server' ? scopeRaw : undefined;
            const links = await handler.listDiscordRoleLinks({
                scope,
                guildId: scope === 'bot' ? null : guildId ?? undefined,
            });
            if (links.length === 0) {
                return this.replyContainer(interaction, true, 'Role links', 'No Discord role links.');
            }
            const lines = links.map(
                (l) =>
                    `• **${l.scope}** discord=\`${l.discordRoleId}\` → perm=\`${l.permRoleId}\`` +
                    (l.guildId ? ` guild=\`${l.guildId}\`` : ''),
            );
            return this.replyContainer(interaction, true, 'Role links', lines.join('\n'));
        }

        if (sub === 'link' || sub === 'unlink') {
            const scope = interaction.options.getString('scope', true);
            if (scope !== 'bot' && scope !== 'server') {
                return this.replyContainer(interaction, false, 'Role links', 'Invalid scope.');
            }
            const discordRole = interaction.options.getRole('discord_role', true);
            const permRoleId = interaction.options.getString('perm_role', true);
            const gId = scope === 'bot' ? null : guildId;
            if (scope === 'server' && !gId) {
                return this.replyContainer(interaction, false, 'Role links', 'Not in a guild.');
            }
            if (sub === 'link') {
                await handler.linkDiscordRole({
                    scope,
                    guildId: gId,
                    discordRoleId: discordRole.id,
                    permRoleId,
                    createdBy: interaction.user.id,
                });
                return this.replyContainer(
                    interaction,
                    true,
                    'Role links',
                    `Linked <@&${discordRole.id}> → \`${permRoleId}\`.`,
                );
            }
            await handler.unlinkDiscordRole({
                scope,
                guildId: gId,
                discordRoleId: discordRole.id,
                permRoleId,
            });
            return this.replyContainer(
                interaction,
                true,
                'Role links',
                `Unlinked <@&${discordRole.id}> from \`${permRoleId}\`.`,
            );
        }

        if (sub === 'sync') {
            if (!guildId) {
                return this.replyContainer(interaction, false, 'Role links', 'Not in a guild.');
            }
            const result = await handler.syncDiscordRoleLinks(guildId);
            return this.replyContainer(
                interaction,
                true,
                'Role links',
                `Sync complete (${result.linked} link(s) in scope).`,
            );
        }
    }

    private async handleMirror(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
        const guildId = interaction.guildId;
        if (!guildId) {
            return this.replyContainer(interaction, false, 'Mirror', 'Not in a guild.');
        }
        if (!(await this.requireBit(interaction, 'server.roles.manage', guildId))) return;

        if (!permissionsManager) {
            return this.replyContainer(interaction, false, 'Mirror', 'Permissions unavailable.');
        }

        if (sub === 'status') {
            const state = await permissionsManager.getGuildDiscordMirror(guildId);
            return this.replyContainer(
                interaction,
                true,
                'Mirror',
                `Discord permission mirror is **${state.enabled ? 'enabled' : 'disabled'}** for this guild.`,
            );
        }

        if (sub === 'enable' || sub === 'disable') {
            const enabled = sub === 'enable';
            await permissionsManager.setGuildDiscordMirror(guildId, {
                enabled,
                updatedBy: interaction.user.id,
            });
            return this.replyContainer(
                interaction,
                true,
                'Mirror',
                `Mirror **${enabled ? 'enabled' : 'disabled'}**.`,
            );
        }
    }

}
