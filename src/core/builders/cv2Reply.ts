import {
    MessageFlags,
    type ChatInputCommandInteraction,
    type InteractionReplyOptions,
    type MessageComponentInteraction,
    type ModalSubmitInteraction,
} from 'discord.js';
import { buildComponentsV2, type Cv2LayoutSpec } from '#core/builders/index.js';

export type Cv2ReplyInteraction =
    | ChatInputCommandInteraction
    | MessageComponentInteraction
    | ModalSubmitInteraction;

export interface Cv2TextReplyOptions {
    readonly content: string;
    readonly emoji?: string;
    readonly ephemeral?: boolean;
    readonly accentColor?: number | string;
    /** Prefer followUp when already replied (e.g. after a modal step). */
    readonly preferFollowUp?: boolean;
}

/**
 * Lang-backed (or plain) text inside a Components V2 container.
 * Falls back to classic content if Discord rejects the CV2 payload.
 */
export function buildCv2TextLayout(options: Cv2TextReplyOptions): Cv2LayoutSpec {
    const prefix = options.emoji ? `${options.emoji} ` : '';
    return {
        version: 1,
        components: [
            {
                type: 'container',
                accentColor: options.accentColor,
                children: [
                    {
                        type: 'text',
                        content: `${prefix}${options.content}`,
                    },
                ],
            },
        ],
    };
}

export async function replyCv2Text(
    interaction: Cv2ReplyInteraction,
    options: Cv2TextReplyOptions,
): Promise<void> {
    const ephemeral = options.ephemeral !== false;
    const layout = buildCv2TextLayout(options);
    const payload = buildComponentsV2(layout) as InteractionReplyOptions;
    const flags =
        (typeof payload.flags === 'number' ? payload.flags : 0) |
        (ephemeral ? MessageFlags.Ephemeral : 0);

        const sendPayload = { ...payload, flags };

    const useFollowUp =
        options.preferFollowUp === true ||
        (interaction.replied && !interaction.deferred);

    try {
        if (useFollowUp && interaction.replied) {
            await interaction.followUp(sendPayload);
            return;
        }
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(sendPayload);
            return;
        }
        await interaction.reply(sendPayload);
    } catch {
        try {
            if (useFollowUp && interaction.replied) {
                await interaction.followUp({
                    content: options.content,
                    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
                });
            } else if (interaction.deferred || interaction.replied) {
                // Ephemeral can't be set when editing an existing reply.
                await interaction.editReply({ content: options.content });
            } else {
                await interaction.reply({
                    content: options.content,
                    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
                });
            }
        } catch {
            // Swallow — caller often uses .catch(() => undefined) patterns for ephemeral UX.
        }
    }
}
