import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    type ButtonInteraction,
    type ModalSubmitInteraction,
} from 'discord.js';
import { BaseEvent } from '#core/bases/Event.js';
import { replyCv2Text } from '#core/builders/index.js';
import type VerifyHandler from '../handlers/verify.js';
import {
    VERIFY_BUTTON_ID,
    VERIFY_SUBMIT_PREFIX,
} from '../handlers/verify.js';

/**
 * Button + modal handlers for captcha verification.
 * Discord event name is a no-op placeholder; buttons/modals are registered on the class.
 */
export default class VerifyInteractionsEvent extends BaseEvent<[unknown]> {
    public readonly name = 'clientReady';
    public readonly once = true;

    public readonly buttons = new Map<
        string | RegExp,
        (interaction: ButtonInteraction, match?: RegExpMatchArray) => Promise<void>
    >([
        [
            VERIFY_BUTTON_ID,
            async (interaction) => {
                const verify = this.heart.system.handler.$get<VerifyHandler>('security', 'verify');
                if (!verify) {
                    await replyCv2Text(interaction, {
                        content: 'Verify handler unavailable.',
                        emoji: '⚠️',
                        ephemeral: true,
                    });
                    return;
                }
                await verify.startChallenge(interaction);
            },
        ],
        [
            new RegExp(`^${VERIFY_SUBMIT_PREFIX}(.+)$`),
            async (interaction, match) => {
                const userId = match?.[1];
                if (!userId || userId !== interaction.user.id) {
                    await replyCv2Text(interaction, {
                        content: 'This captcha is not for you.',
                        emoji: '🚫',
                        ephemeral: true,
                    });
                    return;
                }
                const modal = new ModalBuilder()
                    .setCustomId(`security:verify:modal:${interaction.user.id}`)
                    .setTitle('Enter captcha code');
                const input = new TextInputBuilder()
                    .setCustomId('code')
                    .setLabel('Code from the image')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(4)
                    .setMaxLength(10)
                    .setRequired(true);
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
                );
                await interaction.showModal(modal);
            },
        ],
    ]);

    public readonly modals = new Map<
        string | RegExp,
        (interaction: ModalSubmitInteraction, match?: RegExpMatchArray) => Promise<void>
    >([
        [
            /^security:verify:modal:(.+)$/,
            async (interaction, match) => {
                const userId = match?.[1];
                if (!userId || userId !== interaction.user.id) {
                    await replyCv2Text(interaction, {
                        content: 'This captcha is not for you.',
                        emoji: '🚫',
                        ephemeral: true,
                    });
                    return;
                }
                const code = interaction.fields.getTextInputValue('code');
                const verify = this.heart.system.handler.$get<VerifyHandler>('security', 'verify');
                if (!verify) {
                    await replyCv2Text(interaction, {
                        content: 'Verify handler unavailable.',
                        emoji: '⚠️',
                        ephemeral: true,
                    });
                    return;
                }
                await verify.submitCode(interaction, code);
            },
        ],
    ]);

    public async execute(): Promise<void> {
        // Registration only via buttons/modals maps.
    }
}
