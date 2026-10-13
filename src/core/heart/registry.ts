import type { IHeart } from './index.js';
import { BaseCommand } from '#core/bases/Command.js';

import { BaseMiddleware } from '#core/bases/Middleware.js';
import { registerRootCommand, extendCommand, listCommandTree, freezeCommandStructure, isCommandStructureFrozen, type CommandExtension } from '#core/loader/commandRegistry.js';
import { registerMiddlewareInstance } from '#core/loader/middlewares.js';
import type { RegisterRequirements } from '#core/loader/requirements.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandConfig } from '#core/bases/Command.js';

export interface CommandDefinition {
    name: string;
    description: string;
    requirements?: RegisterRequirements;
    config?: CommandConfig;
    actions?: readonly unknown[];
    build: (builder: SlashCommandBuilder, heart: IHeart) => SlashCommandBuilder | void;
    execute: (interaction: ChatInputCommandInteraction, heart: IHeart) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction, heart: IHeart) => Promise<void>;
}

export interface RegistryDomain {
    registerCommand(
        input: BaseCommand | (new (heart: IHeart) => BaseCommand) | CommandDefinition,
        options?: { resync?: boolean },
    ): Promise<boolean>;
    extendCommand(
        rootName: string,
        extension: CommandExtension,
        options?: { resync?: boolean },
    ): Promise<boolean>;
    registerCommandDefinition(
        def: CommandDefinition,
        options?: { resync?: boolean },
    ): Promise<boolean>;
    registerMiddleware(input: BaseMiddleware | (new (heart: IHeart) => BaseMiddleware)): Promise<boolean>;
    listCommandTree(): ReturnType<typeof listCommandTree>;
    freezeCommandStructure(): void;
    isCommandStructureFrozen(): boolean;
    resyncApplicationCommands(guildId?: string): Promise<void>;
}

export function createRegistryDomain(heart: IHeart): RegistryDomain {
    return {
        async registerCommand(input, options) {
            if (typeof input === 'function') {
                const instance = new input(heart);
                return this.registerCommand(instance, options);
            }
            if (input instanceof BaseCommand) {
                return registerRootCommand({
                    heart,
                    pluginId: heart.id,
                    data: input.data as SlashCommandBuilder,
                    config: input.config,
                    execute: (i) => input.execute(i),
                    autocomplete:
                        typeof input.autocomplete === 'function'
                            ? (i) => input.autocomplete!(i)
                            : undefined,
                    requirements: input.config.requirements,
                    resync: options?.resync,
                });
            }
            return this.registerCommandDefinition(input, options);
        },

        async registerCommandDefinition(def, options) {
            const builder = new (await import('discord.js')).SlashCommandBuilder()
                .setName(def.name)
                .setDescription(def.description);
            def.build(builder, heart);
            return registerRootCommand({
                heart,
                pluginId: heart.id,
                data: builder,
                config: def.config ?? {},
                execute: (i) => def.execute(i, heart),
                autocomplete: def.autocomplete
                    ? (i) => def.autocomplete!(i, heart)
                    : undefined,
                requirements: def.requirements ?? def.config?.requirements,
                resync: options?.resync,
            });
        },

        async extendCommand(rootName, extension, options) {
            return extendCommand(heart, heart.id, rootName, extension, options);
        },

        async registerMiddleware(input) {
            const instance =
                typeof input === 'function' ? new input(heart) : input;
            return registerMiddlewareInstance(heart, heart.id, instance);
        },

        listCommandTree,

        freezeCommandStructure,

        isCommandStructureFrozen,

        async resyncApplicationCommands(guildId) {
            const { interactionHandler } = await import(
                '#core/manager/interaction/handler.js'
            );
            await interactionHandler.syncCommands(heart.client, guildId);
            try {
                const { HelpUtils } = await import('#plugins/core/src/utils/helpUtils.js');
                HelpUtils.clearCache();
            } catch {
            }
            const { eventBus } = await import('#core/manager/event.js');
            await eventBus.emitConcurrent('commands.structure.resync', {
                guildId: guildId ?? null,
                at: Date.now(),
                tree: listCommandTree(),
            });
        },
    };
}
