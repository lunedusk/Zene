import type { Guild, GuildAuditLogsEntry } from 'discord.js';
import { BaseEvent } from '#core/bases/Event.js';
import type AntiNukeHandler from '../handlers/antiNuke.js';

export default class GuildAuditLogEntryCreateEvent extends BaseEvent<
    [GuildAuditLogsEntry, Guild]
> {
    public readonly name = 'guildAuditLogEntryCreate';

    public async execute(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
        const antiNuke = this.heart.system.handler.$get<AntiNukeHandler>('security', 'antiNuke');
        if (!antiNuke) return;
        try {
            await antiNuke.handleAuditEntry(guild, entry);
        } catch (err: unknown) {
            this.heart.log.debug(
                `Anti-nuke audit handle failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
