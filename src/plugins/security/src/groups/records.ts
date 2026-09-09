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

export async function handleWarn(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.WARN, guildId))) return;
        if (await host.denyIfCooldown(interaction, guildId, 'warn')) return;

        const target = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason')?.trim() ?? null;
        const proof = extractProof(interaction.options.getAttachment('proof'));
        const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await host.replyText(interaction, host.t('commands.security.errors.storeUnavailable'));
            return;
        }

        const row = await store.recordInfraction({
            guildId,
            userId: target.id,
            actorId: interaction.user.id,
            type: 'warn',
            reason,
            metadata: proofMetadata(proof) ?? null,
        });

        const tracker = host.heart.system.handler.$get<ViolationTrackerHandler>(
            'security',
            'violationTracker',
        );
        if (tracker) {
            await tracker.add(guildId, target.id, 1, interaction.user.id).catch(() => undefined);
        }

        await emitSecurityEvent(host.heart, SECURITY_EVENTS.WARN_ADD, {
            guildId,
            userId: target.id,
            actorId: interaction.user.id,
            reason,
            id: row.id,
        });
        await setActionCooldown(host.heart, guildId, interaction.user.id, 'warn', defaultCooldownMs('warn'));

                {
            const warnMsg = host.t('commands.security.warn.success', {
                user: `${target.username} (\`${target.id}\`)`,
                id: row.id,
                reason: reason ?? host.t('commands.security.results.noReason'),
            });
            const warnProof = formatProofLine(proof);
            await host.replyText(
                interaction,
                warnProof
                    ? `${warnMsg}\n${host.t('commands.security.results.proof', { proof: warnProof })}`
                    : warnMsg,
            );
        }
    }

export async function handleWarnsList(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await host.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.WARN, guildId)) ||
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.HISTORY,
                guildId,
            ));
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.WARN }),
            );
            return;
        }
        const target = interaction.options.getUser('user', true);
        const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await host.replyText(interaction, host.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const rows = await store.listInfractions({
            guildId,
            userId: target.id,
            type: 'warn',
            limit: 25,
        });
        if (rows.length === 0) {
            await host.replyText(
                interaction,
                host.t('commands.security.warns.empty', { user: target.username }),
            );
            return;
        }
        const lines = rows.map((r) => {
            const base = host.t('commands.security.warns.line', {
                id: r.id,
                reason: r.reason ?? host.t('commands.security.results.noReason'),
                actor: r.actorId,
                at: new Date(r.createdAt).toISOString(),
            });
            let proofUrl: string | null = null;
            if (typeof r.metadata === 'string' && r.metadata.trim()) {
                try {
                    const parsed: unknown = JSON.parse(r.metadata);
                    if (
                        parsed &&
                        typeof parsed === 'object' &&
                        'proofUrl' in parsed &&
                        typeof (parsed as Record<string, unknown>).proofUrl === 'string'
                    ) {
                        proofUrl = String((parsed as Record<string, unknown>).proofUrl);
                    }
                } catch {
                    /* ignore */
                }
            }
            return proofUrl ? `${base} | proof: ${proofUrl}` : base;
        });
        await host.replyLines(
            interaction,
            host.t('commands.security.warns.header', { user: target.username, count: rows.length }),
            lines,
        );
    }

export async function handleRmWarn(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await host.requireBit(interaction, SECURITY_BITS.WARN, guildId))) return;
        const id = interaction.options.getString('id', true).trim();
        const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await host.replyText(interaction, host.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const existing = await store.getInfraction(id, guildId);
        if (!existing || existing.type !== 'warn') {
            await host.replyText(interaction, host.t('commands.security.rmwarn.notFound'));
            return;
        }
        await store.deleteInfraction(id, guildId);
        await emitSecurityEvent(host.heart, SECURITY_EVENTS.WARN_REMOVE, {
            guildId,
            userId: existing.userId,
            actorId: interaction.user.id,
            id,
        });
        await host.replyText(interaction, host.t('commands.security.rmwarn.success', { id }));
    }

export async function handleNote(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.NOTES,
                guildId,
            )) ||
            (await host.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.WARN, guildId));
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SERVER_BITS.NOTES }),
            );
            return;
        }
        const target = interaction.options.getUser('user', true);
        const text = interaction.options.getString('text', true).trim();
        const proof = extractProof(interaction.options.getAttachment('proof'));
        const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await host.replyText(interaction, host.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const row = await store.recordInfraction({
            guildId,
            userId: target.id,
            actorId: interaction.user.id,
            type: 'note',
            reason: text,
            metadata: proofMetadata(proof) ?? null,
        });
        await emitSecurityEvent(host.heart, SECURITY_EVENTS.NOTE_ADD, {
            guildId,
            userId: target.id,
            actorId: interaction.user.id,
            id: row.id,
        });
        {
            const noteMsg = host.t('commands.security.note.success', {
                user: target.username,
                id: row.id,
            });
            const noteProof = formatProofLine(proof);
            await host.replyText(
                interaction,
                noteProof
                    ? `${noteMsg}
${host.t('commands.security.results.proof', { proof: noteProof })}`
                    : noteMsg,
            );
        }
    }

export async function handleNotesList(host: SecurityCmdHost, interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.NOTES,
                guildId,
            )) ||
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.HISTORY,
                guildId,
            ));
        if (!can) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', { bit: SERVER_BITS.NOTES }),
            );
            return;
        }
        const target = interaction.options.getUser('user', true);
        const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await host.replyText(interaction, host.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const rows = await store.listInfractions({
            guildId,
            userId: target.id,
            type: 'note',
            limit: 25,
        });
        if (rows.length === 0) {
            await host.replyText(
                interaction,
                host.t('commands.security.notes.empty', { user: target.username }),
            );
            return;
        }
        const lines = rows.map((r) =>
            host.t('commands.security.notes.line', {
                id: r.id,
                text: r.reason ?? '',
                actor: r.actorId,
                at: new Date(r.createdAt).toISOString(),
            }),
        );
        await host.replyLines(
            interaction,
            host.t('commands.security.notes.header', { user: target.username, count: rows.length }),
            lines,
        );
    }

    // --- violations ---

