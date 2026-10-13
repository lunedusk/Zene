import type { IHeart } from './index.js';
import type { ButtonInteraction } from 'discord.js';
import { Paginator, unitsFromLines, replyOrPaginate, clearUserSessions, canPaginateWithNav, parseNavCustomId, type PaginatorCreateOptions, type AutoPaginateOptions } from '#core/paginator/index.js';

export interface PaginatorDomain {
    create(options: Omit<PaginatorCreateOptions, 'heart'> & { heart?: IHeart }): Paginator;
    replyOrPaginate(
        options: Omit<AutoPaginateOptions, 'heart'> & { heart?: IHeart },
    ): Promise<Awaited<ReturnType<typeof replyOrPaginate>>>;
    handleButton(interaction: ButtonInteraction): Promise<boolean>;
    clearUserSessions(userId: string): void;
    canAttach(utilButtonCount: number): boolean;
    unitsFromLines(lines: readonly string[], idPrefix?: string): ReturnType<typeof unitsFromLines>;
    isPaginatorId(customId: string): boolean;
}

export function createPaginatorDomain(heart: IHeart): PaginatorDomain {
    return {
        create(options) {
            return new Paginator({ ...options, heart: options.heart ?? heart });
        },
        replyOrPaginate(options) {
            return replyOrPaginate({ ...options, heart: options.heart ?? heart });
        },
        handleButton(interaction) {
            return Paginator.handleButton(interaction);
        },
        clearUserSessions,
        canAttach(utilButtonCount) {
            return canPaginateWithNav(utilButtonCount);
        },
        unitsFromLines,
        isPaginatorId(customId) {
            return parseNavCustomId(customId) !== null;
        },
    };
}
