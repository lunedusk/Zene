import { type Interaction, MessageFlags, type InteractionReplyOptions, REST, Routes, type Client } from 'discord.js';
import { performance } from 'node:perf_hooks';
import { guildGate } from '#core/manager/guildGate.js';
import { interactionRegistry } from './registry.js';
import { eventBus } from '#core/manager/event.js';
import { getLogger } from '#core/utils/logger.js';
import { cooldownManager } from '#core/manager/cooldown.js';
import { metricsManager } from '#core/manager/metrics/index.js';
import { secrets } from '#core/helpers/secretManager.js';
import { resolveGlobalPlaceholders } from '#core/placeholder/index.js';
import { permissionsManager, type RouteAccessConfig } from '#core/manager/permissions.js';
import { CrossGuildResolver } from '#core/helpers/crossGuild/index.js';
import { NovaError } from '#core/errors/NovaError.js';
import { errors } from '#core/errors/index.js';
import { replyFromUnknownError, replyDiscordActionError } from '#plugins/core/src/lib/discordActionErrors.js';

const log = getLogger('InteractionHandler');

type InteractionCategory = 'chat_command' | 'autocomplete' | 'button' | 'select_menu' | 'modal' | 'context_menu' | 'UNKNOWN';

interface ResolvedRoute {
    category: InteractionCategory;
    lookupKey: string;
    handler?: (interaction: any) => Promise<void>;
    access?: RouteAccessConfig;
    owner?: string;
}

export class InteractionHandler {
    private restClient: REST | null = null;

    public init(): void {
        eventBus.on('discord.interactionCreate', async (interaction: Interaction) => {
            this.process(interaction).catch((error: unknown) => {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Catastrophic failure in Interaction Pipeline: ${err.message}`, { stack: err.stack });
            });
        });
        log.info('Interaction Handler initialized and listening.');
    }

    public async syncCommands(client: Client<true>, guildId?: string): Promise<void> {
        if (!this.restClient) {
            this.restClient = new REST({ version: '10' }).setToken(secrets.get('DiscordToken'));
        }

        try {
            const chatEntries = interactionRegistry.chat.getEntries();
            const contextEntries = interactionRegistry.context.getEntries();

            const commandData = [
                ...Array.from(chatEntries.values()),
                ...Array.from(contextEntries.values())
            ]
            .filter(entry => entry.metadata?.data?.toJSON)
            .map(entry => entry.metadata!.data!.toJSON());

            if (commandData.length === 0) {
                log.warn('Command synchronization aborted: No valid command metadata found in registry.');
                return;
            }

            log.info(`Synchronizing ${commandData.length} interaction commands with Discord...`);

            const appId = client.user.id;
            const route = guildId
                ? Routes.applicationGuildCommands(appId, guildId)
                : Routes.applicationCommands(appId);

            await this.restClient.put(route, { body: commandData });

            log.info(`Successfully deployed commands ${guildId ? `to guild [${guildId}]` : 'globally'}.`);
            void import('#core/manager/event.js')
                .then(({ eventBus }) => eventBus.emitConcurrent('interaction.commands.synced', { count: commandData.length, guildId: guildId ?? null, global: !guildId }))
                .catch(() => undefined);

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Failed to synchronize commands with Discord API: ${err.message}`);
            throw err;
        }
    }

    public clearCrossGuildCache(): void {
        CrossGuildResolver.clearCache();
    }

    public clearUserCrossGuildCache(userId: string): void {
        CrossGuildResolver.clearUserCache(userId);
    }

    private async process(interaction: Interaction): Promise<void> {
        const startTime = performance.now();
        const route = this.resolveRoute(interaction);
        let isSuccess = false;

        const endDurationTimer = metricsManager.interactionDuration.startTimer();

        try {
            if (!route.handler) {
                if (interaction.isButton()) {
                    const { parseNavCustomId, Paginator } = await import('#core/paginator/index.js');
                    if (parseNavCustomId(interaction.customId)) {
                        const handled = await Paginator.handleButton(interaction);
                        if (handled) {
                            isSuccess = true;
                            return;
                        }
                    }
                }
                log.debug(`Unmapped interaction route: [${route.lookupKey}]`);
                metricsManager.interactionsTotal.inc({ type: route.category, command: route.lookupKey, status: 'unmapped' });
                return;
            }

            if (
                interaction.guildId &&
                !interaction.guild &&
                !interaction.isAutocomplete() &&
                interaction.isRepliable()
            ) {
                try {
                    const { ensureGuildOnClient } = await import('#core/helpers/guildAffinity.js');
                    const g = await ensureGuildOnClient(interaction.client, interaction.guildId);
                    if (!g) {
                        await replyDiscordActionError(interaction, 'not_in_guild');
                        metricsManager.interactionsTotal.inc({
                            type: route.category,
                            command: route.lookupKey,
                            status: 'wrong_shard',
                        });
                        return;
                    }
                } catch {
                    
                }
            }

            if (guildGate.isReady() && interaction.guildId) {
                const blocked = guildGate.isInteractionBlocked(route.owner, interaction.guildId);
                if (blocked) {
                    let isOwner = false;
                    try {
                        const resolved = await permissionsManager!.cachedResolve(
                            interaction.user.id,
                            interaction.guildId ?? undefined,
                            interaction.guild?.ownerId
                        );
                        isOwner = !!resolved.botOwner;
                    } catch {
                        
                    }

                    if (!isOwner) {
                        metricsManager.interactionsTotal.inc({
                            type: route.category,
                            command: route.lookupKey,
                            status: 'guild_gated'
                        });
                        if (interaction.isAutocomplete()) {
                            await interaction.respond([]).catch(() => {});
                            return;
                        }
                        if (interaction.isRepliable()) {
                            const payload = {
                                content: resolveGlobalPlaceholders(
                                    '%%emoji_no_entry%% This feature is disabled in this server by the bot owner.'
                                ),
                                flags: [MessageFlags.Ephemeral] as const
                            };
                            if (interaction.deferred || interaction.replied) {
                                await interaction.followUp(payload).catch(() => {});
                            } else {
                                await interaction.reply(payload).catch(() => {});
                            }
                        }
                        return;
                    }
                }
            }

            const access = await permissionsManager!.canExecute(interaction, route.access);
            if (!access.allowed) {
                metricsManager.interactionsTotal.inc({ type: route.category, command: route.lookupKey, status: 'denied' });

                if (interaction.isAutocomplete()) {
                    await interaction.respond([]).catch(() => {});
                    return;
                }

                await permissionsManager!.sendDenied(interaction, access.reason);
                return;
            }

            if (!interaction.isAutocomplete()) {
                const isGlobalEnabled = secrets.getBoolean('EnableGlobalRatelimit', true);

                if (isGlobalEnabled) {
                    const cooldown = await cooldownManager.isRateLimited('global', {
                        userId: interaction.user.id,
                        guildId: interaction.guildId ?? 'dm',
                        commandId: route.lookupKey
                    });

                    if (cooldown.limited) {
                        metricsManager.rateLimitsTotal.inc({ bucket: 'global' });
                        metricsManager.interactionsTotal.inc({ type: route.category, command: route.lookupKey, status: 'rate_limited' });
                        await this.sendSystemState(interaction, 'RATE_LIMIT', cooldown.remaining);
                        return;
                    }
                }
            }

            {
                const { guildLocale } = await import('#core/manager/guildLocale.js');
                await guildLocale.runWithContextAsync(
                    { guildId: interaction.guildId ?? null },
                    async () => {
                        await route.handler!(interaction);
                    },
                );
            }
            isSuccess = true;

        } catch (error: unknown) {
            try {
                const isNova = NovaError.isNovaError(error);
                if (isNova) {
                    log.error(
                        `[Execution Error] Route: ${route.lookupKey} | CODE: ${error.code} | MSG: ${error.message}`,
                        { stack: error.stack, category: error.category, severity: error.severity },
                    );
                } else {
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(
                        `[Execution Error] Route: ${route.lookupKey} | MSG: ${err.message}`,
                        { stack: err.stack },
                    );
                }

                void errors
                    .record({
                        code: isNova ? error.code : 'INTERNAL.UNKNOWN',
                        category: isNova ? error.category : 'internal',
                        severity: isNova ? error.severity : 'error',
                        message: isNova ? error.userMessage : 'Interaction execution failure',
                        context: {
                            path: route.lookupKey,
                            code: isNova ? error.code : 'INTERNAL.UNKNOWN',
                            actorId: interaction.user?.id ?? null,
                            actorType: 'user',
                            guildId: interaction.guildId ?? null,
                        },
                    })
                    .catch(() => {});

                if (!isNova) {
                    try {
                        await replyFromUnknownError(interaction, error, true);
                        return;
                    } catch {
                        
                    }
                }
                const replyText = isNova ? error.userMessage : undefined;
                await this.sendSystemState(interaction, 'FATAL_ERROR', undefined, replyText);
            } catch (boundaryErr: unknown) {
                const e = boundaryErr instanceof Error ? boundaryErr : new Error(String(boundaryErr));
                log.error(`Interaction error boundary failed: ${e.message}`);
                try {
                    await this.sendSystemState(interaction, 'FATAL_ERROR');
                } catch {

                }
            }
        } finally {
            const execTime = performance.now() - startTime;

            endDurationTimer({ command: route.lookupKey });

            metricsManager.interactionsTotal.inc({
                type: route.category,
                command: route.lookupKey,
                status: isSuccess ? 'success' : 'error'
            });

            if (execTime > 5000 && !interaction.isAutocomplete()) {
                log.warn(`[Telemetry] ${route.lookupKey} exceeded performance threshold (${execTime.toFixed(2)}ms).`);
            }
        }
    }

    private resolveRoute(interaction: Interaction): ResolvedRoute {
        if (interaction.isChatInputCommand()) {
            const resolved = interactionRegistry.chat.resolve(interaction.commandName);
            return {
                category: 'chat_command',
                lookupKey: interaction.commandName,
                handler: resolved?.handler,
                access: resolved?.metadata?.access,
                owner: resolved?.owner
            };
        }
        if (interaction.isAutocomplete()) {
            const resolved = interactionRegistry.autocomplete.resolve(interaction.commandName);
            return {
                category: 'autocomplete',
                lookupKey: interaction.commandName,
                handler: resolved?.handler,
                access: resolved?.metadata?.access,
                owner: resolved?.owner
            };
        }
        if (interaction.isButton()) {
            const resolved = interactionRegistry.button.resolve(interaction.customId);
            return {
                category: 'button',
                lookupKey: interaction.customId,
                handler: resolved?.handler,
                access: resolved?.metadata?.access,
                owner: resolved?.owner
            };
        }
        if (interaction.isAnySelectMenu()) {
            const resolved = interactionRegistry.select.resolve(interaction.customId);
            return {
                category: 'select_menu',
                lookupKey: interaction.customId,
                handler: resolved?.handler,
                access: resolved?.metadata?.access,
                owner: resolved?.owner
            };
        }
        if (interaction.isModalSubmit()) {
            const resolved = interactionRegistry.modal.resolve(interaction.customId);
            return {
                category: 'modal',
                lookupKey: interaction.customId,
                handler: resolved?.handler,
                access: resolved?.metadata?.access,
                owner: resolved?.owner
            };
        }
        if (interaction.isContextMenuCommand()) {
            const resolved = interactionRegistry.context.resolve(interaction.commandName);
            return {
                category: 'context_menu',
                lookupKey: interaction.commandName,
                handler: resolved?.handler,
                access: resolved?.metadata?.access,
                owner: resolved?.owner
            };
        }

        return { category: 'UNKNOWN', lookupKey: 'UNKNOWN' };
    }

    private async sendSystemState(
        interaction: Interaction,
        state: 'FATAL_ERROR' | 'RATE_LIMIT',
        contextData?: number,
        userMessage?: string,
    ): Promise<void> {
        if (interaction.isAutocomplete()) {
            if (!interaction.responded) await interaction.respond([]).catch(() => {});
            return;
        }

        if (interaction.isRepliable()) {
            const payload: InteractionReplyOptions = {
                flags: [MessageFlags.Ephemeral]
            };

            switch (state) {
                case 'FATAL_ERROR':
                    payload.content = resolveGlobalPlaceholders(
                        userMessage
                            ? `%%emoji_cross%% ${userMessage}`
                            : '%%emoji_cross%% A critical internal error occurred while processing your request.',
                    );
                    break;
                case 'RATE_LIMIT': {
                    const remainingSec = ((contextData ?? 0) / 1000).toFixed(1);
                    payload.content = resolveGlobalPlaceholders(`%%emoji_clock%% Please wait **${remainingSec}s** before interacting again.`);
                    break;
                }
            }

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp(payload);
                } else {
                    await interaction.reply(payload);
                }
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`Failed to dispatch system state [${state}]: ${err.message}`);
            }
        }
    }
}

export const interactionHandler = new InteractionHandler();