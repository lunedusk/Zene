import type { GuildMember } from 'discord.js';
import { BaseEvent } from '#core/bases/Event.js';
import type RaidGuardHandler from '../handlers/raidGuard.js';

export default class GuildMemberAddEvent extends BaseEvent<[GuildMember]> {
    public readonly name = 'guildMemberAdd';

    public async execute(member: GuildMember): Promise<void> {
        const raid = this.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        if (!raid) return;
        try {
            await raid.onMemberJoin(member);
        } catch (err: unknown) {
            this.heart.log.debug(
                `Raid guard join failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
