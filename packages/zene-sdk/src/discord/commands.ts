/**
 * Discord-specific command registration types.
 * Requires peer dependency `discord.js` at the plugin/host.
 */

import type {
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    SlashCommandBuilder,
} from 'discord.js';
import type { SdkCommandRequirements } from '../commands.js';

export interface SdkDiscordRootCommand {
    readonly name: string;
    readonly description: string;
    readonly build?: (builder: SlashCommandBuilder) => void;
    readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    readonly autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
    readonly requirements?: SdkCommandRequirements;
    readonly resync?: boolean;
}

export interface SdkDiscordCommandExtension {
    readonly rootName: string;
    readonly name: string;
    readonly description: string;
    readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    readonly requirements?: SdkCommandRequirements;
    readonly resync?: boolean;
}
