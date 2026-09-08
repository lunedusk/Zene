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

export async function handleViolations(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.VIOLATIONS_EDIT, guildId))) return;

        const tracker = host.heart.system.handler.$get<ViolationTrackerHandler>(
            'security',
            'violationTracker',
        );
        if (!tracker) {
            await host.replyText(interaction, host.t('commands.security.errors.trackerUnavailable'));
            return;
        }

        const target = interaction.options.getUser('user', true);

        if (sub === 'view') {
            const row = await tracker.get(guildId, target.id);
            await host.replyText(
                interaction,
                host.t('commands.security.violations.viewResult', {
                    user: target.username,
                    points: row?.points ?? 0,
                    last: row ? new Date(row.lastActivityAt).toISOString() : '—',
                }),
            );
            return;
        }
        if (sub === 'set') {
            const points = interaction.options.getInteger('points', true);
            const row = await tracker.set(guildId, target.id, points, interaction.user.id);
            await host.replyText(
                interaction,
                host.t('commands.security.violations.setResult', {
                    user: target.username,
                    points: row.points,
                }),
            );
            return;
        }
        if (sub === 'add') {
            const points = interaction.options.getInteger('points', true);
            const row = await tracker.add(guildId, target.id, points, interaction.user.id);
            await host.replyText(
                interaction,
                host.t('commands.security.violations.addResult', {
                    user: target.username,
                    points: row.points,
                    delta: points,
                }),
            );
            return;
        }
        if (sub === 'reset') {
            const row = await tracker.reset(guildId, target.id, interaction.user.id);
            await host.replyText(
                interaction,
                host.t('commands.security.violations.resetResult', {
                    user: target.username,
                    points: row.points,
                }),
            );
        }
    }

    // --- lockdown ---

