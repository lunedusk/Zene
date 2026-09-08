import type { IHeart } from '#core/heart/index.js';

const NS = 'security';

export type CooldownOp =
    | 'ban'
    | 'kick'
    | 'timeout'
    | 'warn'
    | 'purge'
    | 'lockdown'
    | 'softban'
    | 'tempban'
    | 'hackban';

function key(guildId: string, actorId: string, op: CooldownOp): string {
    return `cd:${guildId}:${actorId}:${op}`;
}

/**
 * Action cooldowns via heart.cache.ns (local TTL + Redis when available).
 * Returns remaining ms if limited, otherwise null.
 */
export async function checkActionCooldown(
    heart: IHeart,
    guildId: string,
    actorId: string,
    op: CooldownOp,
): Promise<number | null> {
    const cache = heart.cache.ns(NS);
    const k = key(guildId, actorId, op);
    const raw = await cache.get(k);
    if (raw == null) return null;
    const resetAt = Number(raw);
    if (!Number.isFinite(resetAt)) return null;
    const remaining = resetAt - Date.now();
    return remaining > 0 ? remaining : null;
}

export async function setActionCooldown(
    heart: IHeart,
    guildId: string,
    actorId: string,
    op: CooldownOp,
    ttlMs: number,
): Promise<void> {
    if (ttlMs <= 0) return;
    const cache = heart.cache.ns(NS);
    const resetAt = Date.now() + ttlMs;
    await cache.set(key(guildId, actorId, op), String(resetAt), ttlMs);
}

export function defaultCooldownMs(op: CooldownOp): number {
    switch (op) {
        case 'purge':
            return 5_000;
        case 'lockdown':
            return 10_000;
        case 'ban':
        case 'softban':
        case 'tempban':
        case 'hackban':
            return 3_000;
        case 'kick':
        case 'timeout':
        case 'warn':
            return 2_000;
        default:
            return 2_000;
    }
}
