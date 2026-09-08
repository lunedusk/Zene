export const SECURITY_BITS = {
    PURGE: 'plugin.security.purge',
    SNIPE: 'plugin.security.snipe',
    LOCKDOWN: 'plugin.security.lockdown',
    WARN: 'plugin.security.warn',
    VIOLATIONS_EDIT: 'plugin.security.violations.edit',
    AUTOMOD_MANAGE: 'plugin.security.automod.manage',
    AUTOMOD_VIEW: 'plugin.security.automod.view',
    ANTINUKE_MANAGE: 'plugin.security.antinuke.manage',
    ANTINUKE_VIEW: 'plugin.security.antinuke.view',
    VERIFY_MANAGE: 'plugin.security.verify.manage',
    FREEZE: 'plugin.security.freeze',
    RAID: 'plugin.security.raid',
} as const;

export type SecurityBit = (typeof SECURITY_BITS)[keyof typeof SECURITY_BITS];

export const SECURITY_BITS_TO_REGISTER: ReadonlyArray<{ bit: string; description: string; rank: number }> = [
    { bit: SECURITY_BITS.PURGE, description: 'Purge messages in channels.', rank: 400 },
    { bit: SECURITY_BITS.SNIPE, description: 'View recently deleted messages (snipe).', rank: 350 },
    { bit: SECURITY_BITS.LOCKDOWN, description: 'Lock or unlock channels and apply lockdown.', rank: 450 },
    { bit: SECURITY_BITS.WARN, description: 'Issue, list, and remove warnings.', rank: 400 },
    { bit: SECURITY_BITS.VIOLATIONS_EDIT, description: 'Manually edit violation counters.', rank: 450 },
    { bit: SECURITY_BITS.AUTOMOD_MANAGE, description: 'Configure AutoMod filters and blacklists.', rank: 500 },
    { bit: SECURITY_BITS.AUTOMOD_VIEW, description: 'View AutoMod configuration and status.', rank: 300 },
    { bit: SECURITY_BITS.ANTINUKE_MANAGE, description: 'Configure anti-nuke rules and thresholds.', rank: 550 },
    { bit: SECURITY_BITS.ANTINUKE_VIEW, description: 'View anti-nuke configuration and status.', rank: 300 },
    { bit: SECURITY_BITS.VERIFY_MANAGE, description: 'Manage verification panels and challenges.', rank: 450 },
    { bit: SECURITY_BITS.FREEZE, description: 'Enable or disable server freeze mode.', rank: 550 },
    { bit: SECURITY_BITS.RAID, description: 'Toggle raid mode and join-rate protections.', rank: 550 },
];

/** Existing core/server bits used for classic moderation actions. */
export const SERVER_BITS = {
    BAN: 'server.members.ban',
    KICK: 'server.members.kick',
    MUTE: 'server.members.mute',
    HISTORY: 'server.members.history',
    NOTES: 'server.members.notes',
    VIEW: 'server.members.view',
    CONFIG_MANAGE: 'server.config.manage',
} as const;

export const BOT_BITS = {
    OWNER: 'bot.owner',
    MEMBERS_BAN: 'bot.members.ban',
    MEMBERS_BAN_GLOBAL: 'bot.members.ban_global',
    MEMBERS_KICK: 'bot.members.kick',
    MEMBERS_MUTE: 'bot.members.mute',
} as const;
