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

export async function handlePunish(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        op: PunishOp,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const target = interaction.options.getUser('user', true);
        const reasonRaw = interaction.options.getString('reason');
        const reason = reasonRaw && reasonRaw.trim().length > 0 ? reasonRaw.trim() : undefined;
        const guildsRaw = interaction.options.getString('guilds');
        const deleteDays = interaction.options.getInteger('delete_days');
        const durationRaw = interaction.options.getString('duration');
        const proof = extractProof(interaction.options.getAttachment('proof'));

        const requiredBit = OP_BIT[op];
        const hasLocalBit = await host.heart.permissions.hasBit(
            interaction.user.id,
            requiredBit,
            guildId,
        );
        const targeting = parseGuildsOption(guildsRaw, guildId);
        const isMulti =
            targeting.all ||
            targeting.ids.length > 1 ||
            (targeting.ids.length === 1 && targeting.ids[0] !== guildId);

        if (!isMulti && !hasLocalBit) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: requiredBit }),
            );
            return;
        }

        if (await host.denyIfCooldown(interaction, guildId, op as CooldownOp)) return;

        const authz = await resolveAuthorizedGuilds(host.heart, interaction.user.id, targeting);
        let allowedGuildIds = [...authz.allowedGuildIds];
        const denied = [...authz.denied];

        if (!isMulti && allowedGuildIds.length === 0 && hasLocalBit) {
            allowedGuildIds = [guildId];
        } else if (isMulti && allowedGuildIds.length === 0) {
            await host.replyDeniedOnly(interaction, denied);
            return;
        }
        if (allowedGuildIds.length === 0) {
            await host.replyText(interaction, host.t('commands.security.errors.noGuilds'));
            return;
        }

        let durationMs: number | undefined;
        if (op === 'timeout' || op === 'tempban') {
            const parsed = parseDurationMs(durationRaw);
            if (parsed == null) {
                await host.replyText(interaction, host.t('commands.security.errors.invalidDuration'));
                return;
            }
            durationMs = op === 'timeout' ? clampTimeoutMs(parsed) : clampTempbanMs(parsed);
        }

        const deleteMessageSeconds =
            deleteDays != null && deleteDays > 0 ? deleteDays * 86_400 : undefined;

        const bridge = host.heart.system.handler.$get<ModerationBridgeHandler>(
            'security',
            'moderationBridge',
        );
        if (!bridge) {
            await host.replyText(interaction, host.t('commands.security.errors.bridgeUnavailable'));
            return;
        }

        const actor = actorFrom(interaction.user);
        const guildIds = allowedGuildIds;
        let result: ActionBatchResult;

        switch (op) {
            case 'ban':
                result = await bridge.ban({
                    guildIds,
                    userId: target.id,
                    actor,
                    reason,
                    deleteMessageSeconds,
                    denied,
                    proof,
                });
                break;
            case 'unban':
                result = await bridge.unban({ guildIds, userId: target.id, actor, reason, denied, proof });
                break;
            case 'kick':
                result = await bridge.kick({ guildIds, userId: target.id, actor, reason, denied, proof });
                break;
            case 'timeout':
                result = await bridge.timeout({
                    guildIds,
                    userId: target.id,
                    actor,
                    durationMs: durationMs as number,
                    reason,
                    denied,
                    proof,
                });
                break;
            case 'untimeout':
                result = await bridge.untimeout({
                    guildIds,
                    userId: target.id,
                    actor,
                    reason,
                    denied,
                    proof,
                });
                break;
            case 'softban':
                result = await bridge.softban({
                    guildIds,
                    userId: target.id,
                    actor,
                    reason,
                    deleteMessageSeconds: deleteMessageSeconds ?? 86_400,
                    denied,
                    proof,
                });
                break;
            case 'tempban':
                result = await bridge.tempban({
                    guildIds,
                    userId: target.id,
                    actor,
                    durationMs: durationMs as number,
                    reason,
                    deleteMessageSeconds,
                    denied,
                    proof,
                });
                break;
            case 'hackban':
                result = await bridge.hackban({
                    guildIds,
                    userId: target.id,
                    actor,
                    reason,
                    deleteMessageSeconds,
                    denied,
                    proof,
                });
                break;
            default: {
                const _e: never = op;
                await host.replyText(interaction, host.t('commands.security.errors.unknownOp'));
                return;
            }
        }

        await setActionCooldown(
            host.heart,
            guildId,
            interaction.user.id,
            op as CooldownOp,
            defaultCooldownMs(op as CooldownOp),
        );
        await host.replyActionResult(interaction, op, target, result, durationMs, proof);
    }

    // --- Phase 2: warn / notes ---

