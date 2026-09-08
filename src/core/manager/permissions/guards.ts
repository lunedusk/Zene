import { secrets } from '#core/helpers/secretManager.js';

export const OWNER_BIT = 'bot.owner';
export const BOT_PROTECTED_BIT = 'bot.protected';
export const SERVER_PROTECTED_BIT = 'server.protected';

export function bitsIncludeOwner(bits: string[] | undefined | null): boolean {
    return Array.isArray(bits) && bits.includes(OWNER_BIT);
}

export function bitsIncludeBotProtected(bits: string[] | undefined | null): boolean {
    return Array.isArray(bits) && bits.includes(BOT_PROTECTED_BIT);
}

export function bitsIncludeServerProtected(bits: string[] | undefined | null): boolean {
    return Array.isArray(bits) && bits.includes(SERVER_PROTECTED_BIT);
}

export function envOwnerIds(): string[] {
    const raw = secrets.getOptional('BotOwnerIds', '') ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function isEnvOwner(userId: string | null | undefined): boolean {
    if (!userId) return false;
    return envOwnerIds().includes(userId);
}
