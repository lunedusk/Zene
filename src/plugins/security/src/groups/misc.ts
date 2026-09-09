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

export async function handleTempRole(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        if (!guild) return;
        const can = await host.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.WARN,
            guild.id,
        );
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.WARN }),
            );
            return;
        }
        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const durationRaw = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason') ?? undefined;
        const proof = extractProof(interaction.options.getAttachment('proof'));
        const ms = parseDurationMs(durationRaw);
        if (!ms || ms < 5_000) {
            await host.replyText(interaction, host.t('commands.security.errors.invalidDuration'));
            return;
        }
        const temp = host.heart.system.handler.$get<TempRoleHandler>('security', 'tempRole');
        if (!temp) {
            await host.replyText(interaction, host.t('commands.security.errors.temproleUnavailable'));
            return;
        }
        const result = await temp.apply({
            guild,
            userId: user.id,
            roleId: role.id,
            durationMs: ms,
            reason,
            actorId: interaction.user.id,
        });
        if (!result.ok) {
            await host.replyText(
                interaction,
                host.t('commands.security.temprole.fail', { detail: result.detail }),
            );
            return;
        }
        const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (store) {
            await store
                .recordInfraction({
                    guildId: guild.id,
                    userId: user.id,
                    actorId: interaction.user.id,
                    type: 'temprole',
                    reason: reason ?? null,
                    metadata: {
                        roleId: role.id,
                        durationMs: ms,
                        ...(proofMetadata(proof) ?? {}),
                    },
                })
                .catch(() => undefined);
        }
        {
            const msg = host.t('commands.security.temprole.ok', {
                user: user.tag,
                role: role.name,
                duration: durationRaw,
            });
            const pl = formatProofLine(proof);
            await host.replyText(
                interaction,
                pl ? `${msg}
${host.t('commands.security.results.proof', { proof: pl })}` : msg,
            );
        }
    }

export async function handleSetup(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.CONFIG_MANAGE,
                guildId,
            )) ||
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.AUTOMOD_MANAGE,
                guildId,
            )) ||
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.RAID,
                guildId,
            ));
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SERVER_BITS.CONFIG_MANAGE }),
            );
            return;
        }
        const wizard = host.heart.system.handler.$get<SetupWizardHandler>('security', 'setupWizard');
        if (!wizard) {
            await host.replyText(interaction, host.t('commands.security.errors.setupUnavailable'));
            return;
        }
        await wizard.openSetup(interaction);
    }

export async function handleStatus(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const wizard = host.heart.system.handler.$get<SetupWizardHandler>('security', 'setupWizard');
        if (!wizard) {
            await host.replyText(interaction, host.t('commands.security.errors.setupUnavailable'));
            return;
        }
        const text = await wizard.buildStatusText(guildId);
        await emitSecurityEvent(host.heart, SECURITY_EVENTS.STATUS_VIEW, {
            guildId,
            actorId: interaction.user.id,
        });
        await host.replyText(interaction, text);
    }

    // --- helpers ---

