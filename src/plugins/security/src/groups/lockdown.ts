import type { ChatInputCommandInteraction, Guild, User } from 'discord.js';
import type { SecurityCmdHost } from './host.js';
import type AntiNukeHandler from '../handlers/antiNuke.js';
import type AutoModHandler from '../handlers/autoMod.js';
import type RaidGuardHandler from '../handlers/raidGuard.js';
import type SetupWizardHandler from '../handlers/setupWizard.js';
import type TempRoleHandler from '../handlers/tempRole.js';
import type VerifyHandler from '../handlers/verify.js';
import type FreezeControllerHandler from '../handlers/freezeController.js';
import type ModerationBridgeHandler from '../handlers/moderationBridge.js';
import type SecurityStoreHandler from '../handlers/store.js';
import type ViolationTrackerHandler from '../handlers/violationTracker.js';
import { SECURITY_BITS, SERVER_BITS } from '../lib/bits.js';
import { FILTER_NAMES, isFilterName } from '../lib/autoModFilters.js';
import { normalizeBlacklistPattern } from '../lib/blacklists.js';
import { extractProof, formatProofLine, proofMetadata } from '../lib/proof.js';
import {
    ANTI_NUKE_EVENT_KEYS,
    isAntiNukeEventKey,
    isAntiNukePunishment,
    defaultAntiNukeRule,
} from '../lib/antiNukeEvents.js';
import type { AutoModFilterName, BlacklistKind, PunishOp } from '../lib/types.js';
import {
    checkActionCooldown,
    defaultCooldownMs,
    setActionCooldown,
    type CooldownOp,
} from '../lib/cooldowns.js';
import {
    clampTempbanMs,
    clampTimeoutMs,
    formatDurationMs,
    parseDurationMs,
} from '../lib/duration.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import { parseGuildsOption, resolveAuthorizedGuilds } from '../lib/guildTargeting.js';
import { getSnipes } from '../lib/snipeCache.js';
import { syncQuarantineRoleId } from '../lib/quarantineRole.js';
import type {
    ActionBatchResult,
    GuildAuthzDecision,
    SecurityActor,
} from '../lib/types.js';
import { OP_BIT, PUNISH_OPS, actorFrom } from '../commands/punishMeta.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { randomBytes } from 'node:crypto';

export async function handleLockdown(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guild = interaction.guild as Guild;
        const guildId = guild.id;
        const can =
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.LOCKDOWN,
                guildId,
            )) ||
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.FREEZE,
                guildId,
            ));
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.LOCKDOWN }),
            );
            return;
        }

        const freeze = host.heart.system.handler.$get<FreezeControllerHandler>(
            'security',
            'freezeController',
        );
        if (!freeze) {
            await host.replyText(interaction, host.t('commands.security.errors.freezeUnavailable'));
            return;
        }

        if (sub === 'status') {
            const state = await freeze.getStatus(guildId);
            if (!state?.active) {
                await host.replyText(interaction, host.t('commands.security.lockdown.statusOff'));
                return;
            }
            await host.replyText(
                interaction,
                host.t('commands.security.lockdown.statusOn', {
                    pauseInvites: state.pauseInvites ? 'yes' : 'no',
                    lockChannels: state.lockChannels ? 'yes' : 'no',
                    quarantineJoins: state.quarantineJoins ? 'yes' : 'no',
                    reason: state.reason ?? host.t('commands.security.results.noReason'),
                    until: state.invitesPausedUntil
                        ? new Date(state.invitesPausedUntil).toISOString()
                        : '—',
                }),
            );
            return;
        }

        if (sub === 'off') {
            if (await host.denyIfCooldown(interaction, guildId, 'lockdown')) return;
            const result = await freeze.disable(guild, actorFrom(interaction.user));
            if (!result.ok) {
                await host.replyText(
                    interaction,
                    host.t('commands.security.lockdown.offFail', {
                        detail: result.detail ?? 'unknown',
                    }),
                );
                return;
            }
            await setActionCooldown(
                host.heart,
                guildId,
                interaction.user.id,
                'lockdown',
                defaultCooldownMs('lockdown'),
            );
            await host.replyText(interaction, host.t('commands.security.lockdown.offSuccess'));
            return;
        }

        // on
        if (await host.denyIfCooldown(interaction, guildId, 'lockdown')) return;
        const pauseInvites = interaction.options.getBoolean('pause_invites') ?? true;
        const lockChannels = interaction.options.getBoolean('lock_channels') ?? true;
        const quarantineJoins = interaction.options.getBoolean('quarantine_joins') ?? false;
        const reason = interaction.options.getString('reason')?.trim();

        if (!pauseInvites && !lockChannels && !quarantineJoins) {
            await host.replyText(interaction, host.t('commands.security.lockdown.needFilter'));
            return;
        }

        const result = await freeze.enable(guild, actorFrom(interaction.user), {
            pauseInvites,
            lockChannels,
            quarantineJoins,
            reason,
        });
        if (!result.ok) {
            await host.replyText(
                interaction,
                host.t('commands.security.lockdown.onFail', {
                    detail: result.detail ?? 'unknown',
                }),
            );
            return;
        }
        await setActionCooldown(
            host.heart,
            guildId,
            interaction.user.id,
            'lockdown',
            defaultCooldownMs('lockdown'),
        );
        await host.replyText(
            interaction,
            host.t('commands.security.lockdown.onSuccess', {
                pauseInvites: pauseInvites ? 'yes' : 'no',
                lockChannels: lockChannels ? 'yes' : 'no',
                quarantineJoins: quarantineJoins ? 'yes' : 'no',
            }),
        );
    }

    // --- purge / snipe / lock / slowmode ---

