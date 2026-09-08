import type { User } from 'discord.js';
import { SERVER_BITS } from '../lib/bits.js';
import type { PunishOp, SecurityActor } from '../lib/types.js';

type SingleGuildBit = typeof SERVER_BITS.BAN | typeof SERVER_BITS.KICK | typeof SERVER_BITS.MUTE;

export const OP_BIT: Record<PunishOp, SingleGuildBit> = {
    ban: SERVER_BITS.BAN,
    unban: SERVER_BITS.BAN,
    softban: SERVER_BITS.BAN,
    tempban: SERVER_BITS.BAN,
    hackban: SERVER_BITS.BAN,
    kick: SERVER_BITS.KICK,
    timeout: SERVER_BITS.MUTE,
    untimeout: SERVER_BITS.MUTE,
};

export const PUNISH_OPS = new Set<string>([
    'ban',
    'unban',
    'kick',
    'timeout',
    'untimeout',
    'softban',
    'tempban',
    'hackban',
]);

export function actorFrom(user: User): SecurityActor {
    const tag =
        user.discriminator && user.discriminator !== '0'
            ? `${user.username}#${user.discriminator}`
            : user.username;
    return { userId: user.id, tag };
}
