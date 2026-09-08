import type { ButtonInteraction } from 'discord.js';
import { BaseEvent } from '#core/bases/Event.js';
import { replyCv2Text } from '#core/builders/index.js';
import type SetupWizardHandler from '../handlers/setupWizard.js';
import { SETUP_IDS } from '../lib/setupLayouts.js';

export default class SetupInteractionsEvent extends BaseEvent<[unknown]> {
    public readonly name = 'clientReady';
    public readonly once = true;

    public readonly buttons = new Map<
        string | RegExp,
        (interaction: ButtonInteraction, match?: RegExpMatchArray) => Promise<void>
    >([
        [
            SETUP_IDS.AUTOMOD,
            async (interaction) => {
                const wizard = this.getWizard();
                if (!wizard) return this.unavailable(interaction);
                await wizard.toggleAutomod(interaction);
            },
        ],
        [
            SETUP_IDS.RAID,
            async (interaction) => {
                const wizard = this.getWizard();
                if (!wizard) return this.unavailable(interaction);
                await wizard.toggleRaid(interaction);
            },
        ],
        [
            SETUP_IDS.VERIFY,
            async (interaction) => {
                const wizard = this.getWizard();
                if (!wizard) return this.unavailable(interaction);
                await wizard.toggleVerify(interaction);
            },
        ],
        [
            SETUP_IDS.ANTINUKE_SAFE,
            async (interaction) => {
                const wizard = this.getWizard();
                if (!wizard) return this.unavailable(interaction);
                await wizard.toggleAntinukeSafe(interaction);
            },
        ],
        [
            SETUP_IDS.REFRESH,
            async (interaction) => {
                const wizard = this.getWizard();
                if (!wizard) return this.unavailable(interaction);
                await wizard.refreshPanel(interaction);
            },
        ],
        [
            SETUP_IDS.CLOSE,
            async (interaction) => {
                if (interaction.message.deletable) {
                    await interaction.message.delete().catch(() => undefined);
                } else {
                    await interaction.update({ content: 'Setup closed.', components: [], embeds: [] }).catch(
                        async () => {
                            await replyCv2Text(interaction, {
                                content: 'Setup closed.',
                                emoji: '🛡️',
                                ephemeral: true,
                            });
                        },
                    );
                }
            },
        ],
    ]);

    public async execute(): Promise<void> {
        // Button maps only.
    }

    private getWizard(): SetupWizardHandler | undefined {
        return this.heart.system.handler.$get<SetupWizardHandler>('security', 'setupWizard');
    }

    private async unavailable(interaction: ButtonInteraction): Promise<void> {
        await replyCv2Text(interaction, {
            content: 'Setup wizard unavailable.',
            emoji: '⚠️',
            ephemeral: true,
        });
    }
}
