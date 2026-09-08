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

export async function handleRaid(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const raid = host.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        if (!raid) {
            await host.replyText(interaction, host.t('commands.security.errors.raidUnavailable'));
            return;
        }
        const can = await host.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.RAID,
            guildId,
        );
        if (!can) {
            await host.replyText(interaction, host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.RAID }));
            return;
        }
        if (sub === 'status') {
            const s = await raid.getSettings(guildId);
            const active = await raid.isRaidActive(guildId);
            await host.replyText(
                interaction,
                host.t('commands.security.raid.statusResult', {
                    enabled: s.enabled ? 'on' : 'off',
                    active: active ? 'yes' : 'no',
                    maxJoins: s.maxJoins,
                    window: Math.round(s.windowMs / 1000),
                    action: s.action,
                    quarantine: s.quarantineRoleId ?? '—',
                    joinRole: s.joinRoleId ?? '—',
                }),
            );
            return;
        }
        if (sub === 'enable' || sub === 'disable') {
            const s = await raid.setEnabled(guildId, sub === 'enable');
            await host.replyText(
                interaction,
                host.t('commands.security.raid.toggleResult', { enabled: s.enabled ? 'on' : 'off' }),
            );
            return;
        }
        if (sub === 'set') {
            const current = await raid.getSettings(guildId);
            const maxJoins = interaction.options.getInteger('max_joins');
            const windowSeconds = interaction.options.getInteger('window_seconds');
            const action = interaction.options.getString('action') as typeof current.action | null;
            const qRole = interaction.options.getRole('quarantine_role');
            const jRole = interaction.options.getRole('join_role');
            const next = {
                ...current,
                maxJoins: maxJoins ?? current.maxJoins,
                windowMs: windowSeconds != null ? windowSeconds * 1000 : current.windowMs,
                action: action ?? current.action,
                quarantineRoleId: qRole?.id ?? current.quarantineRoleId,
                joinRoleId: jRole?.id ?? current.joinRoleId,
                updatedAt: Date.now(),
            };
            await raid.saveSettings(next);
            if (qRole) {
                await syncQuarantineRoleId(host.heart, guildId, qRole.id);
            }
            await host.replyText(interaction, host.t('commands.security.raid.setResult'));
        }
    }

