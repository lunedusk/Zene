import type { Message } from 'discord.js';
import { BaseEvent } from '#core/bases/Event.js';
import type AutoModHandler from '../handlers/autoMod.js';

export default class MessageCreateEvent extends BaseEvent<[Message]> {
    public readonly name = 'messageCreate';

    public async execute(message: Message): Promise<void> {
        if (!message.guildId || message.author.bot) return;

        const autoMod = this.heart.system.handler.$get<AutoModHandler>('security', 'autoMod');
        if (!autoMod) return;

        try {
            await autoMod.processMessage(message);
        } catch (err: unknown) {
            this.heart.log.debug(
                `AutoMod process failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
