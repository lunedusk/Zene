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

export async function handleAntiNuke(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const anti = host.heart.system.handler.$get<AntiNukeHandler>('security', 'antiNuke');
        if (!anti) {
            await host.replyText(interaction, host.t('commands.security.errors.antinukeUnavailable'));
            return;
        }
        const canView =
            (await host.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.ANTINUKE_VIEW, guildId)) ||
            (await host.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.ANTINUKE_MANAGE, guildId));
        const canManage = await host.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.ANTINUKE_MANAGE,
            guildId,
        );
        if (sub === 'status') {
            if (!canView) {
                await host.replyText(interaction, host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.ANTINUKE_VIEW }));
                return;
            }
            const rules = await anti.listRules(guildId);
            const enabled = rules.filter((r) => r.enabled);
            if (enabled.length === 0) {
                await host.replyText(interaction, host.t('commands.security.antinuke.statusEmpty'));
                return;
            }
            const lines = enabled.map(
                (r) =>
                    `• **${r.eventKey}** — max ${r.maxActions}/${Math.round(r.windowMs / 1000)}s → ${r.punishment}`,
            );
            await host.replyLines(interaction, host.t('commands.security.antinuke.statusHeader'), lines);
            return;
        }
        if (!canManage) {
            await host.replyText(interaction, host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.ANTINUKE_MANAGE }));
            return;
        }
        if (sub === 'rule') {
            const event = interaction.options.getString('event', true);
            if (!isAntiNukeEventKey(event)) {
                await host.replyText(interaction, host.t('commands.security.antinuke.unknownEvent'));
                return;
            }
            const current = await anti.getRule(guildId, event);
            const enabled = interaction.options.getBoolean('enabled');
            const maxActions = interaction.options.getInteger('max_actions');
            const windowSeconds = interaction.options.getInteger('window_seconds');
            const punishment = interaction.options.getString('punishment');
            const next = {
                ...current,
                enabled: enabled ?? current.enabled,
                maxActions: maxActions ?? current.maxActions,
                windowMs: windowSeconds != null ? windowSeconds * 1000 : current.windowMs,
                punishment:
                    punishment && isAntiNukePunishment(punishment)
                        ? punishment
                        : current.punishment,
                updatedAt: Date.now(),
            };
            await anti.upsertRule(next);
            await host.replyText(
                interaction,
                host.t('commands.security.antinuke.ruleResult', {
                    event,
                    enabled: next.enabled ? 'on' : 'off',
                    max: next.maxActions,
                    window: Math.round(next.windowMs / 1000),
                    punishment: next.punishment,
                }),
            );
            return;
        }
        if (sub === 'whitelist') {
            const event = interaction.options.getString('event', true);
            if (!isAntiNukeEventKey(event)) {
                await host.replyText(interaction, host.t('commands.security.antinuke.unknownEvent'));
                return;
            }
            const action = interaction.options.getString('action', true);
            const type = interaction.options.getString('type');
            const id = interaction.options.getString('id')?.trim();
            const current = await anti.getRule(guildId, event);
            if (action === 'list') {
                await host.replyText(
                    interaction,
                    host.t('commands.security.antinuke.whitelistList', {
                        event,
                        users: current.whitelistUserIds.join(', ') || '—',
                        roles: current.whitelistRoleIds.join(', ') || '—',
                    }),
                );
                return;
            }
            if (!type || !id || !/^\d{5,32}$/.test(id)) {
                await host.replyText(interaction, host.t('commands.security.antinuke.whitelistNeedId'));
                return;
            }
            const users = [...current.whitelistUserIds];
            const roles = [...current.whitelistRoleIds];
            const list = type === 'user' ? users : roles;
            if (action === 'add' && !list.includes(id)) list.push(id);
            if (action === 'remove') {
                const i = list.indexOf(id);
                if (i >= 0) list.splice(i, 1);
            }
            await anti.upsertRule({
                ...current,
                whitelistUserIds: type === 'user' ? list : users,
                whitelistRoleIds: type === 'role' ? list : roles,
                updatedAt: Date.now(),
            });
            await host.replyText(
                interaction,
                host.t('commands.security.antinuke.whitelistResult', { action, type, id, event }),
            );
        }
    }

