import type { IHeart } from '#core/heart/index.js';
import type { ActionBatchResult, PunishOp, SecurityActor } from './types.js';

export const SECURITY_EVENTS = {
    PUNISH_BAN: 'security.punish.ban',
    PUNISH_UNBAN: 'security.punish.unban',
    PUNISH_KICK: 'security.punish.kick',
    PUNISH_TIMEOUT: 'security.punish.timeout',
    PUNISH_UNTIMEOUT: 'security.punish.untimeout',
    PUNISH_SOFTBAN: 'security.punish.softban',
    PUNISH_TEMPBAN: 'security.punish.tempban',
    PUNISH_HACKBAN: 'security.punish.hackban',
    WARN_ADD: 'security.warn.add',
    WARN_REMOVE: 'security.warn.remove',
    NOTE_ADD: 'security.note.add',
    VIOLATION_UPDATE: 'security.violation.update',
    LOCKDOWN_START: 'security.lockdown.start',
    LOCKDOWN_END: 'security.lockdown.end',
    INVITE_PAUSE_REFRESH: 'security.invite_pause.refresh',
    PURGE: 'security.purge',
    SNIPE: 'security.snipe',
    CHANNEL_LOCK: 'security.channel.lock',
    CHANNEL_UNLOCK: 'security.channel.unlock',
    SLOWMODE: 'security.channel.slowmode',
    AUTOMOD_HIT: 'security.automod.hit',
    AUTOMOD_ACTION: 'security.automod.action',
    ANTINUKE_TRIP: 'security.antinuke.trip',
    ANTINUKE_ACTION: 'security.antinuke.action',
    RAID_TRIGGER: 'security.raid.trigger',
    RAID_JOIN: 'security.raid.join',
    VERIFY_SUCCESS: 'security.verify.success',
    VERIFY_FAIL: 'security.verify.fail',
    VERIFY_PANEL: 'security.verify.panel',
    SETUP_OPEN: 'security.setup.open',
    SETUP_ANTINUKE_SAFE: 'security.setup.antinuke_safe',
    STATUS_VIEW: 'security.status.view',
    TEMP_ROLE_ADD: 'security.temp_role.add',
    TEMP_ROLE_REMOVE: 'security.temp_role.remove',
    BLACKLIST_ADD: 'security.blacklist.add',
    BLACKLIST_REMOVE: 'security.blacklist.remove',
} as const;

export type SecurityEventName = (typeof SECURITY_EVENTS)[keyof typeof SECURITY_EVENTS];

const OP_TO_EVENT: Record<PunishOp, SecurityEventName> = {
    ban: SECURITY_EVENTS.PUNISH_BAN,
    unban: SECURITY_EVENTS.PUNISH_UNBAN,
    kick: SECURITY_EVENTS.PUNISH_KICK,
    timeout: SECURITY_EVENTS.PUNISH_TIMEOUT,
    untimeout: SECURITY_EVENTS.PUNISH_UNTIMEOUT,
    softban: SECURITY_EVENTS.PUNISH_SOFTBAN,
    tempban: SECURITY_EVENTS.PUNISH_TEMPBAN,
    hackban: SECURITY_EVENTS.PUNISH_HACKBAN,
};

export interface PunishEventPayload {
    readonly op: PunishOp;
    readonly guildIds: readonly string[];
    readonly actor: SecurityActor;
    readonly targetUserId: string;
    readonly reason?: string;
    readonly durationMs?: number;
    readonly deleteMessageSeconds?: number;
    readonly source: 'command';
    readonly result: ActionBatchResult;
    readonly at: number;
}

export async function emitPunishEvent(
    heart: IHeart,
    op: PunishOp,
    payload: Omit<PunishEventPayload, 'op' | 'at'>,
): Promise<void> {
    const event = OP_TO_EVENT[op];
    const full: PunishEventPayload = {
        ...payload,
        op,
        at: Date.now(),
    };
    try {
        await heart.system.events.emit(event, full);
    } catch (err: unknown) {
        heart.log.warn(
            `Failed to emit ${event}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

export async function emitSecurityEvent(
    heart: IHeart,
    event: SecurityEventName,
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        await heart.system.events.emit(event, { ...payload, at: Date.now() });
    } catch (err: unknown) {
        heart.log.warn(
            `Failed to emit ${event}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}
