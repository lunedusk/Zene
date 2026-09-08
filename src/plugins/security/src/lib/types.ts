export type PunishOp =
    | 'ban'
    | 'unban'
    | 'kick'
    | 'timeout'
    | 'untimeout'
    | 'softban'
    | 'tempban'
    | 'hackban';

export interface SecurityActor {
    readonly userId: string;
    readonly tag?: string;
}

export interface GuildAuthzDecision {
    readonly guildId: string;
    readonly allowed: boolean;
    readonly reason:
        | 'bot_owner'
        | 'server_owner'
        | 'server_bit'
        | 'not_server_owner'
        | 'unknown_guild'
        | 'fleet_unreachable';
}

export interface GuildTargetingResult {
    readonly allowedGuildIds: readonly string[];
    readonly denied: readonly GuildAuthzDecision[];
    readonly requestedAll: boolean;
}

export interface PerGuildActionResult {
    readonly guildId: string;
    readonly ok: boolean;
    readonly code?: string;
    readonly detail?: string;
    readonly vars?: Record<string, string | number | boolean | null | undefined>;
}

export interface ActionBatchResult {
    readonly ok: boolean;
    readonly results: readonly PerGuildActionResult[];
    readonly code?: string;
    readonly vars?: Record<string, string | number | boolean | null | undefined>;
    readonly denied: readonly GuildAuthzDecision[];
}

export interface TempbanRecord {
    readonly id: string;
    readonly guildId: string;
    readonly userId: string;
    readonly actorId: string;
    readonly reason: string | null;
    readonly expiresAt: number;
    readonly createdAt: number;
}

export interface SecurityGuildSettingsRow {
    readonly guildId: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface InfractionRow {
    readonly id: string;
    readonly guildId: string;
    readonly userId: string;
    readonly actorId: string;
    readonly type: string;
    readonly reason: string | null;
    readonly metadata: string | null;
    readonly createdAt: number;
}

export interface ViolationRow {
    readonly guildId: string;
    readonly userId: string;
    readonly points: number;
    readonly lastActivityAt: number;
    readonly updatedAt: number;
}

export interface ChannelOverwriteSnapshot {
    readonly channelId: string;
    readonly allow: string;
    readonly deny: string;
}

export interface FreezeStateRow {
    readonly guildId: string;
    readonly active: boolean;
    readonly pauseInvites: boolean;
    readonly lockChannels: boolean;
    readonly quarantineJoins: boolean;
    readonly reason: string | null;
    readonly actorId: string | null;
    readonly overwriteSnapshot: string | null;
    readonly invitesPausedUntil: number | null;
    readonly activatedAt: number | null;
    readonly updatedAt: number;
}

export interface SnipeEntry {
    readonly messageId: string;
    readonly channelId: string;
    readonly guildId: string;
    readonly authorId: string;
    readonly authorTag: string;
    readonly content: string;
    readonly attachmentUrls: readonly string[];
    readonly deletedAt: number;
}

export interface LockdownOptions {
    readonly pauseInvites: boolean;
    readonly lockChannels: boolean;
    readonly quarantineJoins: boolean;
    readonly reason?: string;
}

export type AutoModFilterName =
    | 'invites'
    | 'links'
    | 'spoilers'
    | 'caps'
    | 'zalgo'
    | 'duplicates'
    | 'massMention'
    | 'everyoneHere'
    | 'rolePing'
    | 'knownSpam'
    | 'emojiSpam'
    | 'newlines'
    | 'attachments'
    | 'wordBlacklist'
    | 'linkBlacklist'
    | 'regexBlacklist';

export type AutoModActionName = 'delete' | 'warn' | 'timeout' | 'strike' | 'tempRole';

export interface AutoModSettings {
    readonly guildId: string;
    readonly enabled: boolean;
    readonly invites: boolean;
    readonly links: boolean;
    readonly spoilers: boolean;
    readonly caps: boolean;
    readonly zalgo: boolean;
    readonly duplicates: boolean;
    readonly massMention: boolean;
    readonly everyoneHere: boolean;
    readonly rolePing: boolean;
    readonly knownSpam: boolean;
    readonly emojiSpam: boolean;
    readonly newlines: boolean;
    readonly attachments: boolean;
    readonly wordBlacklist: boolean;
    readonly linkBlacklist: boolean;
    readonly regexBlacklist: boolean;
    readonly massMentionLimit: number;
    readonly capsPercent: number;
    readonly capsMinLength: number;
    readonly duplicateWindowMs: number;
    readonly duplicateCount: number;
    readonly emojiMax: number;
    readonly newlineMax: number;
    readonly attachmentMax: number;
    readonly attachmentWindowMs: number;
    readonly actionDelete: boolean;
    readonly actionWarn: boolean;
    readonly actionTimeout: boolean;
    readonly actionStrike: boolean;
    readonly actionTempRole: boolean;
    readonly timeoutSeconds: number;
    readonly tempRoleId: string | null;
    readonly tempRoleDurationMs: number;
    readonly exemptRoleIds: readonly string[];
    readonly exemptChannelIds: readonly string[];
    readonly exemptUserIds: readonly string[];
    readonly updatedAt: number;
}

export interface AutoModHit {
    readonly filter: AutoModFilterName;
    readonly detail?: string;
}

export interface SpamSignatureEntry {
    readonly id: string;
    readonly kind: 'image' | 'text';
    readonly label?: string;
    readonly size?: number;
    readonly width?: number;
    readonly height?: number;
    readonly header4?: string;
    readonly header16?: string;
    readonly footer4?: string;
    readonly footer16?: string;
    readonly first4?: string;
    readonly first16?: string;
    readonly last4?: string;
    readonly last16?: string;
    readonly blake3?: string;
    readonly blake3Full?: string;
    readonly text?: string;
}

export interface SpamSignaturesFile {
    readonly version: number;
    readonly entries: readonly SpamSignatureEntry[];
}

// --- Phase 4: anti-nuke / raid / verify ---

export type AntiNukeEventKey =
    | 'guildUpdate'
    | 'channelCreate'
    | 'channelDelete'
    | 'roleCreate'
    | 'roleDelete'
    | 'roleUpdate'
    | 'emojiCreate'
    | 'emojiDelete'
    | 'stickerCreate'
    | 'stickerDelete'
    | 'webhookUpdate'
    | 'memberBan'
    | 'memberKick'
    | 'memberPrune'
    | 'memberRoleMass'
    | 'messageBulkDelete';

export type AntiNukePunishment = 'stripRoles' | 'kick' | 'ban' | 'timeout' | 'quarantine' | 'tempRole';

export interface AntiNukeRule {
    readonly guildId: string;
    readonly eventKey: AntiNukeEventKey;
    readonly enabled: boolean;
    readonly windowMs: number;
    readonly maxActions: number;
    readonly punishment: AntiNukePunishment;
    readonly punishmentDurationMs: number;
    readonly whitelistUserIds: readonly string[];
    readonly whitelistRoleIds: readonly string[];
    readonly updatedAt: number;
}

export interface RaidSettings {
    readonly guildId: string;
    readonly enabled: boolean;
    readonly maxJoins: number;
    readonly windowMs: number;
    readonly action: 'kick' | 'ban' | 'quarantine' | 'pauseVerify';
    readonly quarantineRoleId: string | null;
    readonly pauseVerifyMs: number;
    readonly joinRoleId: string | null;
    readonly updatedAt: number;
}

export interface VerifySettings {
    readonly guildId: string;
    readonly enabled: boolean;
    readonly verifiedRoleId: string | null;
    readonly quarantineRoleId: string | null;
    readonly maxAttempts: number;
    readonly challengeTtlMs: number;
    readonly updatedAt: number;
}

export interface CaptchaChallenge {
    readonly code: string;
    readonly guildId: string;
    readonly userId: string;
    readonly attempts: number;
    readonly expiresAt: number;
}

export type BlacklistKind = 'word' | 'link' | 'regex';

export interface BlacklistEntry {
    readonly id: string;
    readonly guildId: string;
    readonly kind: BlacklistKind;
    readonly pattern: string;
    readonly createdAt: number;
    readonly actorId: string | null;
}

export interface TempRoleRecord {
    readonly guildId: string;
    readonly userId: string;
    readonly roleId: string;
    readonly expiresAt: number;
    readonly reason: string | null;
    readonly actorId: string | null;
    readonly createdAt: number;
}
