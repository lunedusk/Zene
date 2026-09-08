import type { ChatInputCommandInteraction, Guild, GuildTextBasedChannel, User } from 'discord.js';
import type { SecurityCmdHost } from './host.js';
import type AntiNukeHandler from '../../handlers/antiNuke.js';
import type AutoModHandler from '../../handlers/autoMod.js';
import type RaidGuardHandler from '../../handlers/raidGuard.js';
import type SetupWizardHandler from '../../handlers/setupWizard.js';
import type TempRoleHandler from '../../handlers/tempRole.js';
import type VerifyHandler from '../../handlers/verify.js';
import type FreezeControllerHandler from '../../handlers/freezeController.js';
import type ModerationBridgeHandler from '../../handlers/moderationBridge.js';
import type SecurityStoreHandler from '../../handlers/store.js';
import type ViolationTrackerHandler from '../../handlers/violationTracker.js';
import { SECURITY_BITS, SERVER_BITS } from '../../lib/bits.js';
import { FILTER_NAMES, isFilterName } from '../../lib/autoModFilters.js';
import { normalizeBlacklistPattern } from '../../lib/blacklists.js';
import { extractProof, formatProofLine, proofMetadata } from '../../lib/proof.js';
import {
    ANTI_NUKE_EVENT_KEYS,
    isAntiNukeEventKey,
    isAntiNukePunishment,
    defaultAntiNukeRule,
} from '../../lib/antiNukeEvents.js';
import type { AutoModFilterName, BlacklistKind, PunishOp } from '../../lib/types.js';
import {
    checkActionCooldown,
    defaultCooldownMs,
    setActionCooldown,
    type CooldownOp,
} from '../../lib/cooldowns.js';
import {
    clampTempbanMs,
    clampTimeoutMs,
    formatDurationMs,
    parseDurationMs,
} from '../../lib/duration.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../../lib/events.js';
import { parseGuildsOption, resolveAuthorizedGuilds } from '../../lib/guildTargeting.js';
import { getSnipes } from '../../lib/snipeCache.js';
import { syncQuarantineRoleId } from '../../lib/quarantineRole.js';
import type {
    ActionBatchResult,
    GuildAuthzDecision,
    SecurityActor,
} from '../../lib/types.js';
import { OP_BIT, PUNISH_OPS, actorFrom } from '../punishMeta.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { randomBytes } from 'node:crypto';

export async function handlePurge(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.PURGE, guildId))) return;
        if (await host.denyIfCooldown(interaction, guildId, 'purge')) return;

        const amount = interaction.options.getInteger('amount', true);
        const filterUser = interaction.options.getUser('user');
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            await host.replyText(interaction, host.t('commands.security.errors.noTextChannel'));
            return;
        }

        const me = interaction.guild?.members.me;
        if (!me?.permissionsIn(channel.id).has(PermissionFlagsBits.ManageMessages)) {
            await host.replyText(interaction, host.t('commands.security.errors.botMissingManageMessages'));
            return;
        }

        const fetched = await channel.messages.fetch({ limit: Math.min(amount, 100) });
        const twoWeeks = Date.now() - 14 * 86_400_000;
        let toDelete = [...fetched.values()].filter((m) => m.createdTimestamp > twoWeeks);
        if (filterUser) {
            toDelete = toDelete.filter((m) => m.author.id === filterUser.id);
        }
        toDelete = toDelete.slice(0, amount);

        if (toDelete.length === 0) {
            await host.replyText(interaction, host.t('commands.security.purge.empty'));
            return;
        }

        const deleted = await (channel as GuildTextBasedChannel)
            .bulkDelete(toDelete, true)
            .catch(() => null);
        const count = deleted?.size ?? 0;

        await emitSecurityEvent(host.heart, SECURITY_EVENTS.PURGE, {
            guildId,
            channelId: channel.id,
            actorId: interaction.user.id,
            count,
            filterUserId: filterUser?.id ?? null,
        });
        await setActionCooldown(host.heart, guildId, interaction.user.id, 'purge', defaultCooldownMs('purge'));
        await host.replyText(
            interaction,
            host.t('commands.security.purge.success', { count }),
        );
    }

export async function handleSnipe(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.SNIPE, guildId))) return;

        const ch =
            interaction.options.getChannel('channel') ?? interaction.channel;
        if (!ch || !('id' in ch)) {
            await host.replyText(interaction, host.t('commands.security.errors.noTextChannel'));
            return;
        }
        const entries = await getSnipes(host.heart, guildId, ch.id);
        if (entries.length === 0) {
            await host.replyText(interaction, host.t('commands.security.snipe.empty'));
            return;
        }
        const latest = entries[0];
        if (!latest) {
            await host.replyText(interaction, host.t('commands.security.snipe.empty'));
            return;
        }
        await emitSecurityEvent(host.heart, SECURITY_EVENTS.SNIPE, {
            guildId,
            channelId: ch.id,
            actorId: interaction.user.id,
        });
        await host.replyText(
            interaction,
            host.t('commands.security.snipe.result', {
                author: latest.authorTag,
                content: latest.content || host.t('commands.security.snipe.noContent'),
                at: new Date(latest.deletedAt).toISOString(),
                attachments: latest.attachmentUrls.length
                    ? latest.attachmentUrls.join('\n')
                    : host.t('commands.security.snipe.noAttachments'),
            }),
        );
    }

export async function handleChannelLock(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        lock: boolean,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.LOCKDOWN, guildId))) return;

        const freeze = host.heart.system.handler.$get<FreezeControllerHandler>(
            'security',
            'freezeController',
        );
        if (!freeze) {
            await host.replyText(interaction, host.t('commands.security.errors.freezeUnavailable'));
            return;
        }

        const chOption = interaction.options.getChannel('channel');
        const channel = (chOption ?? interaction.channel) as {
            id: string;
            guild: Guild;
            permissionOverwrites: import('discord.js').GuildChannel['permissionOverwrites'];
            manageable?: boolean;
        } | null;

        if (!channel || !('permissionOverwrites' in channel)) {
            await host.replyText(interaction, host.t('commands.security.errors.noTextChannel'));
            return;
        }

        const ok = lock
            ? await freeze.lockChannel(channel as never)
            : await freeze.unlockChannel(channel as never);

        await emitSecurityEvent(
            host.heart,
            lock ? SECURITY_EVENTS.CHANNEL_LOCK : SECURITY_EVENTS.CHANNEL_UNLOCK,
            { guildId, channelId: channel.id, actorId: interaction.user.id },
        );

        await host.replyText(
            interaction,
            ok
                ? host.t(lock ? 'commands.security.lock.success' : 'commands.security.unlock.success', {
                      channel: `<#${channel.id}>`,
                  })
                : host.t('commands.security.lock.fail'),
        );
    }

export async function handleSlowmode(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.LOCKDOWN, guildId))) return;

        const seconds = interaction.options.getInteger('seconds', true);
        const chOption = interaction.options.getChannel('channel');
        const channel = chOption ?? interaction.channel;
        if (!channel || !('setRateLimitPerUser' in channel)) {
            await host.replyText(interaction, host.t('commands.security.errors.noTextChannel'));
            return;
        }

        try {
            await (channel as GuildTextBasedChannel).setRateLimitPerUser(
                seconds,
                `Security slowmode by ${interaction.user.id}`,
            );
            await emitSecurityEvent(host.heart, SECURITY_EVENTS.SLOWMODE, {
                guildId,
                channelId: channel.id,
                actorId: interaction.user.id,
                seconds,
            });
            await host.replyText(
                interaction,
                host.t('commands.security.slowmode.success', {
                    channel: `<#${channel.id}>`,
                    seconds,
                }),
            );
        } catch {
            await host.replyText(interaction, host.t('commands.security.slowmode.fail'));
        }
    }

    // --- Phase 3: AutoMod ---

