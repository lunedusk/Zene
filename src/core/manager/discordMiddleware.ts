import {
    CommandInteraction,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    AutocompleteInteraction,
    NewsChannel as AnnouncementChannel,
    TextChannel,
    VoiceChannel,
    StageChannel,
    DMChannel,
    ThreadChannel,
    GuildForumThreadManager,
    GuildTextThreadManager,
    User,
    GuildMember,
    Webhook,
    WebhookClient,
    InteractionWebhook,
    Message,
    ClientUser,
} from 'discord.js';
import { resolveGlobalPlaceholders } from '#core/placeholder/index.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DiscordMiddleware');

function processComponentEmoji(emojiData: any): any {
    if (!emojiData) return emojiData;

    if (typeof emojiData === 'object' && emojiData.id != null) {
        return emojiData;
    }

    let raw: string;
    if (typeof emojiData === 'string') {
        raw = emojiData;
    } else if (typeof emojiData === 'object' && typeof emojiData.name === 'string') {
        raw = emojiData.name;
    } else {
        return emojiData;
    }

    const resolved = resolveGlobalPlaceholders(raw).trim();

    const customMatch = resolved.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
    if (customMatch) {
        return {
            animated: customMatch[1] === 'a',
            name: customMatch[2],
            id: customMatch[3],
        };
    }

    if (resolved.length > 0) {
        return { name: resolved, id: null };
    }

    return null;
}

function applyMiddleware(options: any): any {
    if (!options) return options;

    if (typeof options === 'string') {
        return resolveGlobalPlaceholders(options);
    }

    if (options?.constructor?.name === 'MessagePayload') {
        return options;
    }

    if (Array.isArray(options)) {
        if (options.length > 0 && options[0] != null && 'name' in options[0] && !('type' in options[0])) {
            return options.map((opt) => {
                if (opt && typeof opt === 'object') {
                    if (opt.name != null) opt.name = resolveGlobalPlaceholders(String(opt.name));
                    if (typeof opt.value === 'string') opt.value = resolveGlobalPlaceholders(opt.value);
                }
                return opt;
            });
        }
        return options.map((item) => applyMiddleware(item));
    }

    if (typeof options.content === 'string') {
        options.content = resolveGlobalPlaceholders(options.content);
    }

    if (Array.isArray(options.embeds)) {
        options.embeds = options.embeds.map((embed: any) => {
            const t = embed?.data ?? embed;
            if (t.title)             t.title             = resolveGlobalPlaceholders(t.title);
            if (t.description)       t.description       = resolveGlobalPlaceholders(t.description);
            if (t.url)               t.url               = resolveGlobalPlaceholders(t.url);
            if (t.author?.name)      t.author.name       = resolveGlobalPlaceholders(t.author.name);
            if (t.footer?.text)      t.footer.text       = resolveGlobalPlaceholders(t.footer.text);
            if (Array.isArray(t.fields)) {
                for (const field of t.fields) {
                    if (field.name)  field.name  = resolveGlobalPlaceholders(field.name);
                    if (field.value) field.value = resolveGlobalPlaceholders(field.value);
                }
            }
            return embed;
        });
    }

    if (Array.isArray(options.components)) {
        options.components = processComponentRows(options.components);
    }

    if (options.data?.title != null) {
        options.data.title = resolveGlobalPlaceholders(options.data.title);
        if (Array.isArray(options.data.components)) {
            options.data.components = processComponentRows(options.data.components);
        }
    } else if (options.title != null && options.components != null) {
        options.title = resolveGlobalPlaceholders(options.title);
        if (Array.isArray(options.components)) {
            options.components = processComponentRows(options.components);
        }
    }

    if (Array.isArray(options.activities)) {
        for (const act of options.activities) {
            if (act.name)    act.name    = resolveGlobalPlaceholders(act.name);
            if (act.state)   act.state   = resolveGlobalPlaceholders(act.state);
            if (act.details) act.details = resolveGlobalPlaceholders(act.details);
        }
    }

    if (typeof options.name === 'string') {
        options.name = resolveGlobalPlaceholders(options.name);
    }

    if (options.message && typeof options.message === 'object') {
        options.message = applyMiddleware(options.message);
    }

    return options;
}

function processComponentRows(rows: any[]): any[] {
    return rows.map((row: any) => {
        const targetRow = row?.data ?? row;
        if (!Array.isArray(targetRow?.components)) return row;

        for (const comp of targetRow.components) {
            const c = comp?.data ?? comp;

            if (c.label != null)                        c.label       = resolveGlobalPlaceholders(String(c.label));
            if (c.placeholder != null)                  c.placeholder = resolveGlobalPlaceholders(String(c.placeholder));
            if (typeof c.value === 'string')            c.value       = resolveGlobalPlaceholders(c.value);

            if (c.emoji !== undefined) {
                const resolved = processComponentEmoji(c.emoji);
                if (resolved === null) delete c.emoji;
                else c.emoji = resolved;
            }

            if (Array.isArray(c.options)) {
                for (const opt of c.options) {
                    if (opt.label != null)       opt.label       = resolveGlobalPlaceholders(String(opt.label));
                    if (opt.description != null) opt.description = resolveGlobalPlaceholders(String(opt.description));
                    if (typeof opt.value === 'string') opt.value = resolveGlobalPlaceholders(opt.value);

                    if (opt.emoji !== undefined) {
                        const resolved = processComponentEmoji(opt.emoji);
                        if (resolved === null) delete opt.emoji;
                        else opt.emoji = resolved;
                    }
                }
            }

        
        }
        return row;
    });
}

function patchMethod(proto: any, method: string): void {
    const original = proto[method];
    if (typeof original !== 'function') return;

    proto[method] = function (this: any, ...args: any[]) {
        if (args[0] !== undefined) args[0] = applyMiddleware(args[0]);
        return (original as (...args: unknown[]) => unknown).apply(this, args);
    };
}
export class DiscordMiddleware {
    public static apply(): void {
        log.info('Mounting Global Placeholder Middleware to all Discord.js surfaces...');

        const repliable = [CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction] as const;
        for (const cls of repliable) {
            patchMethod(cls.prototype, 'reply');
            patchMethod(cls.prototype, 'editReply');
            patchMethod(cls.prototype, 'followUp');
            patchMethod(cls.prototype, 'deferReply');
        }

        const modalable = [CommandInteraction, MessageComponentInteraction] as const;
        for (const cls of modalable) {
            patchMethod(cls.prototype, 'showModal');
        }

        patchMethod(MessageComponentInteraction.prototype, 'update');
        patchMethod(MessageComponentInteraction.prototype, 'deferUpdate');

        patchMethod(AutocompleteInteraction.prototype, 'respond');

        const sendableChannels = [
            TextChannel,
            AnnouncementChannel,
            VoiceChannel,
            StageChannel,
            DMChannel,
            ThreadChannel,
        ] as const;

        for (const cls of sendableChannels) {
            patchMethod(cls.prototype, 'send');
        }

        patchMethod(GuildForumThreadManager.prototype, 'create');
        patchMethod(GuildTextThreadManager.prototype, 'create');
        patchMethod(User.prototype, 'send');
        patchMethod(GuildMember.prototype, 'send');
        patchMethod(Webhook.prototype, 'send');
        patchMethod(Webhook.prototype, 'editMessage');
        patchMethod(WebhookClient.prototype, 'send');
        patchMethod(WebhookClient.prototype, 'editMessage');
        patchMethod(InteractionWebhook.prototype, 'send');
        patchMethod(InteractionWebhook.prototype, 'editMessage');
        patchMethod(Message.prototype, 'reply');
        patchMethod(Message.prototype, 'edit');
        patchMethod(ClientUser.prototype, 'setPresence');

        const originalSetActivity = ClientUser.prototype.setActivity;
        if (typeof originalSetActivity === 'function') {
            (ClientUser.prototype as any).setActivity = function (this: any, ...args: any[]) {
                if (typeof args[0] === 'string') {
                    args[0] = resolveGlobalPlaceholders(args[0]);
                } else if (args[0] && typeof args[0] === 'object') {
                    if (args[0].name)    args[0].name    = resolveGlobalPlaceholders(args[0].name);
                    if (args[0].state)   args[0].state   = resolveGlobalPlaceholders(args[0].state);
                    if (args[0].details) args[0].details = resolveGlobalPlaceholders(args[0].details);
                }
                return (originalSetActivity as (...args: unknown[]) => unknown).apply(this, args);
            };
        }

        log.debug('Middleware successfully bound to all Discord.js prototypes.');
    }
}