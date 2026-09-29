/**
 * Phase 2A — Layout/theme repository boundary over dash-data store.
 * Routes must not call SQL helpers for this domain; use this repository / ThemeLayoutService.
 */

import {
    getLayout,
    putLayout,
    getTheme,
    putTheme,
    type DashLayoutDoc,
    type LayoutScope,
} from '../lib/store.js';

export interface ThemeDocument {
    tokens: Record<string, unknown>;
    updatedAt: number;
    /** Optimistic concurrency token (epoch seconds from store). */
    version: number;
}

export interface LayoutThemeRepository {
    getLayout(scope: LayoutScope, guildId?: string): Promise<DashLayoutDoc | null>;
    putLayout(doc: DashLayoutDoc): Promise<void>;
    getTheme(): Promise<ThemeDocument>;
    putTheme(tokens: Record<string, unknown>): Promise<ThemeDocument>;
}

export const layoutThemeRepository: LayoutThemeRepository = {
    async getLayout(scope, guildId) {
        return getLayout(scope, guildId);
    },

    async putLayout(doc) {
        await putLayout(doc);
    },

    async getTheme() {
        const t = await getTheme();
        return {
            tokens: t.tokens,
            updatedAt: t.updatedAt,
            version: t.updatedAt,
        };
    },

    async putTheme(tokens) {
        await putTheme(tokens);
        const t = await getTheme();
        return {
            tokens: t.tokens,
            updatedAt: t.updatedAt,
            version: t.updatedAt,
        };
    },
};
