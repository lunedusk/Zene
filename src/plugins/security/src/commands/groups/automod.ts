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

export async function handleAutoMod(host: SecurityCmdHost,
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const autoMod = host.heart.system.handler.$get<AutoModHandler>('security', 'autoMod');
        if (!autoMod) {
            await host.replyText(interaction, host.t('commands.security.errors.automodUnavailable'));
            return;
        }

        const isView = sub === 'status';
        const bit = isView ? SECURITY_BITS.AUTOMOD_VIEW : SECURITY_BITS.AUTOMOD_MANAGE;
        const canView =
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.AUTOMOD_VIEW,
                guildId,
            )) ||
            (await host.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.AUTOMOD_MANAGE,
                guildId,
            ));
        const canManage = await host.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.AUTOMOD_MANAGE,
            guildId,
        );

        if (isView) {
            if (!canView) {
                await host.replyText(
                    interaction,
                    host.t('commands.security.errors.missingBit', { bit }),
                );
                return;
            }
        } else if (!canManage) {
            await host.replyText(
                interaction,
                host.t('commands.security.errors.missingBit', {
                    bit: SECURITY_BITS.AUTOMOD_MANAGE,
                }),
            );
            return;
        }

        
        if (sub === 'blacklist') {
            if (!canManage) {
                await host.replyText(
                    interaction,
                    host.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.AUTOMOD_MANAGE }),
                );
                return;
            }
            const store = host.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
            if (!store) {
                await host.replyText(interaction, host.t('commands.security.errors.automodUnavailable'));
                return;
            }
            const action = interaction.options.getString('action', true);
            const kindRaw = interaction.options.getString('kind');
            const patternRaw = interaction.options.getString('pattern');
            const idRaw = interaction.options.getString('id');
            if (action === 'list') {
                const kind = kindRaw as BlacklistKind | null;
                const rows = await store.listBlacklist(guildId, kind ?? undefined);
                if (rows.length === 0) {
                    await host.replyText(interaction, host.t('commands.security.automod.blacklistEmpty'));
                    return;
                }
                const lines = rows.slice(0, 25).map(
                    (r) => `• \`${r.id.slice(0, 8)}\` **${r.kind}** \`${r.pattern}\``,
                );
                await host.replyLines(
                    interaction,
                    host.t('commands.security.automod.blacklistListHeader'),
                    lines,
                );
                return;
            }
            if (action === 'remove') {
                if (!idRaw) {
                    await host.replyText(interaction, host.t('commands.security.automod.blacklistNeedId'));
                    return;
                }
                const ok = await store.removeBlacklist(guildId, idRaw);
                await emitSecurityEvent(host.heart, SECURITY_EVENTS.BLACKLIST_REMOVE, {
                    guildId,
                    id: idRaw,
                    actorId: interaction.user.id,
                });
                await host.replyText(
                    interaction,
                    ok
                        ? host.t('commands.security.automod.blacklistRemoved', { id: idRaw })
                        : host.t('commands.security.automod.blacklistNotFound', { id: idRaw }),
                );
                return;
            }
            if (action === 'add') {
                if (!kindRaw || !patternRaw) {
                    await host.replyText(interaction, host.t('commands.security.automod.blacklistNeedPattern'));
                    return;
                }
                const kind = kindRaw as BlacklistKind;
                if (kind !== 'word' && kind !== 'link' && kind !== 'regex') {
                    await host.replyText(interaction, host.t('commands.security.automod.blacklistBadKind'));
                    return;
                }
                const pattern = normalizeBlacklistPattern(kind, patternRaw);
                if (!pattern) {
                    await host.replyText(interaction, host.t('commands.security.automod.blacklistBadPattern'));
                    return;
                }
                const id = randomBytes(16).toString('hex');
                await store.addBlacklist({
                    id,
                    guildId,
                    kind,
                    pattern,
                    createdAt: Date.now(),
                    actorId: interaction.user.id,
                });
                // enable matching filter toggle
                const filterKey =
                    kind === 'word'
                        ? 'wordBlacklist'
                        : kind === 'link'
                          ? 'linkBlacklist'
                          : 'regexBlacklist';
                await autoMod.patchSettings(guildId, { [filterKey]: true, enabled: true });
                await emitSecurityEvent(host.heart, SECURITY_EVENTS.BLACKLIST_ADD, {
                    guildId,
                    id,
                    kind,
                    pattern,
                    actorId: interaction.user.id,
                });
                await host.replyText(
                    interaction,
                    host.t('commands.security.automod.blacklistAdded', {
                        kind,
                        pattern,
                        id: id.slice(0, 8),
                    }),
                );
            }
            return;
        }

if (sub === 'status') {
            const s = await autoMod.getSettings(guildId);
            const filters = FILTER_NAMES.map(
                (f) => `• ${f}: ${s[f] ? 'on' : 'off'}`,
            ).join('\n');
            await host.replyText(
                interaction,
                host.t('commands.security.automod.statusResult', {
                    enabled: s.enabled ? 'on' : 'off',
                    filters,
                    massMentionLimit: s.massMentionLimit,
                    capsPercent: s.capsPercent,
                    actionDelete: s.actionDelete ? 'yes' : 'no',
                    actionWarn: s.actionWarn ? 'yes' : 'no',
                    actionStrike: s.actionStrike ? 'yes' : 'no',
                    actionTimeout: s.actionTimeout ? 'yes' : 'no',
                    timeoutSeconds: s.timeoutSeconds,
                    roles: s.exemptRoleIds.length,
                    channels: s.exemptChannelIds.length,
                    users: s.exemptUserIds.length,
                }),
            );
            return;
        }

        if (sub === 'enable' || sub === 'disable') {
            const s = await autoMod.setEnabled(guildId, sub === 'enable');
            await host.replyText(
                interaction,
                host.t('commands.security.automod.toggleResult', {
                    enabled: s.enabled ? 'on' : 'off',
                }),
            );
            return;
        }

        if (sub === 'filter') {
            const name = interaction.options.getString('name', true);
            const enabled = interaction.options.getBoolean('enabled', true);
            if (!isFilterName(name)) {
                await host.replyText(
                    interaction,
                    host.t('commands.security.automod.unknownFilter', { name }),
                );
                return;
            }
            const s = await autoMod.setFilter(guildId, name, enabled);
            await host.replyText(
                interaction,
                host.t('commands.security.automod.filterResult', {
                    name,
                    enabled: s[name] ? 'on' : 'off',
                }),
            );
            return;
        }

        if (sub === 'set') {
            const key = interaction.options.getString('key', true);
            const valueRaw = interaction.options.getString('value', true).trim();
            const patch: Partial<{
                massMentionLimit: number;
                capsPercent: number;
                capsMinLength: number;
                duplicateWindowMs: number;
                duplicateCount: number;
                emojiMax: number;
                newlineMax: number;
                attachmentMax: number;
                attachmentWindowMs: number;
                timeoutSeconds: number;
                actionDelete: boolean;
                actionWarn: boolean;
                actionTimeout: boolean;
                actionStrike: boolean;
                actionTempRole: boolean;
                tempRoleId: string | null;
                tempRoleDurationMs: number;
            }> = {};

            const asBool = (v: string): boolean | null => {
                const x = v.toLowerCase();
                if (['1', 'true', 'yes', 'on'].includes(x)) return true;
                if (['0', 'false', 'no', 'off'].includes(x)) return false;
                return null;
            };
            const asInt = (v: string): number | null => {
                const n = Number(v);
                return Number.isFinite(n) ? Math.floor(n) : null;
            };

            switch (key) {
                case 'massMentionLimit': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.massMentionLimit = n;
                    break;
                }
                case 'capsPercent': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1 || n > 100) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.capsPercent = n;
                    break;
                }
                case 'capsMinLength': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.capsMinLength = n;
                    break;
                }
                case 'duplicateWindowMs': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1000) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.duplicateWindowMs = n;
                    break;
                }
                case 'duplicateCount': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 2) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.duplicateCount = n;
                    break;
                }
                case 'emojiMax': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 3) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.emojiMax = n;
                    break;
                }
                case 'newlineMax': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 3) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.newlineMax = n;
                    break;
                }
                case 'attachmentMax': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 2) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.attachmentMax = n;
                    break;
                }
                case 'attachmentWindowMs': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1000) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.attachmentWindowMs = n;
                    break;
                }
                case 'timeoutSeconds': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 0) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.timeoutSeconds = n;
                    break;
                }
                case 'actionDelete':
                case 'actionWarn':
                case 'actionTimeout':
                case 'actionStrike':
                case 'actionTempRole': {
                    const b = asBool(valueRaw);
                    if (b == null) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch[key] = b;
                    break;
                }
                case 'tempRoleId': {
                    const id = valueRaw.trim();
                    if (id && !/^\d{5,32}$/.test(id)) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.tempRoleId = id || null;
                    break;
                }
                case 'tempRoleDurationMs': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 5000) {
                        await host.replyText(
                            interaction,
                            host.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.tempRoleDurationMs = n;
                    break;
                }
                default:
                    await host.replyText(
                        interaction,
                        host.t('commands.security.automod.unknownKey', { key }),
                    );
                    return;
            }

            await autoMod.patchSettings(guildId, patch);
            await host.replyText(
                interaction,
                host.t('commands.security.automod.setResult', { key, value: valueRaw }),
            );
            return;
        }

        if (sub === 'exempt') {
            const action = interaction.options.getString('action', true);
            const kind = interaction.options.getString('type', false);
            const id = interaction.options.getString('id', false)?.trim();
            const s = await autoMod.getSettings(guildId);

            if (action === 'list') {
                await host.replyText(
                    interaction,
                    host.t('commands.security.automod.exemptList', {
                        roles: s.exemptRoleIds.join(', ') || '—',
                        channels: s.exemptChannelIds.join(', ') || '—',
                        users: s.exemptUserIds.join(', ') || '—',
                    }),
                );
                return;
            }

            if (!kind || !id || !/^\d{5,32}$/.test(id)) {
                await host.replyText(
                    interaction,
                    host.t('commands.security.automod.exemptNeedId'),
                );
                return;
            }

            const roles = [...s.exemptRoleIds];
            const channels = [...s.exemptChannelIds];
            const users = [...s.exemptUserIds];
            const list =
                kind === 'role' ? roles : kind === 'channel' ? channels : users;

            if (action === 'add') {
                if (!list.includes(id)) list.push(id);
            } else if (action === 'remove') {
                const idx = list.indexOf(id);
                if (idx >= 0) list.splice(idx, 1);
            } else {
                await host.replyText(
                    interaction,
                    host.t('commands.security.automod.unknownExemptAction'),
                );
                return;
            }

            await autoMod.patchSettings(guildId, {
                exemptRoleIds: kind === 'role' ? list : roles,
                exemptChannelIds: kind === 'channel' ? list : channels,
                exemptUserIds: kind === 'user' ? list : users,
            });
            await host.replyText(
                interaction,
                host.t('commands.security.automod.exemptResult', {
                    action,
                    type: kind,
                    id,
                }),
            );
        }
    }


