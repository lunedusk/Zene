import { BaseCommand, type CommandConfig } from '#core/bases/Command.js';
import { randomBytes } from 'node:crypto';
import {
    ChannelType,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type Guild,
    type GuildTextBasedChannel,
    type User,
} from 'discord.js';
import { replyCv2Text } from '#core/builders/index.js';
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
import type { AutoModFilterName, BlacklistKind } from '../lib/types.js';
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
    PunishOp,
    SecurityActor,
} from '../lib/types.js';
import { OP_BIT, PUNISH_OPS, actorFrom } from './punishMeta.js';

import { handlePunish } from './groups/punish.js';
import {
    handleWarn,
    handleWarnsList,
    handleRmWarn,
    handleNote,
    handleNotesList,
} from './groups/records.js';
import {
    handlePurge,
    handleSnipe,
    handleChannelLock,
    handleSlowmode,
} from './groups/channel.js';
import { handleViolations } from './groups/violations.js';
import { handleLockdown } from './groups/lockdown.js';
import { handleAutoMod } from './groups/automod.js';
import { handleAntiNuke } from './groups/antinuke.js';
import { handleRaid } from './groups/raid.js';
import { handleVerify } from './groups/verify.js';
import { handleTempRole, handleSetup, handleStatus } from './groups/misc.js';
import type { SecurityCmdHost } from './groups/host.js';


export default class SecurityCommand extends BaseCommand {
    public readonly config: CommandConfig = {
        autoDefer: 'ephemeral',
        allowInDm: false,
    };

    public readonly data = ((): SlashCommandBuilder => {
        const b = new SlashCommandBuilder()
            .setName('security')
            .setDescription(this.t('commands.security.description'))
            .setContexts(InteractionContextType.Guild);

        b.addSubcommandGroup((g) => {
            g
                .setName('punish')
                .setDescription(this.t('commands.security.punish.groupDescription'));

            const addPunish = (
                name: string,
                descKey: string,
                opts: { duration?: boolean; deleteDays?: boolean },
            ): void => {
                g.addSubcommand((sub) => {
                    sub.setName(name).setDescription(this.t(descKey));
                    sub.addUserOption((o) =>
                        o
                            .setName('user')
                            .setDescription(this.t('commands.security.options.user'))
                            .setRequired(true),
                    );
                    if (opts.duration) {
                        sub.addStringOption((o) =>
                            o
                                .setName('duration')
                                .setDescription(this.t('commands.security.options.duration'))
                                .setRequired(true),
                        );
                    }
                    sub.addStringOption((o) =>
                        o
                            .setName('reason')
                            .setDescription(this.t('commands.security.options.reason'))
                            .setRequired(false),
                    );
                    if (opts.deleteDays) {
                        sub.addIntegerOption((o) =>
                            o
                                .setName('delete_days')
                                .setDescription(this.t('commands.security.options.deleteDays'))
                                .setRequired(false)
                                .setMinValue(0)
                                .setMaxValue(7),
                        );
                    }
                    sub.addStringOption((o) =>
                        o
                            .setName('guilds')
                            .setDescription(this.t('commands.security.options.guilds'))
                            .setRequired(false),
                    );
                    sub.addAttachmentOption((o) =>
                        o
                            .setName('proof')
                            .setDescription(this.t('commands.security.options.proof'))
                            .setRequired(false),
                    );
                    return sub;
                });
            };

            addPunish('ban', 'commands.security.ban.description', { deleteDays: true });
            addPunish('unban', 'commands.security.unban.description', {});
            addPunish('kick', 'commands.security.kick.description', {});
            addPunish('timeout', 'commands.security.timeout.description', { duration: true });
            addPunish('untimeout', 'commands.security.untimeout.description', {});
            addPunish('softban', 'commands.security.softban.description', { deleteDays: true });
            addPunish('tempban', 'commands.security.tempban.description', {
                duration: true,
                deleteDays: true,
            });
            addPunish('hackban', 'commands.security.hackban.description', { deleteDays: true });

            return g;
        });

        b.addSubcommandGroup((g) =>
            g
                .setName('records')
                .setDescription(this.t('commands.security.records.groupDescription'))
                .addSubcommand((sub) =>
                    sub
                        .setName('warn')
                        .setDescription(this.t('commands.security.warn.description'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        )
                        .addStringOption((o) =>
                            o.setName('reason').setDescription(this.t('commands.security.options.reason')).setRequired(false),
                        )
                        .addAttachmentOption((o) =>
                            o.setName('proof').setDescription(this.t('commands.security.options.proof')).setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('warns')
                        .setDescription(this.t('commands.security.warns.description'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('rmwarn')
                        .setDescription(this.t('commands.security.rmwarn.description'))
                        .addStringOption((o) =>
                            o.setName('id').setDescription(this.t('commands.security.options.infractionId')).setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('note')
                        .setDescription(this.t('commands.security.note.description'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        )
                        .addStringOption((o) =>
                            o.setName('text').setDescription(this.t('commands.security.options.noteText')).setRequired(true),
                        )
                        .addAttachmentOption((o) =>
                            o.setName('proof').setDescription(this.t('commands.security.options.proof')).setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('notes')
                        .setDescription(this.t('commands.security.notes.description'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        ),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('violations')
                .setDescription(this.t('commands.security.violations.groupDescription'))
                .addSubcommand((sub) =>
                    sub
                        .setName('view')
                        .setDescription(this.t('commands.security.violations.viewDescription'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('set')
                        .setDescription(this.t('commands.security.violations.setDescription'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        )
                        .addIntegerOption((o) =>
                            o
                                .setName('points')
                                .setDescription(this.t('commands.security.options.points'))
                                .setRequired(true)
                                .setMinValue(0),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('add')
                        .setDescription(this.t('commands.security.violations.addDescription'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        )
                        .addIntegerOption((o) =>
                            o
                                .setName('points')
                                .setDescription(this.t('commands.security.options.pointsDelta'))
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('reset')
                        .setDescription(this.t('commands.security.violations.resetDescription'))
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                        ),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('channel')
                .setDescription(this.t('commands.security.channel.groupDescription'))
                .addSubcommand((sub) =>
                    sub
                        .setName('purge')
                        .setDescription(this.t('commands.security.purge.description'))
                        .addIntegerOption((o) =>
                            o
                                .setName('amount')
                                .setDescription(this.t('commands.security.options.purgeAmount'))
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(100),
                        )
                        .addUserOption((o) =>
                            o.setName('user').setDescription(this.t('commands.security.options.purgeUser')).setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('snipe')
                        .setDescription(this.t('commands.security.snipe.description'))
                        .addChannelOption((o) =>
                            o
                                .setName('channel')
                                .setDescription(this.t('commands.security.options.snipeChannel'))
                                .setRequired(false)
                                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('lock')
                        .setDescription(this.t('commands.security.lock.description'))
                        .addChannelOption((o) =>
                            o
                                .setName('channel')
                                .setDescription(this.t('commands.security.options.channel'))
                                .setRequired(false)
                                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('unlock')
                        .setDescription(this.t('commands.security.unlock.description'))
                        .addChannelOption((o) =>
                            o
                                .setName('channel')
                                .setDescription(this.t('commands.security.options.channel'))
                                .setRequired(false)
                                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('slowmode')
                        .setDescription(this.t('commands.security.slowmode.description'))
                        .addIntegerOption((o) =>
                            o
                                .setName('seconds')
                                .setDescription(this.t('commands.security.options.slowmodeSeconds'))
                                .setRequired(true)
                                .setMinValue(0)
                                .setMaxValue(21600),
                        )
                        .addChannelOption((o) =>
                            o
                                .setName('channel')
                                .setDescription(this.t('commands.security.options.channel'))
                                .setRequired(false)
                                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
                        ),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('lockdown')
                .setDescription(this.t('commands.security.lockdown.groupDescription'))
                .addSubcommand((sub) =>
                    sub
                        .setName('on')
                        .setDescription(this.t('commands.security.lockdown.onDescription'))
                        .addBooleanOption((o) =>
                            o
                                .setName('pause_invites')
                                .setDescription(this.t('commands.security.lockdown.pauseInvites'))
                                .setRequired(false),
                        )
                        .addBooleanOption((o) =>
                            o
                                .setName('lock_channels')
                                .setDescription(this.t('commands.security.lockdown.lockChannels'))
                                .setRequired(false),
                        )
                        .addBooleanOption((o) =>
                            o
                                .setName('quarantine_joins')
                                .setDescription(this.t('commands.security.lockdown.quarantineJoins'))
                                .setRequired(false),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('reason')
                                .setDescription(this.t('commands.security.options.reason'))
                                .setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub.setName('off').setDescription(this.t('commands.security.lockdown.offDescription')),
                )
                .addSubcommand((sub) =>
                    sub.setName('status').setDescription(this.t('commands.security.lockdown.statusDescription')),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('automod')
                .setDescription(this.t('commands.security.automod.groupDescription'))
                .addSubcommand((sub) =>
                    sub.setName('status').setDescription(this.t('commands.security.automod.statusDescription')),
                )
                .addSubcommand((sub) =>
                    sub.setName('enable').setDescription(this.t('commands.security.automod.enableDescription')),
                )
                .addSubcommand((sub) =>
                    sub.setName('disable').setDescription(this.t('commands.security.automod.disableDescription')),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('filter')
                        .setDescription(this.t('commands.security.automod.filterDescription'))
                        .addStringOption((o) =>
                            o
                                .setName('name')
                                .setDescription(this.t('commands.security.automod.filterName'))
                                .setRequired(true)
                                .addChoices(...FILTER_NAMES.map((n) => ({ name: n, value: n }))),
                        )
                        .addBooleanOption((o) =>
                            o
                                .setName('enabled')
                                .setDescription(this.t('commands.security.automod.filterEnabled'))
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('set')
                        .setDescription(this.t('commands.security.automod.setDescription'))
                        .addStringOption((o) =>
                            o
                                .setName('key')
                                .setDescription(this.t('commands.security.automod.setKey'))
                                .setRequired(true)
                                .addChoices(
                                    { name: 'massMentionLimit', value: 'massMentionLimit' },
                                    { name: 'capsPercent', value: 'capsPercent' },
                                    { name: 'capsMinLength', value: 'capsMinLength' },
                                    { name: 'duplicateWindowMs', value: 'duplicateWindowMs' },
                                    { name: 'duplicateCount', value: 'duplicateCount' },
                                    { name: 'emojiMax', value: 'emojiMax' },
                                    { name: 'newlineMax', value: 'newlineMax' },
                                    { name: 'attachmentMax', value: 'attachmentMax' },
                                    { name: 'attachmentWindowMs', value: 'attachmentWindowMs' },
                                    { name: 'timeoutSeconds', value: 'timeoutSeconds' },
                                    { name: 'actionDelete', value: 'actionDelete' },
                                    { name: 'actionWarn', value: 'actionWarn' },
                                    { name: 'actionTimeout', value: 'actionTimeout' },
                                    { name: 'actionStrike', value: 'actionStrike' },
                                    { name: 'actionTempRole', value: 'actionTempRole' },
                                    { name: 'tempRoleId', value: 'tempRoleId' },
                                    { name: 'tempRoleDurationMs', value: 'tempRoleDurationMs' },
                                ),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('value')
                                .setDescription(this.t('commands.security.automod.setValue'))
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('exempt')
                        .setDescription(this.t('commands.security.automod.exemptDescription'))
                        .addStringOption((o) =>
                            o
                                .setName('action')
                                .setDescription(this.t('commands.security.automod.exemptAction'))
                                .setRequired(true)
                                .addChoices(
                                    { name: 'add', value: 'add' },
                                    { name: 'remove', value: 'remove' },
                                    { name: 'list', value: 'list' },
                                ),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('type')
                                .setDescription(this.t('commands.security.automod.exemptType'))
                                .setRequired(true)
                                .addChoices(
                                    { name: 'role', value: 'role' },
                                    { name: 'channel', value: 'channel' },
                                    { name: 'user', value: 'user' },
                                ),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('id')
                                .setDescription(this.t('commands.security.automod.exemptId'))
                                .setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('blacklist')
                        .setDescription(this.t('commands.security.automod.blacklistDescription'))
                        .addStringOption((o) =>
                            o
                                .setName('action')
                                .setDescription(this.t('commands.security.automod.blacklistAction'))
                                .setRequired(true)
                                .addChoices(
                                    { name: 'add', value: 'add' },
                                    { name: 'remove', value: 'remove' },
                                    { name: 'list', value: 'list' },
                                ),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('kind')
                                .setDescription(this.t('commands.security.automod.blacklistKind'))
                                .setRequired(false)
                                .addChoices(
                                    { name: 'word', value: 'word' },
                                    { name: 'link', value: 'link' },
                                    { name: 'regex', value: 'regex' },
                                ),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('pattern')
                                .setDescription(this.t('commands.security.automod.blacklistPattern'))
                                .setRequired(false),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('id')
                                .setDescription(this.t('commands.security.automod.blacklistId'))
                                .setRequired(false),
                        ),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('antinuke')
                .setDescription(this.t('commands.security.antinuke.groupDescription'))
                .addSubcommand((sub) =>
                    sub.setName('status').setDescription(this.t('commands.security.antinuke.statusDescription')),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('rule')
                        .setDescription(this.t('commands.security.antinuke.ruleDescription'))
                        .addStringOption((o) =>
                            o
                                .setName('event')
                                .setDescription(this.t('commands.security.antinuke.eventKey'))
                                .setRequired(true)
                                .addChoices(...ANTI_NUKE_EVENT_KEYS.slice(0, 25).map((k) => ({ name: k, value: k }))),
                        )
                        .addBooleanOption((o) =>
                            o.setName('enabled').setDescription(this.t('commands.security.antinuke.enabled')).setRequired(false),
                        )
                        .addIntegerOption((o) =>
                            o.setName('max_actions').setDescription(this.t('commands.security.antinuke.maxActions')).setRequired(false).setMinValue(1).setMaxValue(50),
                        )
                        .addIntegerOption((o) =>
                            o.setName('window_seconds').setDescription(this.t('commands.security.antinuke.windowSeconds')).setRequired(false).setMinValue(1).setMaxValue(3600),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('punishment')
                                .setDescription(this.t('commands.security.antinuke.punishment'))
                                .setRequired(false)
                                .addChoices(
                                    { name: 'stripRoles', value: 'stripRoles' },
                                    { name: 'kick', value: 'kick' },
                                    { name: 'ban', value: 'ban' },
                                    { name: 'timeout', value: 'timeout' },
                                    { name: 'quarantine', value: 'quarantine' },
                                    { name: 'tempRole', value: 'tempRole' },
                                ),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('whitelist')
                        .setDescription(this.t('commands.security.antinuke.whitelistDescription'))
                        .addStringOption((o) =>
                            o
                                .setName('event')
                                .setDescription(this.t('commands.security.antinuke.eventKey'))
                                .setRequired(true)
                                .addChoices(...ANTI_NUKE_EVENT_KEYS.slice(0, 25).map((k) => ({ name: k, value: k }))),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('action')
                                .setDescription(this.t('commands.security.antinuke.wlAction'))
                                .setRequired(true)
                                .addChoices(
                                    { name: 'add', value: 'add' },
                                    { name: 'remove', value: 'remove' },
                                    { name: 'list', value: 'list' },
                                ),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('type')
                                .setDescription(this.t('commands.security.antinuke.wlType'))
                                .setRequired(false)
                                .addChoices({ name: 'user', value: 'user' }, { name: 'role', value: 'role' }),
                        )
                        .addStringOption((o) =>
                            o.setName('id').setDescription(this.t('commands.security.antinuke.wlId')).setRequired(false),
                        ),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('raid')
                .setDescription(this.t('commands.security.raid.groupDescription'))
                .addSubcommand((sub) =>
                    sub.setName('status').setDescription(this.t('commands.security.raid.statusDescription')),
                )
                .addSubcommand((sub) =>
                    sub.setName('enable').setDescription(this.t('commands.security.raid.enableDescription')),
                )
                .addSubcommand((sub) =>
                    sub.setName('disable').setDescription(this.t('commands.security.raid.disableDescription')),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('set')
                        .setDescription(this.t('commands.security.raid.setDescription'))
                        .addIntegerOption((o) =>
                            o.setName('max_joins').setDescription(this.t('commands.security.raid.maxJoins')).setRequired(false).setMinValue(2).setMaxValue(100),
                        )
                        .addIntegerOption((o) =>
                            o.setName('window_seconds').setDescription(this.t('commands.security.raid.windowSeconds')).setRequired(false).setMinValue(5).setMaxValue(600),
                        )
                        .addStringOption((o) =>
                            o
                                .setName('action')
                                .setDescription(this.t('commands.security.raid.action'))
                                .setRequired(false)
                                .addChoices(
                                    { name: 'quarantine', value: 'quarantine' },
                                    { name: 'kick', value: 'kick' },
                                    { name: 'ban', value: 'ban' },
                                    { name: 'pauseVerify', value: 'pauseVerify' },
                                ),
                        )
                        .addRoleOption((o) =>
                            o.setName('quarantine_role').setDescription(this.t('commands.security.raid.quarantineRole')).setRequired(false),
                        )
                        .addRoleOption((o) =>
                            o.setName('join_role').setDescription(this.t('commands.security.raid.joinRole')).setRequired(false),
                        ),
                ),
        );

        b.addSubcommandGroup((g) =>
            g
                .setName('verify')
                .setDescription(this.t('commands.security.verify.groupDescription'))
                .addSubcommand((sub) =>
                    sub
                        .setName('panel')
                        .setDescription(this.t('commands.security.verify.panelDescription'))
                        .addChannelOption((o) =>
                            o
                                .setName('channel')
                                .setDescription(this.t('commands.security.options.channel'))
                                .setRequired(false)
                                .addChannelTypes(ChannelType.GuildText),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('settings')
                        .setDescription(this.t('commands.security.verify.settingsDescription'))
                        .addBooleanOption((o) =>
                            o.setName('enabled').setDescription(this.t('commands.security.verify.enabled')).setRequired(false),
                        )
                        .addRoleOption((o) =>
                            o.setName('verified_role').setDescription(this.t('commands.security.verify.verifiedRole')).setRequired(false),
                        )
                        .addRoleOption((o) =>
                            o.setName('quarantine_role').setDescription(this.t('commands.security.verify.quarantineRole')).setRequired(false),
                        ),
                ),
        );

        b.addSubcommand((sub) =>
            sub
                .setName('temprole')
                .setDescription(this.t('commands.security.temprole.description'))
                .addUserOption((o) =>
                    o.setName('user').setDescription(this.t('commands.security.options.user')).setRequired(true),
                )
                .addRoleOption((o) =>
                    o.setName('role').setDescription(this.t('commands.security.temprole.role')).setRequired(true),
                )
                .addStringOption((o) =>
                    o.setName('duration').setDescription(this.t('commands.security.temprole.duration')).setRequired(true),
                )
                .addStringOption((o) =>
                    o.setName('reason').setDescription(this.t('commands.security.options.reason')).setRequired(false),
                )
                .addAttachmentOption((o) =>
                    o.setName('proof').setDescription(this.t('commands.security.options.proof')).setRequired(false),
                ),
        );
        b.addSubcommand((sub) =>
            sub.setName('setup').setDescription(this.t('commands.security.setup.description')),
        );
        b.addSubcommand((sub) =>
            sub.setName('status').setDescription(this.t('commands.security.status.description')),
        );

        return b;
    })();

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
            await this.replyText(interaction, this.t('commands.security.errors.guildOnly'));
            return;
        }

        const host = this as unknown as SecurityCmdHost;
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(true);

        if (group === 'punish') {
            await handlePunish(host, interaction, sub as PunishOp);
            return;
        }
        if (group === 'records') {
            switch (sub) {
                case 'warn':
                    await handleWarn(host, interaction);
                    break;
                case 'warns':
                    await handleWarnsList(host, interaction);
                    break;
                case 'rmwarn':
                    await handleRmWarn(host, interaction);
                    break;
                case 'note':
                    await handleNote(host, interaction);
                    break;
                case 'notes':
                    await handleNotesList(host, interaction);
                    break;
                default:
                    await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
            }
            return;
        }
        if (group === 'channel') {
            switch (sub) {
                case 'purge':
                    await handlePurge(host, interaction);
                    break;
                case 'snipe':
                    await handleSnipe(host, interaction);
                    break;
                case 'lock':
                    await handleChannelLock(host, interaction, true);
                    break;
                case 'unlock':
                    await handleChannelLock(host, interaction, false);
                    break;
                case 'slowmode':
                    await handleSlowmode(host, interaction);
                    break;
                default:
                    await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
            }
            return;
        }
        if (group === 'violations') {
            await handleViolations(host, interaction, sub);
            return;
        }
        if (group === 'lockdown') {
            await handleLockdown(host, interaction, sub);
            return;
        }
        if (group === 'automod') {
            await handleAutoMod(host, interaction, sub);
            return;
        }
        if (group === 'antinuke') {
            await handleAntiNuke(host, interaction, sub);
            return;
        }
        if (group === 'raid') {
            await handleRaid(host, interaction, sub);
            return;
        }
        if (group === 'verify') {
            await handleVerify(host, interaction, sub);
            return;
        }

        switch (sub) {
            case 'temprole':
                await handleTempRole(host, interaction);
                break;
            case 'setup':
                await handleSetup(host, interaction);
                break;
            case 'status':
                await handleStatus(host, interaction);
                break;
            default:
                await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
        }
    }



    // --- Phase 1 punish ---


    // --- helpers ---

    public async requireBit(
        interaction: ChatInputCommandInteraction,
        bit: string,
        guildId: string,
    ): Promise<boolean> {
        const ok = await this.heart.permissions.hasBit(interaction.user.id, bit, guildId);
        if (!ok) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit }),
            );
        }
        return ok;
    }

    public async denyIfCooldown(
        interaction: ChatInputCommandInteraction,
        guildId: string,
        op: CooldownOp,
    ): Promise<boolean> {
        const remaining = await checkActionCooldown(
            this.heart,
            guildId,
            interaction.user.id,
            op,
        );
        if (remaining != null && remaining > 0) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.cooldown', {
                    seconds: Math.ceil(remaining / 1000),
                }),
            );
            return true;
        }
        return false;
    }

    public async replyText(
        interaction: ChatInputCommandInteraction,
        content: string,
    ): Promise<void> {
        await replyCv2Text(interaction, {
            content,
            emoji: '🛡️',
            ephemeral: true,
        });
    }

    public async replyLines(
        interaction: ChatInputCommandInteraction,
        header: string,
        lines: string[],
    ): Promise<void> {
        const all = [header, ...lines];
        if (all.length <= 15) {
            await this.replyText(interaction, all.join('\n'));
            return;
        }
        const pageResult = await this.heart.paginator.replyOrPaginate({
            interaction,
            lines: all,
            mode: 'embed',
            ephemeral: true,
        });
        if (!pageResult.paginated) {
            await this.replyText(interaction, all.slice(0, 40).join('\n'));
        }
    }

    public async replyDeniedOnly(
        interaction: ChatInputCommandInteraction,
        denied: readonly GuildAuthzDecision[],
    ): Promise<void> {
        const lines = denied.map((d) =>
            this.t('commands.security.results.deniedLine', {
                guildId: d.guildId,
                reason: this.t(`commands.security.authz.${d.reason}`),
            }),
        );
        await this.replyLines(
            interaction,
            this.t('commands.security.results.allDeniedHeader'),
            lines,
        );
    }

    public async replyActionResult(
        interaction: ChatInputCommandInteraction,
        op: PunishOp,
        target: User,
        result: ActionBatchResult,
        durationMs?: number,
        proof?: import('../lib/proof.js').ProofMeta | null,
    ): Promise<void> {
        const ok = result.results.filter((r) => r.ok);
        const fail = result.results.filter((r) => !r.ok);
        const lines: string[] = [];

        lines.push(
            this.t('commands.security.results.header', {
                op,
                user: `${target.username} (\`${target.id}\`)`,
                ok: ok.length,
                fail: fail.length,
                denied: result.denied.length,
            }),
        );
        if (durationMs != null) {
            lines.push(
                this.t('commands.security.results.duration', {
                    duration: formatDurationMs(durationMs),
                }),
            );
        }
        for (const r of ok) {
            lines.push(this.t('commands.security.results.okLine', { guildId: r.guildId }));
        }
        for (const r of fail) {
            lines.push(
                this.t('commands.security.results.failLine', {
                    guildId: r.guildId,
                    code: r.code ?? 'action_failed',
                }),
            );
        }
        for (const d of result.denied) {
            lines.push(
                this.t('commands.security.results.deniedLine', {
                    guildId: d.guildId,
                    reason: this.t(`commands.security.authz.${d.reason}`),
                }),
            );
        }
        const pl = formatProofLine(proof);
        if (pl) {
            lines.push(this.t('commands.security.results.proof', { proof: pl }));
        }
        await this.replyLines(interaction, lines[0] ?? '', lines.slice(1));
    }
}
