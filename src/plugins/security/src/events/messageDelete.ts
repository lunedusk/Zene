import type { Message, PartialMessage } from 'discord.js';
import { BaseEvent } from '#core/bases/Event.js';
import { pushSnipe } from '../lib/snipeCache.js';

export default class MessageDeleteEvent extends BaseEvent<[Message | PartialMessage]> {
    public readonly name = 'messageDelete';

    public async execute(message: Message | PartialMessage): Promise<void> {
        if (!message.guildId || !message.channelId) return;
        if (message.author?.bot) return;

        const content = message.content ?? '';
        const attachmentUrls: string[] = [];
        if (message.attachments) {
            for (const att of message.attachments.values()) {
                attachmentUrls.push(att.url);
            }
        }

        if (!content && attachmentUrls.length === 0) return;

        const author = message.author;
        const authorId = author?.id ?? 'unknown';
        const authorTag = author
            ? author.discriminator && author.discriminator !== '0'
                ? `${author.username}#${author.discriminator}`
                : author.username
            : 'unknown';

        try {
            await pushSnipe(this.heart, {
                messageId: message.id,
                channelId: message.channelId,
                guildId: message.guildId,
                authorId,
                authorTag,
                content: content.slice(0, 1900),
                attachmentUrls: attachmentUrls.slice(0, 5),
                deletedAt: Date.now(),
            });
        } catch (err: unknown) {
            this.heart.log.debug(
                `Snipe capture failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
