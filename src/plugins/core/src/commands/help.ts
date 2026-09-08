import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { buildComponentsV2, replyCv2Text, type Cv2LayoutSpec } from '#core/builders/index.js';
import { HelpUtils } from '../utils/helpUtils.js';

export default class HelpCommand extends BaseCommand {

    public readonly data = new SlashCommandBuilder()
        .setName('help')
        .setDescription(this.t('commands.help.description'));

    public readonly config: CommandConfig = {
        permissionLevel: 'public',
        autoDefer: false,
        allowInDm: true
    };

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const config = this.heart.assets.config.get<any>('core');
        const isEphemeral = config?.help?.ephemeral ?? true;

        await interaction.deferReply(isEphemeral ? { flags: [MessageFlags.Ephemeral] } : {});

        try {
            const plugins = await HelpUtils.fetchEcosystemData(this.heart, interaction);
            const totalCmds = plugins.reduce((acc, p) => acc + p.commands.length, 0);

            const baseLayoutStr = this.t('layouts.helpContainer');
            const layout: Cv2LayoutSpec = JSON.parse(baseLayoutStr);
            const container = layout.components[0] as any;

            container.children.push({
                type: 'text',
                content: `**${HelpUtils.getEmoji(this.heart, 'menu')} ${this.t('commands.help.homeTitle')}**`
            }, { type: 'separator', spacing: 'small' }, {
                type: 'text',
                content: this.t('commands.help.homeDesc', { 
                    plugins: plugins.length, 
                    commands: totalCmds,
                    emoji_menu: HelpUtils.getEmoji(this.heart, 'menu'),
                    emoji_command: HelpUtils.getEmoji(this.heart, 'command')
                })
            });

            const PLUGINS_PER_PAGE = 100;
            const totalPages = Math.ceil(plugins.length / PLUGINS_PER_PAGE) || 1;
            const pagedPlugins = plugins.slice(0, PLUGINS_PER_PAGE);

            for (let i = 0; i < pagedPlugins.length; i += 25) {
                const chunk = pagedPlugins.slice(i, i + 25);
                container.children.push({
                    type: 'actionRow',
                    components: [{
                        type: 'selectMenu', kind: 'string',
                        customId: `core_help_nav:plugin:none:0`,
                        placeholder: this.t('commands.help.pluginSelectPlaceholder', { start: i + 1, end: i + chunk.length }),
                        options: chunk.map(p => ({
                            label: p.name, value: p.id, emoji: p.emoji,
                            description: `${p.commands.length} command(s)`
                        }))
                    }]
                });
            }

            if (totalPages > 1) {
                container.children.push({
                    type: 'actionRow',
                    components: [
                        { type: 'button', style: 'primary', customId: `core_help_nav:home:none:-1`, emoji: HelpUtils.getEmoji(this.heart, 'navLeft'), disabled: true, label: '\u200b' },
                        { type: 'button', style: 'secondary', customId: `mock_page_ind`, label: this.t('commands.help.pageFooter', { current: 1, total: totalPages }), disabled: true },
                        { type: 'button', style: 'primary', customId: `core_help_nav:home:none:1`, emoji: HelpUtils.getEmoji(this.heart, 'navRight'), disabled: totalPages <= 1, label: '\u200b' }
                    ]
                });
            }

            await interaction.editReply(buildComponentsV2(layout));

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.log.error(`Help Command Exception: ${err.message}`);
            await replyCv2Text(interaction, {
                content: 'Failed to generate the directory.',
                emoji: '❌',
                ephemeral: true,
            });
        }
    }
}