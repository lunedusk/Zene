import type { AntiNukeEventKey, AntiNukePunishment, AntiNukeRule } from './types.js';

export const ANTI_NUKE_EVENT_KEYS: readonly AntiNukeEventKey[] = [
    'guildUpdate',
    'channelCreate',
    'channelDelete',
    'roleCreate',
    'roleDelete',
    'roleUpdate',
    'emojiCreate',
    'emojiDelete',
    'stickerCreate',
    'stickerDelete',
    'webhookUpdate',
    'memberBan',
    'memberKick',
    'memberPrune',
    'memberRoleMass',
    'messageBulkDelete',
] as const;

export function isAntiNukeEventKey(value: string): value is AntiNukeEventKey {
    return (ANTI_NUKE_EVENT_KEYS as readonly string[]).includes(value);
}

export function isAntiNukePunishment(value: string): value is AntiNukePunishment {
    return (['stripRoles', 'kick', 'ban', 'timeout', 'quarantine', 'tempRole'] as const).includes(
        value as AntiNukePunishment,
    );
}


export function defaultAntiNukeRule(
    guildId: string,
    eventKey: AntiNukeEventKey,
): AntiNukeRule {
    const massRole = eventKey === 'memberRoleMass';
    return {
        guildId,
        eventKey,
        enabled: false,
        windowMs: massRole ? 15_000 : 10_000,
        maxActions: massRole ? 8 : 3,
        punishment: 'stripRoles',
        punishmentDurationMs: 600_000,
        whitelistUserIds: [],
        whitelistRoleIds: [],
        updatedAt: Date.now(),
    };
}


export const AUDIT_TO_EVENT: Readonly<Record<number, AntiNukeEventKey | undefined>> = {
    1: 'guildUpdate',
    10: 'channelCreate',
    12: 'channelDelete',
    30: 'roleCreate',
    32: 'roleDelete',
    31: 'roleUpdate',
    60: 'emojiCreate',
    62: 'emojiDelete',
    90: 'stickerCreate',
    92: 'stickerDelete',
    50: 'webhookUpdate',
    51: 'webhookUpdate',
    52: 'webhookUpdate',
    20: 'memberKick',
    22: 'memberBan',
    21: 'memberPrune',
    25: 'memberRoleMass',
    73: 'messageBulkDelete',
};
