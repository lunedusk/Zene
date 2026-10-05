import type { IHeart } from '#core/heart/index.js';
import type { Client, Guild } from 'discord.js';
import { BOT_BITS } from './bits.js';
import type { GuildAuthzDecision, GuildTargetingResult } from './types.js';

export type GuildIdInput = string | number | ReadonlyArray<string | number>;

export function normalizeGuildIdList(input: GuildIdInput): {
    all: boolean;
    ids: string[];
} {
    const raw = Array.isArray(input) ? [...input] : [input];
    const ids: string[] = [];
    let all = false;
    for (const item of raw) {
        const s = String(item).trim();
        if (!s) continue;
        if (s.toLowerCase() === 'all') {
            all = true;
            continue;
        }
        if (/^\d{5,32}$/.test(s)) {
            ids.push(s);
        }
    }
    return { all, ids: Array.from(new Set(ids)) };
}




export function parseGuildsOption(
    raw: string | null | undefined,
    fallbackGuildId: string | null,
): { all: boolean; ids: string[] } {
    if (raw == null || raw.trim() === '') {
        return {
            all: false,
            ids: fallbackGuildId ? [fallbackGuildId] : [],
        };
    }
    const tokens = raw
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    return normalizeGuildIdList(tokens);
}

async function isBotOwner(heart: IHeart, userId: string): Promise<boolean> {
    try {
        if (await heart.permissions.hasBit(userId, BOT_BITS.OWNER)) return true;
    } catch {

    }
    return false;
}







async function resolveOwnerId(
    heart: IHeart,
    guildId: string,
    localGuild: Guild | undefined,
): Promise<{ ownerId: string | null; reachable: boolean }> {
    if (localGuild) {
        return { ownerId: localGuild.ownerId, reachable: true };
    }

    try {
        const fetched = await heart.client.guilds.fetch(guildId);
        if (fetched) {
            return { ownerId: fetched.ownerId, reachable: true };
        }
    } catch {

    }

    if (heart.crossHost.isAvailable()) {
        try {
            const { fetchGuildOwner, isClusterClientReady } = await import(
                '#core/crosshost/worker/clusterClient.js'
            );
            if (!isClusterClientReady()) {
                return { ownerId: null, reachable: false };
            }
            const info = await fetchGuildOwner(guildId);

            if (info.machineId) {
                return { ownerId: null, reachable: true };
            }
            return { ownerId: null, reachable: false };
        } catch {
            return { ownerId: null, reachable: false };
        }
    }

    return { ownerId: null, reachable: false };
}








export async function resolveAuthorizedGuilds(
    heart: IHeart,
    actorUserId: string,
    input: { all: boolean; ids: string[] },
): Promise<GuildTargetingResult> {
    const client: Client = heart.client;
    const botOwner = await isBotOwner(heart, actorUserId);

    let candidateIds: string[];
    if (input.all) {
        if (botOwner) {
            candidateIds = Array.from(client.guilds.cache.keys());
        } else {
            candidateIds = [];
            for (const g of client.guilds.cache.values()) {
                if (g.ownerId === actorUserId) candidateIds.push(g.id);
            }
        }
    } else {
        candidateIds = input.ids;
    }

    if (candidateIds.length === 0) {
        return { allowedGuildIds: [], denied: [], requestedAll: input.all };
    }

    if (botOwner) {
        return {
            allowedGuildIds: candidateIds,
            denied: [],
            requestedAll: input.all,
        };
    }

    const allowed: string[] = [];
    const denied: GuildAuthzDecision[] = [];

    for (const guildId of candidateIds) {
        const local = client.guilds.cache.get(guildId);
        const { ownerId, reachable } = await resolveOwnerId(heart, guildId, local);

        if (!reachable && !local) {
            denied.push({ guildId, allowed: false, reason: 'fleet_unreachable' });
            continue;
        }

        if (ownerId == null) {

            denied.push({
                guildId,
                allowed: false,
                reason: local ? 'not_server_owner' : 'not_server_owner',
            });
            continue;
        }

        if (ownerId === actorUserId) {
            allowed.push(guildId);
        } else {
            denied.push({ guildId, allowed: false, reason: 'not_server_owner' });
        }
    }

    return {
        allowedGuildIds: allowed,
        denied,
        requestedAll: input.all,
    };
}
