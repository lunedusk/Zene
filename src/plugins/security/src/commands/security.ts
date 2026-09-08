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

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(true);

        if (group === 'punish') {
            await this.handlePunish(interaction, sub as PunishOp);
            return;
        }
        if (group === 'records') {
            switch (sub) {
                case 'warn':
                    await this.handleWarn(interaction);
                    break;
                case 'warns':
                    await this.handleWarnsList(interaction);
                    break;
                case 'rmwarn':
                    await this.handleRmWarn(interaction);
                    break;
                case 'note':
                    await this.handleNote(interaction);
                    break;
                case 'notes':
                    await this.handleNotesList(interaction);
                    break;
                default:
                    await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
            }
            return;
        }
        if (group === 'channel') {
            switch (sub) {
                case 'purge':
                    await this.handlePurge(interaction);
                    break;
                case 'snipe':
                    await this.handleSnipe(interaction);
                    break;
                case 'lock':
                    await this.handleChannelLock(interaction, true);
                    break;
                case 'unlock':
                    await this.handleChannelLock(interaction, false);
                    break;
                case 'slowmode':
                    await this.handleSlowmode(interaction);
                    break;
                default:
                    await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
            }
            return;
        }
        if (group === 'violations') {
            await this.handleViolations(interaction, sub);
            return;
        }
        if (group === 'lockdown') {
            await this.handleLockdown(interaction, sub);
            return;
        }
        if (group === 'automod') {
            await this.handleAutoMod(interaction, sub);
            return;
        }
        if (group === 'antinuke') {
            await this.handleAntiNuke(interaction, sub);
            return;
        }
        if (group === 'raid') {
            await this.handleRaid(interaction, sub);
            return;
        }
        if (group === 'verify') {
            await this.handleVerify(interaction, sub);
            return;
        }

        switch (sub) {
            case 'temprole':
                await this.handleTempRole(interaction);
                break;
            case 'setup':
                await this.handleSetup(interaction);
                break;
            case 'status':
                await this.handleStatus(interaction);
                break;
            default:
                await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
        }
    }


    // --- Phase 1 punish ---

    private async handlePunish(
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
        const hasLocalBit = await this.heart.permissions.hasBit(
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
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: requiredBit }),
            );
            return;
        }

        if (await this.denyIfCooldown(interaction, guildId, op as CooldownOp)) return;

        const authz = await resolveAuthorizedGuilds(this.heart, interaction.user.id, targeting);
        let allowedGuildIds = [...authz.allowedGuildIds];
        const denied = [...authz.denied];

        if (!isMulti && allowedGuildIds.length === 0 && hasLocalBit) {
            allowedGuildIds = [guildId];
        } else if (isMulti && allowedGuildIds.length === 0) {
            await this.replyDeniedOnly(interaction, denied);
            return;
        }
        if (allowedGuildIds.length === 0) {
            await this.replyText(interaction, this.t('commands.security.errors.noGuilds'));
            return;
        }

        let durationMs: number | undefined;
        if (op === 'timeout' || op === 'tempban') {
            const parsed = parseDurationMs(durationRaw);
            if (parsed == null) {
                await this.replyText(interaction, this.t('commands.security.errors.invalidDuration'));
                return;
            }
            durationMs = op === 'timeout' ? clampTimeoutMs(parsed) : clampTempbanMs(parsed);
        }

        const deleteMessageSeconds =
            deleteDays != null && deleteDays > 0 ? deleteDays * 86_400 : undefined;

        const bridge = this.heart.system.handler.$get<ModerationBridgeHandler>(
            'security',
            'moderationBridge',
        );
        if (!bridge) {
            await this.replyText(interaction, this.t('commands.security.errors.bridgeUnavailable'));
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
                await this.replyText(interaction, this.t('commands.security.errors.unknownOp'));
                return;
            }
        }

        await setActionCooldown(
            this.heart,
            guildId,
            interaction.user.id,
            op as CooldownOp,
            defaultCooldownMs(op as CooldownOp),
        );
        await this.replyActionResult(interaction, op, target, result, durationMs, proof);
    }

    // --- Phase 2: warn / notes ---

    private async handleWarn(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.WARN, guildId))) return;
        if (await this.denyIfCooldown(interaction, guildId, 'warn')) return;

        const target = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason')?.trim() ?? null;
        const proof = extractProof(interaction.options.getAttachment('proof'));
        const store = this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await this.replyText(interaction, this.t('commands.security.errors.storeUnavailable'));
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

        const tracker = this.heart.system.handler.$get<ViolationTrackerHandler>(
            'security',
            'violationTracker',
        );
        if (tracker) {
            await tracker.add(guildId, target.id, 1, interaction.user.id).catch(() => undefined);
        }

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.WARN_ADD, {
            guildId,
            userId: target.id,
            actorId: interaction.user.id,
            reason,
            id: row.id,
        });
        await setActionCooldown(this.heart, guildId, interaction.user.id, 'warn', defaultCooldownMs('warn'));

                {
            const warnMsg = this.t('commands.security.warn.success', {
                user: `${target.username} (\`${target.id}\`)`,
                id: row.id,
                reason: reason ?? this.t('commands.security.results.noReason'),
            });
            const warnProof = formatProofLine(proof);
            await this.replyText(
                interaction,
                warnProof
                    ? `${warnMsg}\n${this.t('commands.security.results.proof', { proof: warnProof })}`
                    : warnMsg,
            );
        }
    }

    private async handleWarnsList(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await this.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.WARN, guildId)) ||
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.HISTORY,
                guildId,
            ));
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.WARN }),
            );
            return;
        }
        const target = interaction.options.getUser('user', true);
        const store = this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await this.replyText(interaction, this.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const rows = await store.listInfractions({
            guildId,
            userId: target.id,
            type: 'warn',
            limit: 25,
        });
        if (rows.length === 0) {
            await this.replyText(
                interaction,
                this.t('commands.security.warns.empty', { user: target.username }),
            );
            return;
        }
        const lines = rows.map((r) => {
            const base = this.t('commands.security.warns.line', {
                id: r.id,
                reason: r.reason ?? this.t('commands.security.results.noReason'),
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
        await this.replyLines(
            interaction,
            this.t('commands.security.warns.header', { user: target.username, count: rows.length }),
            lines,
        );
    }

    private async handleRmWarn(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.WARN, guildId))) return;
        const id = interaction.options.getString('id', true).trim();
        const store = this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await this.replyText(interaction, this.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const existing = await store.getInfraction(id, guildId);
        if (!existing || existing.type !== 'warn') {
            await this.replyText(interaction, this.t('commands.security.rmwarn.notFound'));
            return;
        }
        await store.deleteInfraction(id, guildId);
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.WARN_REMOVE, {
            guildId,
            userId: existing.userId,
            actorId: interaction.user.id,
            id,
        });
        await this.replyText(interaction, this.t('commands.security.rmwarn.success', { id }));
    }

    private async handleNote(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.NOTES,
                guildId,
            )) ||
            (await this.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.WARN, guildId));
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SERVER_BITS.NOTES }),
            );
            return;
        }
        const target = interaction.options.getUser('user', true);
        const text = interaction.options.getString('text', true).trim();
        const proof = extractProof(interaction.options.getAttachment('proof'));
        const store = this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await this.replyText(interaction, this.t('commands.security.errors.storeUnavailable'));
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
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.NOTE_ADD, {
            guildId,
            userId: target.id,
            actorId: interaction.user.id,
            id: row.id,
        });
        {
            const noteMsg = this.t('commands.security.note.success', {
                user: target.username,
                id: row.id,
            });
            const noteProof = formatProofLine(proof);
            await this.replyText(
                interaction,
                noteProof
                    ? `${noteMsg}
${this.t('commands.security.results.proof', { proof: noteProof })}`
                    : noteMsg,
            );
        }
    }

    private async handleNotesList(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.NOTES,
                guildId,
            )) ||
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.HISTORY,
                guildId,
            ));
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SERVER_BITS.NOTES }),
            );
            return;
        }
        const target = interaction.options.getUser('user', true);
        const store = this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
        if (!store) {
            await this.replyText(interaction, this.t('commands.security.errors.storeUnavailable'));
            return;
        }
        const rows = await store.listInfractions({
            guildId,
            userId: target.id,
            type: 'note',
            limit: 25,
        });
        if (rows.length === 0) {
            await this.replyText(
                interaction,
                this.t('commands.security.notes.empty', { user: target.username }),
            );
            return;
        }
        const lines = rows.map((r) =>
            this.t('commands.security.notes.line', {
                id: r.id,
                text: r.reason ?? '',
                actor: r.actorId,
                at: new Date(r.createdAt).toISOString(),
            }),
        );
        await this.replyLines(
            interaction,
            this.t('commands.security.notes.header', { user: target.username, count: rows.length }),
            lines,
        );
    }

    // --- violations ---

    private async handleViolations(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.VIOLATIONS_EDIT, guildId))) return;

        const tracker = this.heart.system.handler.$get<ViolationTrackerHandler>(
            'security',
            'violationTracker',
        );
        if (!tracker) {
            await this.replyText(interaction, this.t('commands.security.errors.trackerUnavailable'));
            return;
        }

        const target = interaction.options.getUser('user', true);

        if (sub === 'view') {
            const row = await tracker.get(guildId, target.id);
            await this.replyText(
                interaction,
                this.t('commands.security.violations.viewResult', {
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
            await this.replyText(
                interaction,
                this.t('commands.security.violations.setResult', {
                    user: target.username,
                    points: row.points,
                }),
            );
            return;
        }
        if (sub === 'add') {
            const points = interaction.options.getInteger('points', true);
            const row = await tracker.add(guildId, target.id, points, interaction.user.id);
            await this.replyText(
                interaction,
                this.t('commands.security.violations.addResult', {
                    user: target.username,
                    points: row.points,
                    delta: points,
                }),
            );
            return;
        }
        if (sub === 'reset') {
            const row = await tracker.reset(guildId, target.id, interaction.user.id);
            await this.replyText(
                interaction,
                this.t('commands.security.violations.resetResult', {
                    user: target.username,
                    points: row.points,
                }),
            );
        }
    }

    // --- lockdown ---

    private async handleLockdown(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guild = interaction.guild as Guild;
        const guildId = guild.id;
        const can =
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.LOCKDOWN,
                guildId,
            )) ||
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.FREEZE,
                guildId,
            ));
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.LOCKDOWN }),
            );
            return;
        }

        const freeze = this.heart.system.handler.$get<FreezeControllerHandler>(
            'security',
            'freezeController',
        );
        if (!freeze) {
            await this.replyText(interaction, this.t('commands.security.errors.freezeUnavailable'));
            return;
        }

        if (sub === 'status') {
            const state = await freeze.getStatus(guildId);
            if (!state?.active) {
                await this.replyText(interaction, this.t('commands.security.lockdown.statusOff'));
                return;
            }
            await this.replyText(
                interaction,
                this.t('commands.security.lockdown.statusOn', {
                    pauseInvites: state.pauseInvites ? 'yes' : 'no',
                    lockChannels: state.lockChannels ? 'yes' : 'no',
                    quarantineJoins: state.quarantineJoins ? 'yes' : 'no',
                    reason: state.reason ?? this.t('commands.security.results.noReason'),
                    until: state.invitesPausedUntil
                        ? new Date(state.invitesPausedUntil).toISOString()
                        : '—',
                }),
            );
            return;
        }

        if (sub === 'off') {
            if (await this.denyIfCooldown(interaction, guildId, 'lockdown')) return;
            const result = await freeze.disable(guild, actorFrom(interaction.user));
            if (!result.ok) {
                await this.replyText(
                    interaction,
                    this.t('commands.security.lockdown.offFail', {
                        detail: result.detail ?? 'unknown',
                    }),
                );
                return;
            }
            await setActionCooldown(
                this.heart,
                guildId,
                interaction.user.id,
                'lockdown',
                defaultCooldownMs('lockdown'),
            );
            await this.replyText(interaction, this.t('commands.security.lockdown.offSuccess'));
            return;
        }

        // on
        if (await this.denyIfCooldown(interaction, guildId, 'lockdown')) return;
        const pauseInvites = interaction.options.getBoolean('pause_invites') ?? true;
        const lockChannels = interaction.options.getBoolean('lock_channels') ?? true;
        const quarantineJoins = interaction.options.getBoolean('quarantine_joins') ?? false;
        const reason = interaction.options.getString('reason')?.trim();

        if (!pauseInvites && !lockChannels && !quarantineJoins) {
            await this.replyText(interaction, this.t('commands.security.lockdown.needFilter'));
            return;
        }

        const result = await freeze.enable(guild, actorFrom(interaction.user), {
            pauseInvites,
            lockChannels,
            quarantineJoins,
            reason,
        });
        if (!result.ok) {
            await this.replyText(
                interaction,
                this.t('commands.security.lockdown.onFail', {
                    detail: result.detail ?? 'unknown',
                }),
            );
            return;
        }
        await setActionCooldown(
            this.heart,
            guildId,
            interaction.user.id,
            'lockdown',
            defaultCooldownMs('lockdown'),
        );
        await this.replyText(
            interaction,
            this.t('commands.security.lockdown.onSuccess', {
                pauseInvites: pauseInvites ? 'yes' : 'no',
                lockChannels: lockChannels ? 'yes' : 'no',
                quarantineJoins: quarantineJoins ? 'yes' : 'no',
            }),
        );
    }

    // --- purge / snipe / lock / slowmode ---

    private async handlePurge(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.PURGE, guildId))) return;
        if (await this.denyIfCooldown(interaction, guildId, 'purge')) return;

        const amount = interaction.options.getInteger('amount', true);
        const filterUser = interaction.options.getUser('user');
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased() || channel.isDMBased()) {
            await this.replyText(interaction, this.t('commands.security.errors.noTextChannel'));
            return;
        }

        const me = interaction.guild?.members.me;
        if (!me?.permissionsIn(channel.id).has(PermissionFlagsBits.ManageMessages)) {
            await this.replyText(interaction, this.t('commands.security.errors.botMissingManageMessages'));
            return;
        }

        const fetched = await channel.messages.fetch({ limit: Math.min(amount, 100) });
        const twoWeeks = Date.now() - 14 * 86_400_000;
        let toDelete = [...fetched.values()].filter((m) => m.createdTimestamp > twoWeeks);
        if (filterUser) {
            toDelete = toDelete.filter((m) => m.author.id === filterUser.id);
        }
        toDelete = toDelete.slice(0, amount);

        if (toDelete.length === 0) {
            await this.replyText(interaction, this.t('commands.security.purge.empty'));
            return;
        }

        const deleted = await (channel as GuildTextBasedChannel)
            .bulkDelete(toDelete, true)
            .catch(() => null);
        const count = deleted?.size ?? 0;

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.PURGE, {
            guildId,
            channelId: channel.id,
            actorId: interaction.user.id,
            count,
            filterUserId: filterUser?.id ?? null,
        });
        await setActionCooldown(this.heart, guildId, interaction.user.id, 'purge', defaultCooldownMs('purge'));
        await this.replyText(
            interaction,
            this.t('commands.security.purge.success', { count }),
        );
    }

    private async handleSnipe(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.SNIPE, guildId))) return;

        const ch =
            interaction.options.getChannel('channel') ?? interaction.channel;
        if (!ch || !('id' in ch)) {
            await this.replyText(interaction, this.t('commands.security.errors.noTextChannel'));
            return;
        }
        const entries = await getSnipes(this.heart, guildId, ch.id);
        if (entries.length === 0) {
            await this.replyText(interaction, this.t('commands.security.snipe.empty'));
            return;
        }
        const latest = entries[0];
        if (!latest) {
            await this.replyText(interaction, this.t('commands.security.snipe.empty'));
            return;
        }
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.SNIPE, {
            guildId,
            channelId: ch.id,
            actorId: interaction.user.id,
        });
        await this.replyText(
            interaction,
            this.t('commands.security.snipe.result', {
                author: latest.authorTag,
                content: latest.content || this.t('commands.security.snipe.noContent'),
                at: new Date(latest.deletedAt).toISOString(),
                attachments: latest.attachmentUrls.length
                    ? latest.attachmentUrls.join('\n')
                    : this.t('commands.security.snipe.noAttachments'),
            }),
        );
    }

    private async handleChannelLock(
        interaction: ChatInputCommandInteraction,
        lock: boolean,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.LOCKDOWN, guildId))) return;

        const freeze = this.heart.system.handler.$get<FreezeControllerHandler>(
            'security',
            'freezeController',
        );
        if (!freeze) {
            await this.replyText(interaction, this.t('commands.security.errors.freezeUnavailable'));
            return;
        }

        const chOption = interaction.options.getChannel('channel');
        const channel = (chOption ?? interaction.channel) as {
            id: string;
            guild: Guild;
            permissionOverwrites: import('discord.js').GuildChannel['permissionOverwrites'];
            manageable?: boolean;
        } | null;

        if (!channel || !('permissionOverwrites' in channel)) {
            await this.replyText(interaction, this.t('commands.security.errors.noTextChannel'));
            return;
        }

        const ok = lock
            ? await freeze.lockChannel(channel as never)
            : await freeze.unlockChannel(channel as never);

        await emitSecurityEvent(
            this.heart,
            lock ? SECURITY_EVENTS.CHANNEL_LOCK : SECURITY_EVENTS.CHANNEL_UNLOCK,
            { guildId, channelId: channel.id, actorId: interaction.user.id },
        );

        await this.replyText(
            interaction,
            ok
                ? this.t(lock ? 'commands.security.lock.success' : 'commands.security.unlock.success', {
                      channel: `<#${channel.id}>`,
                  })
                : this.t('commands.security.lock.fail'),
        );
    }

    private async handleSlowmode(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        if (!(await this.requireBit(interaction, SECURITY_BITS.LOCKDOWN, guildId))) return;

        const seconds = interaction.options.getInteger('seconds', true);
        const chOption = interaction.options.getChannel('channel');
        const channel = chOption ?? interaction.channel;
        if (!channel || !('setRateLimitPerUser' in channel)) {
            await this.replyText(interaction, this.t('commands.security.errors.noTextChannel'));
            return;
        }

        try {
            await (channel as GuildTextBasedChannel).setRateLimitPerUser(
                seconds,
                `Security slowmode by ${interaction.user.id}`,
            );
            await emitSecurityEvent(this.heart, SECURITY_EVENTS.SLOWMODE, {
                guildId,
                channelId: channel.id,
                actorId: interaction.user.id,
                seconds,
            });
            await this.replyText(
                interaction,
                this.t('commands.security.slowmode.success', {
                    channel: `<#${channel.id}>`,
                    seconds,
                }),
            );
        } catch {
            await this.replyText(interaction, this.t('commands.security.slowmode.fail'));
        }
    }

    // --- Phase 3: AutoMod ---

    private async handleAutoMod(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const autoMod = this.heart.system.handler.$get<AutoModHandler>('security', 'autoMod');
        if (!autoMod) {
            await this.replyText(interaction, this.t('commands.security.errors.automodUnavailable'));
            return;
        }

        const isView = sub === 'status';
        const bit = isView ? SECURITY_BITS.AUTOMOD_VIEW : SECURITY_BITS.AUTOMOD_MANAGE;
        const canView =
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.AUTOMOD_VIEW,
                guildId,
            )) ||
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.AUTOMOD_MANAGE,
                guildId,
            ));
        const canManage = await this.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.AUTOMOD_MANAGE,
            guildId,
        );

        if (isView) {
            if (!canView) {
                await this.replyText(
                    interaction,
                    this.t('commands.security.errors.missingBit', { bit }),
                );
                return;
            }
        } else if (!canManage) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', {
                    bit: SECURITY_BITS.AUTOMOD_MANAGE,
                }),
            );
            return;
        }

        
        if (sub === 'blacklist') {
            if (!canManage) {
                await this.replyText(
                    interaction,
                    this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.AUTOMOD_MANAGE }),
                );
                return;
            }
            const store = this.heart.system.handler.$get<
                import('../handlers/store.js').default
            >('security', 'store');
            if (!store) {
                await this.replyText(interaction, this.t('commands.security.errors.automodUnavailable'));
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
                    await this.replyText(interaction, this.t('commands.security.automod.blacklistEmpty'));
                    return;
                }
                const lines = rows.slice(0, 25).map(
                    (r) => `• \`${r.id.slice(0, 8)}\` **${r.kind}** \`${r.pattern}\``,
                );
                await this.replyLines(
                    interaction,
                    this.t('commands.security.automod.blacklistListHeader'),
                    lines,
                );
                return;
            }
            if (action === 'remove') {
                if (!idRaw) {
                    await this.replyText(interaction, this.t('commands.security.automod.blacklistNeedId'));
                    return;
                }
                const ok = await store.removeBlacklist(guildId, idRaw);
                await emitSecurityEvent(this.heart, SECURITY_EVENTS.BLACKLIST_REMOVE, {
                    guildId,
                    id: idRaw,
                    actorId: interaction.user.id,
                });
                await this.replyText(
                    interaction,
                    ok
                        ? this.t('commands.security.automod.blacklistRemoved', { id: idRaw })
                        : this.t('commands.security.automod.blacklistNotFound', { id: idRaw }),
                );
                return;
            }
            if (action === 'add') {
                if (!kindRaw || !patternRaw) {
                    await this.replyText(interaction, this.t('commands.security.automod.blacklistNeedPattern'));
                    return;
                }
                const kind = kindRaw as BlacklistKind;
                if (kind !== 'word' && kind !== 'link' && kind !== 'regex') {
                    await this.replyText(interaction, this.t('commands.security.automod.blacklistBadKind'));
                    return;
                }
                const pattern = normalizeBlacklistPattern(kind, patternRaw);
                if (!pattern) {
                    await this.replyText(interaction, this.t('commands.security.automod.blacklistBadPattern'));
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
                await emitSecurityEvent(this.heart, SECURITY_EVENTS.BLACKLIST_ADD, {
                    guildId,
                    id,
                    kind,
                    pattern,
                    actorId: interaction.user.id,
                });
                await this.replyText(
                    interaction,
                    this.t('commands.security.automod.blacklistAdded', {
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
            await this.replyText(
                interaction,
                this.t('commands.security.automod.statusResult', {
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
            await this.replyText(
                interaction,
                this.t('commands.security.automod.toggleResult', {
                    enabled: s.enabled ? 'on' : 'off',
                }),
            );
            return;
        }

        if (sub === 'filter') {
            const name = interaction.options.getString('name', true);
            const enabled = interaction.options.getBoolean('enabled', true);
            if (!isFilterName(name)) {
                await this.replyText(
                    interaction,
                    this.t('commands.security.automod.unknownFilter', { name }),
                );
                return;
            }
            const s = await autoMod.setFilter(guildId, name, enabled);
            await this.replyText(
                interaction,
                this.t('commands.security.automod.filterResult', {
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
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.massMentionLimit = n;
                    break;
                }
                case 'capsPercent': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1 || n > 100) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.capsPercent = n;
                    break;
                }
                case 'capsMinLength': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.capsMinLength = n;
                    break;
                }
                case 'duplicateWindowMs': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1000) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.duplicateWindowMs = n;
                    break;
                }
                case 'duplicateCount': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 2) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.duplicateCount = n;
                    break;
                }
                case 'emojiMax': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 3) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.emojiMax = n;
                    break;
                }
                case 'newlineMax': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 3) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.newlineMax = n;
                    break;
                }
                case 'attachmentMax': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 2) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.attachmentMax = n;
                    break;
                }
                case 'attachmentWindowMs': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 1000) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.attachmentWindowMs = n;
                    break;
                }
                case 'timeoutSeconds': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 0) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
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
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch[key] = b;
                    break;
                }
                case 'tempRoleId': {
                    const id = valueRaw.trim();
                    if (id && !/^\d{5,32}$/.test(id)) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.tempRoleId = id || null;
                    break;
                }
                case 'tempRoleDurationMs': {
                    const n = asInt(valueRaw);
                    if (n == null || n < 5000) {
                        await this.replyText(
                            interaction,
                            this.t('commands.security.automod.invalidValue'),
                        );
                        return;
                    }
                    patch.tempRoleDurationMs = n;
                    break;
                }
                default:
                    await this.replyText(
                        interaction,
                        this.t('commands.security.automod.unknownKey', { key }),
                    );
                    return;
            }

            await autoMod.patchSettings(guildId, patch);
            await this.replyText(
                interaction,
                this.t('commands.security.automod.setResult', { key, value: valueRaw }),
            );
            return;
        }

        if (sub === 'exempt') {
            const action = interaction.options.getString('action', true);
            const kind = interaction.options.getString('type', false);
            const id = interaction.options.getString('id', false)?.trim();
            const s = await autoMod.getSettings(guildId);

            if (action === 'list') {
                await this.replyText(
                    interaction,
                    this.t('commands.security.automod.exemptList', {
                        roles: s.exemptRoleIds.join(', ') || '—',
                        channels: s.exemptChannelIds.join(', ') || '—',
                        users: s.exemptUserIds.join(', ') || '—',
                    }),
                );
                return;
            }

            if (!kind || !id || !/^\d{5,32}$/.test(id)) {
                await this.replyText(
                    interaction,
                    this.t('commands.security.automod.exemptNeedId'),
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
                await this.replyText(
                    interaction,
                    this.t('commands.security.automod.unknownExemptAction'),
                );
                return;
            }

            await autoMod.patchSettings(guildId, {
                exemptRoleIds: kind === 'role' ? list : roles,
                exemptChannelIds: kind === 'channel' ? list : channels,
                exemptUserIds: kind === 'user' ? list : users,
            });
            await this.replyText(
                interaction,
                this.t('commands.security.automod.exemptResult', {
                    action,
                    type: kind,
                    id,
                }),
            );
        }
    }


    private async handleAntiNuke(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const anti = this.heart.system.handler.$get<AntiNukeHandler>('security', 'antiNuke');
        if (!anti) {
            await this.replyText(interaction, this.t('commands.security.errors.antinukeUnavailable'));
            return;
        }
        const canView =
            (await this.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.ANTINUKE_VIEW, guildId)) ||
            (await this.heart.permissions.hasBit(interaction.user.id, SECURITY_BITS.ANTINUKE_MANAGE, guildId));
        const canManage = await this.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.ANTINUKE_MANAGE,
            guildId,
        );
        if (sub === 'status') {
            if (!canView) {
                await this.replyText(interaction, this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.ANTINUKE_VIEW }));
                return;
            }
            const rules = await anti.listRules(guildId);
            const enabled = rules.filter((r) => r.enabled);
            if (enabled.length === 0) {
                await this.replyText(interaction, this.t('commands.security.antinuke.statusEmpty'));
                return;
            }
            const lines = enabled.map(
                (r) =>
                    `• **${r.eventKey}** — max ${r.maxActions}/${Math.round(r.windowMs / 1000)}s → ${r.punishment}`,
            );
            await this.replyLines(interaction, this.t('commands.security.antinuke.statusHeader'), lines);
            return;
        }
        if (!canManage) {
            await this.replyText(interaction, this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.ANTINUKE_MANAGE }));
            return;
        }
        if (sub === 'rule') {
            const event = interaction.options.getString('event', true);
            if (!isAntiNukeEventKey(event)) {
                await this.replyText(interaction, this.t('commands.security.antinuke.unknownEvent'));
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
            await this.replyText(
                interaction,
                this.t('commands.security.antinuke.ruleResult', {
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
                await this.replyText(interaction, this.t('commands.security.antinuke.unknownEvent'));
                return;
            }
            const action = interaction.options.getString('action', true);
            const type = interaction.options.getString('type');
            const id = interaction.options.getString('id')?.trim();
            const current = await anti.getRule(guildId, event);
            if (action === 'list') {
                await this.replyText(
                    interaction,
                    this.t('commands.security.antinuke.whitelistList', {
                        event,
                        users: current.whitelistUserIds.join(', ') || '—',
                        roles: current.whitelistRoleIds.join(', ') || '—',
                    }),
                );
                return;
            }
            if (!type || !id || !/^\d{5,32}$/.test(id)) {
                await this.replyText(interaction, this.t('commands.security.antinuke.whitelistNeedId'));
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
            await this.replyText(
                interaction,
                this.t('commands.security.antinuke.whitelistResult', { action, type, id, event }),
            );
        }
    }

    private async handleRaid(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const raid = this.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        if (!raid) {
            await this.replyText(interaction, this.t('commands.security.errors.raidUnavailable'));
            return;
        }
        const can = await this.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.RAID,
            guildId,
        );
        if (!can) {
            await this.replyText(interaction, this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.RAID }));
            return;
        }
        if (sub === 'status') {
            const s = await raid.getSettings(guildId);
            const active = await raid.isRaidActive(guildId);
            await this.replyText(
                interaction,
                this.t('commands.security.raid.statusResult', {
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
            await this.replyText(
                interaction,
                this.t('commands.security.raid.toggleResult', { enabled: s.enabled ? 'on' : 'off' }),
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
                await syncQuarantineRoleId(this.heart, guildId, qRole.id);
            }
            await this.replyText(interaction, this.t('commands.security.raid.setResult'));
        }
    }

    private async handleVerify(
        interaction: ChatInputCommandInteraction,
        sub: string,
    ): Promise<void> {
        const guildId = interaction.guildId as string;
        const verify = this.heart.system.handler.$get<VerifyHandler>('security', 'verify');
        if (!verify) {
            await this.replyText(interaction, this.t('commands.security.errors.verifyUnavailable'));
            return;
        }
        const can = await this.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.VERIFY_MANAGE,
            guildId,
        );
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.VERIFY_MANAGE }),
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
                await syncQuarantineRoleId(this.heart, guildId, quarantine.id);
            }
            await this.replyText(
                interaction,
                this.t('commands.security.verify.settingsResult', {
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
                await this.replyText(interaction, this.t('commands.security.errors.noTextChannel'));
                return;
            }
            try {
                await verify.postPanel(interaction, ch as import('discord.js').TextChannel);
                await this.replyText(interaction, this.t('commands.security.verify.panelPosted'));
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg === 'verify_disabled') {
                    await this.replyText(interaction, this.t('commands.security.verify.disabled'));
                } else {
                    await this.replyText(interaction, this.t('commands.security.verify.panelFail', { detail: msg }));
                }
            }
        }
    }



    private async handleTempRole(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        if (!guild) return;
        const can = await this.heart.permissions.hasBit(
            interaction.user.id,
            SECURITY_BITS.WARN,
            guild.id,
        );
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SECURITY_BITS.WARN }),
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
            await this.replyText(interaction, this.t('commands.security.errors.invalidDuration'));
            return;
        }
        const temp = this.heart.system.handler.$get<TempRoleHandler>('security', 'tempRole');
        if (!temp) {
            await this.replyText(interaction, this.t('commands.security.errors.temproleUnavailable'));
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
            await this.replyText(
                interaction,
                this.t('commands.security.temprole.fail', { detail: result.detail }),
            );
            return;
        }
        const store = this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
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
            const msg = this.t('commands.security.temprole.ok', {
                user: user.tag,
                role: role.name,
                duration: durationRaw,
            });
            const pl = formatProofLine(proof);
            await this.replyText(
                interaction,
                pl ? `${msg}
${this.t('commands.security.results.proof', { proof: pl })}` : msg,
            );
        }
    }

    private async handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const can =
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SERVER_BITS.CONFIG_MANAGE,
                guildId,
            )) ||
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.AUTOMOD_MANAGE,
                guildId,
            )) ||
            (await this.heart.permissions.hasBit(
                interaction.user.id,
                SECURITY_BITS.RAID,
                guildId,
            ));
        if (!can) {
            await this.replyText(
                interaction,
                this.t('commands.security.errors.missingBit', { bit: SERVER_BITS.CONFIG_MANAGE }),
            );
            return;
        }
        const wizard = this.heart.system.handler.$get<SetupWizardHandler>('security', 'setupWizard');
        if (!wizard) {
            await this.replyText(interaction, this.t('commands.security.errors.setupUnavailable'));
            return;
        }
        await wizard.openSetup(interaction);
    }

    private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const wizard = this.heart.system.handler.$get<SetupWizardHandler>('security', 'setupWizard');
        if (!wizard) {
            await this.replyText(interaction, this.t('commands.security.errors.setupUnavailable'));
            return;
        }
        const text = await wizard.buildStatusText(guildId);
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.STATUS_VIEW, {
            guildId,
            actorId: interaction.user.id,
        });
        await this.replyText(interaction, text);
    }

    // --- helpers ---

    private async requireBit(
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

    private async denyIfCooldown(
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

    private async replyText(
        interaction: ChatInputCommandInteraction,
        content: string,
    ): Promise<void> {
        await replyCv2Text(interaction, {
            content,
            emoji: '🛡️',
            ephemeral: true,
        });
    }

    private async replyLines(
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

    private async replyDeniedOnly(
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

    private async replyActionResult(
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
