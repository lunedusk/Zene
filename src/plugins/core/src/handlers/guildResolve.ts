import type { Guild } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import {
    ensureGuildOnClient,
    findGuildOnClient,
    isGuildLikelyOnProcess,
    shardIdForGuild,
} from '#core/helpers/guildAffinity.js';
import { normalizeGuildIdList, type GuildIdInput } from '../lib/guildIds.js';

export interface ResolvedGuild {
    readonly guildId: string;
    readonly guild: Guild | null;
    readonly shardId: number;
    readonly onProcess: boolean;
}

export default class GuildResolveHandler extends BaseHandler {
    public readonly name = 'guildResolve';
    public readonly description = 'Resolve guild ids to Guild objects and shard placement';

    public normalize(input: GuildIdInput): { all: boolean; ids: string[] } {
        return normalizeGuildIdList(input);
    }

    public shardId(guildId: string, totalShards?: number): number {
        const total =
            totalShards ??
            Math.max(1, this.heart.client.shard?.count ?? (this.heart.control.shards().length || 1));
        return shardIdForGuild(guildId, total);
    }

    public isLocal(guildId: string): boolean {
        const local = this.heart.control.shards();
        const total = Math.max(
            1,
            this.heart.client.shard?.count ?? (local.length > 0 ? local.length : 1),
        );
        return isGuildLikelyOnProcess(guildId, total, local);
    }

    public async resolveOne(guildId: string): Promise<ResolvedGuild> {
        const client = this.heart.client;
        const local = this.heart.control.shards();
        const total = Math.max(1, client.shard?.count ?? (local.length > 0 ? local.length : 1));
        const shardId = shardIdForGuild(guildId, total);
        const onProcess = isGuildLikelyOnProcess(guildId, total, local);
        let guild: Guild | null = findGuildOnClient(client, guildId) ?? null;
        if (!guild && onProcess) {
            guild = await ensureGuildOnClient(client, guildId);
        }
        return { guildId, guild, shardId, onProcess };
    }

    public async resolveMany(input: GuildIdInput): Promise<ResolvedGuild[]> {
        const { all, ids } = normalizeGuildIdList(input);
        const client = this.heart.client;
        const targetIds = all ? [...client.guilds.cache.keys()] : ids;
        const out: ResolvedGuild[] = [];
        for (const id of targetIds) {
            out.push(await this.resolveOne(id));
        }
        return out;
    }

    public listLocalGuildIds(): string[] {
        return [...this.heart.client.guilds.cache.keys()];
    }
}
