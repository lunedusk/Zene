import type { Message } from 'discord.js';
import type { AutoModFilterName, AutoModHit, AutoModSettings } from './types.js';

const INVITE_RE =
    /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/[a-zA-Z0-9-]+/i;
const URL_RE = /https?:\/\/[^\s<>\]]+/i;
const SPOILER_RE = /\|\|[\s\S]+?\|\|/g;
const COMBINING_RE = /[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;

export function checkInvites(content: string): AutoModHit | null {
    if (INVITE_RE.test(content)) return { filter: 'invites', detail: 'discord_invite' };
    return null;
}

export function checkLinks(content: string): AutoModHit | null {
    if (URL_RE.test(content)) return { filter: 'links', detail: 'url' };
    return null;
}

export function checkSpoilers(content: string): AutoModHit | null {
    const matches = content.match(SPOILER_RE);
    if (matches && matches.length >= 3) {
        return { filter: 'spoilers', detail: `count=${matches.length}` };
    }
    return null;
}

export function checkCaps(content: string, settings: AutoModSettings): AutoModHit | null {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length < settings.capsMinLength) return null;
    let upper = 0;
    for (let i = 0; i < letters.length; i++) {
        const ch = letters[i];
        if (ch && ch === ch.toUpperCase() && ch !== ch.toLowerCase()) upper += 1;
    }
    const pct = (upper / letters.length) * 100;
    if (pct >= settings.capsPercent) {
        return { filter: 'caps', detail: `pct=${Math.round(pct)}` };
    }
    return null;
}

export function checkZalgo(content: string): AutoModHit | null {
    const combining = content.match(COMBINING_RE);
    if (combining && combining.length >= 8) {
        return { filter: 'zalgo', detail: `marks=${combining.length}` };
    }
    return null;
}

export function checkMassMention(message: Message, settings: AutoModSettings): AutoModHit | null {
    const unique = new Set(message.mentions.users.keys());
    if (unique.size >= settings.massMentionLimit) {
        return { filter: 'massMention', detail: `count=${unique.size}` };
    }
    return null;
}

export function checkEveryoneHere(message: Message): AutoModHit | null {
    if (message.mentions.everyone) {
        return { filter: 'everyoneHere', detail: 'everyone_or_here' };
    }
    // discord.js sets mentions.everyone for @everyone and @here
    const content = message.content ?? '';
    if (/(^|\s)@(everyone|here)\b/i.test(content)) {
        return { filter: 'everyoneHere', detail: 'everyone_or_here_text' };
    }
    return null;
}

export function checkRolePing(message: Message): AutoModHit | null {
    if (message.mentions.roles.size >= 1) {
        return { filter: 'rolePing', detail: `roles=${message.mentions.roles.size}` };
    }
    return null;
}


const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function checkEmojiSpam(content: string, settings: AutoModSettings): AutoModHit | null {
    if (!content) return null;
    const matches = content.match(EMOJI_RE);
    const count = matches?.length ?? 0;
    if (count >= settings.emojiMax) {
        return { filter: 'emojiSpam', detail: `count=${count}` };
    }
    return null;
}

export function checkNewlines(content: string, settings: AutoModSettings): AutoModHit | null {
    if (!content) return null;
    const lines = content.split(/\r?\n/).length;
    if (lines >= settings.newlineMax) {
        return { filter: 'newlines', detail: `lines=${lines}` };
    }
    return null;
}

export function checkAttachments(message: Message, settings: AutoModSettings): AutoModHit | null {
    const count = message.attachments.size;
    if (count >= settings.attachmentMax) {
        return { filter: 'attachments', detail: `count=${count}` };
    }
    return null;
}

/**
 * Run enabled content/mention filters in a fixed cheap-first order.
 * knownSpam and duplicates are handled by the AutoMod handler (async / stateful).
 */
export function runSyncFilters(
    message: Message,
    settings: AutoModSettings,
): AutoModHit | null {
    const content = message.content ?? '';

    if (settings.everyoneHere) {
        const h = checkEveryoneHere(message);
        if (h) return h;
    }
    if (settings.rolePing) {
        const h = checkRolePing(message);
        if (h) return h;
    }
    if (settings.massMention) {
        const h = checkMassMention(message, settings);
        if (h) return h;
    }
    if (settings.invites && content) {
        const h = checkInvites(content);
        if (h) return h;
    }
    if (settings.links && content) {
        const h = checkLinks(content);
        if (h) return h;
    }
    if (settings.spoilers && content) {
        const h = checkSpoilers(content);
        if (h) return h;
    }
    if (settings.caps && content) {
        const h = checkCaps(content, settings);
        if (h) return h;
    }
    if (settings.zalgo && content) {
        const h = checkZalgo(content);
        if (h) return h;
    }
    if (settings.emojiSpam && content) {
        const h = checkEmojiSpam(content, settings);
        if (h) return h;
    }
    if (settings.newlines && content) {
        const h = checkNewlines(content, settings);
        if (h) return h;
    }
    if (settings.attachments) {
        const h = checkAttachments(message, settings);
        if (h) return h;
    }
    return null;
}

export const FILTER_NAMES: readonly AutoModFilterName[] = [
    'invites',
    'links',
    'spoilers',
    'caps',
    'zalgo',
    'duplicates',
    'massMention',
    'everyoneHere',
    'rolePing',
    'knownSpam',
    'emojiSpam',
    'newlines',
    'attachments',
    'wordBlacklist',
    'linkBlacklist',
    'regexBlacklist',
] as const;

export function isFilterName(value: string): value is AutoModFilterName {
    return (FILTER_NAMES as readonly string[]).includes(value);
}
