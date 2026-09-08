import type { IHeart } from '#core/heart/index.js';
import type { SnipeEntry } from './types.js';

const NS = 'security';
const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_PER_CHANNEL = 10;

function listKey(guildId: string, channelId: string): string {
    return `snipe:${guildId}:${channelId}`;
}

export async function pushSnipe(
    heart: IHeart,
    entry: SnipeEntry,
    ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
    const cache = heart.cache.ns(NS);
    const k = listKey(entry.guildId, entry.channelId);
    const raw = await cache.get(k);
    let list: SnipeEntry[] = [];
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                list = parsed as SnipeEntry[];
            }
        } catch {
            list = [];
        }
    }
    list.unshift(entry);
    if (list.length > MAX_PER_CHANNEL) {
        list = list.slice(0, MAX_PER_CHANNEL);
    }
    await cache.set(k, JSON.stringify(list), ttlMs);
}

export async function getSnipes(
    heart: IHeart,
    guildId: string,
    channelId: string,
): Promise<SnipeEntry[]> {
    const cache = heart.cache.ns(NS);
    const raw = await cache.get(listKey(guildId, channelId));
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as SnipeEntry[];
    } catch {
        return [];
    }
}

export { DEFAULT_TTL_MS as SNIPE_DEFAULT_TTL_MS };
