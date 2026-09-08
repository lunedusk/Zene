import type { ChatInputCommandInteraction, Guild, User } from 'discord.js';
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

export async function handleVerify(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const verify = host.heart.system.handler.$get<VerifyHandler>('security', 'verify');
        if (!verify) {
            await host.replyText(interaction, host.t('commands.security.errors.verifyUnavailable'));
            return;
        }
        const can = await host.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.VERIFY_MANAGE,
            guildId,
        );
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.VERIFY_MANAGE }),
            );
            return;
        }
        if (sub === 'settings') {
            const current = await verify.getSettings(guildId);
            const enabled = interaction.options.getBoolean('enabled');
            const verified = interaction.options.getRole('verified_role');
            const quarantine = interaction.options.getRole('quarantine_role');
            const next = {
                ...current,
                enabled: enabled ?? current.enabled,
                verifiedRoleId: verified?.id ?? current.verifiedRoleId,
                quarantineRoleId: quarantine?.id ?? current.quarantineRoleId,
                updatedAt: Date.now(),
            };
            await verify.saveSettings(next);
            if (quarantine) {
                await syncQuarantineRoleId(host.heart, guildId, quarantine.id);
            }
            await host.replyText(
                interaction,
                host.t('commands.security.verify.settingsResult', {
                    enabled: next.enabled ? 'on' : 'off',
                    verified: next.verifiedRoleId ?? '—',
                    quarantine: next.quarantineRoleId ?? '—',
                }),
            );
            return;
        }
        if (sub === 'panel') {
            const ch =
                interaction.options.getChannel('channel') ?? interaction.channel;
            if (!ch || !('send' in ch)) {
                await host.replyText(interaction, host.t('commands.security.errors.noTextChannel'));
                return;
            }
            try {
                await verify.postPanel(interaction, ch as import('discord.js').TextChannel);
                await host.replyText(interaction, host.t('commands.security.verify.panelPosted'));
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg === 'verify_disabled') {
                    await host.replyText(interaction, host.t('commands.security.verify.disabled'));
                } else {
                    await host.replyText(interaction, host.t('commands.security.verify.panelFail', { detail: msg }));
                }
            }
        }
    }



