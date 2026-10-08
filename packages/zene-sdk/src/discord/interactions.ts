import type {
    ButtonInteraction,
    AnySelectMenuInteraction,
    ModalSubmitInteraction,
    ChatInputCommandInteraction,
} from 'discord.js';

export type SdkDiscordChatHandler = (
    interaction: ChatInputCommandInteraction,
) => Promise<void>;
export type SdkDiscordButtonHandler = (interaction: ButtonInteraction) => Promise<void>;
export type SdkDiscordSelectHandler = (
    interaction: AnySelectMenuInteraction,
) => Promise<void>;
export type SdkDiscordModalHandler = (interaction: ModalSubmitInteraction) => Promise<void>;
