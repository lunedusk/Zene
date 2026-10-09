import { AsyncLocalStorage } from 'node:async_hooks';
import { getLogger } from '#core/utils/logger.js';
import { sqliteDB } from '#core/database/sqlite.js';
import { resolveCoreDataBackend, resolveBackend, type DataEngine } from '#core/database/backendSelector.js';
import { configManager } from '#core/manager/config.js';
import { secrets } from '#core/helpers/secretManager.js';
import { cacheFacade } from '#core/manager/cacheFacade.js';

const log = getLogger('GuildLocale');

export interface GuildLocaleFeatures {
    guildLocaleEnabled: boolean;
    guildLangFilesEnabled: boolean;
}

interface SqliteDb {
    prepare(sql: string): {
        run: (...params: unknown[]) => { changes: number };
        get: (...params: unknown[]) => Record<string, unknown> | undefined;
        all: (...params: unknown[]) => Record<string, unknown>[];
    };
}

interface PgPool {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

interface MongoCol {
    find(filter: object): {
        project(spec: object): { toArray(): Promise<Record<string, unknown>[]> };
        toArray(): Promise<Record<string, unknown>[]>;
    };
    updateOne(filter: object, update: object, opts?: { upsert?: boolean }): Promise<unknown>;
    deleteOne(filter: object): Promise<{ deletedCount?: number }>;
}

const localeContext = new AsyncLocalStorage<{ guildId?: string | null; locale?: string | null }>();

function readFeatures(): GuildLocaleFeatures {
    try {
        const core = configManager.get<{
            guildLocale?: { enabled?: boolean };
            guildLangFiles?: { enabled?: boolean };
        }>('core');
        return {
            guildLocaleEnabled: core?.guildLocale?.enabled !== false,
            guildLangFilesEnabled: core?.guildLangFiles?.enabled !== false,
        };
    } catch {
        return { guildLocaleEnabled: true, guildLangFilesEnabled: true };
    }
}

function masterLocale(): string {
    return secrets.getOptional('DefaultLocale') || 'en';
}

export class GuildLocaleManager {
    private ready = false;
    private engine: DataEngine = 'sqlite';
    private alias = 'main';
    private sqlite: SqliteDb | null = null;
    private pgPool: PgPool | null = null;
    private mongo: MongoCol | null = null;
    private readonly cache = cacheFacade.namespace('guildLocale');
    private readonly localeByGuild = new Map<string, string>();

    public isReady(): boolean {
        return this.ready;
    }

    public getFeatures(): GuildLocaleFeatures {
        return readFeatures();
    }

    public runWithContext<T>(ctx: { guildId?: string | null; locale?: string | null }, fn: () => T): T {
        return localeContext.run(ctx, fn);
    }

    public async runWithContextAsync<T>(
        ctx: { guildId?: string | null; locale?: string | null },
        fn: () => Promise<T>,
    ): Promise<T> {
        return localeContext.run(ctx, fn);
    }

    public getContext(): { guildId?: string | null; locale?: string | null } | undefined {
        return localeContext.getStore();
    }

    public async init(cfg?: { engine?: string | null; alias?: string | null }): Promise<void> {
        const features = readFeatures();
        if (!features.guildLocaleEnabled && !features.guildLangFilesEnabled) {
            this.ready = true;
            log.info('GuildLocale idle (guildLocale and guildLangFiles both disabled).');
            return;
        }

        try {
            const resolved = resolveCoreDataBackend(cfg ?? undefined);
            let engine: DataEngine;
            let alias: string;
            if (
                resolved.engine === 'sqlite' ||
                resolved.engine === 'postgres' ||
                resolved.engine === 'mongo'
            ) {
                engine = resolved.engine;
                alias = resolved.alias;
            } else {
                const fallback = resolveBackend({
                    configEngine: null,
                    configAlias: resolved.alias,
                    envEngineKey: 'GuildLocaleEngine',
                    envAliasKey: 'GuildLocaleDbAlias',
                    defaultAlias: resolved.alias,
                });
                engine = fallback.engine;
                alias = fallback.alias;
            }
            this.engine = engine;
            this.alias = alias;

            if (this.engine === 'postgres') {
                const { pgDB } = await import('#core/database/postgres.js');
                this.pgPool = pgDB.get(this.alias) as PgPool;
            } else if (this.engine === 'mongo') {
                const { mongoDB } = await import('#core/database/mongo.js');
                const conn = mongoDB.get(this.alias) as {
                    collection?: (n: string) => MongoCol;
                    db?: { collection: (n: string) => MongoCol };
                };
                this.mongo =
                    typeof conn.collection === 'function'
                        ? conn.collection('guild_locale')
                        : conn.db!.collection('guild_locale');
            } else {
                this.sqlite = sqliteDB.get(this.alias) as SqliteDb;
            }

            await this.warmCache();
            this.ready = true;
            log.info(`GuildLocale ready (engine=${this.engine}, alias=${this.alias}).`);
        } catch (err) {
            this.ready = false;
            log.warn(`GuildLocale init soft-failed: ${(err as Error).message}. Using DefaultLocale only.`);
        }
    }

    private async warmCache(): Promise<void> {
        this.cache.clearPresence();
        this.localeByGuild.clear();
        const keys: string[] = [];
        if (this.engine === 'sqlite' && this.sqlite) {
            for (const row of this.sqlite.prepare(`SELECT guild_id, locale FROM guild_locale`).all()) {
                const id = String(row.guild_id);
                const loc = String(row.locale);
                keys.push(`g:${id}`);
                this.localeByGuild.set(id, loc);
                void this.cache.set(`loc:${id}`, loc);
            }
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(`SELECT guild_id, locale FROM guild_locale`);
            for (const row of r.rows) {
                const id = String(row.guild_id);
                const loc = String(row.locale);
                keys.push(`g:${id}`);
                this.localeByGuild.set(id, loc);
                void this.cache.set(`loc:${id}`, loc);
            }
        } else if (this.mongo) {
            const rows = await this.mongo.find({}).project({ guild_id: 1, locale: 1 }).toArray();
            for (const row of rows) {
                const id = String(row.guild_id ?? '');
                const loc = String(row.locale ?? 'en');
                keys.push(`g:${id}`);
                this.localeByGuild.set(id, loc);
                void this.cache.set(`loc:${id}`, loc);
            }
        }
        this.cache.loadPresence(keys);
    }

    public resolveLocale(guildId?: string | null, explicitLocale?: string | null): string {
        const features = readFeatures();
        const master = masterLocale();

        if (explicitLocale && explicitLocale.length > 0) {
            return explicitLocale;
        }

        const ctx = localeContext.getStore();
        if (ctx?.locale) return ctx.locale;

        if (!features.guildLocaleEnabled) {
            return master;
        }

        const gid = guildId ?? ctx?.guildId ?? null;
        if (!gid || !this.ready) return master;

        return this.peekCachedLocale(gid) ?? master;
    }

    private peekCachedLocale(guildId: string): string | null {
        return this.localeByGuild.get(guildId) ?? null;
    }

    public async getGuildLocale(guildId: string): Promise<string | null> {
        const features = readFeatures();
        if (!features.guildLocaleEnabled || !this.ready) return null;

        const cached = await this.cache.get(`loc:${guildId}`);
        if (cached) return cached;

        if (this.engine === 'sqlite' && this.sqlite) {
            const row = this.sqlite.prepare(`SELECT locale FROM guild_locale WHERE guild_id = ?`).get(guildId);
            if (row?.locale) {
                const loc = String(row.locale);
                this.localeByGuild.set(guildId, loc);
                void this.cache.set(`loc:${guildId}`, loc);
                this.cache.setPresence(`g:${guildId}`);
                return loc;
            }
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(`SELECT locale FROM guild_locale WHERE guild_id = $1`, [guildId]);
            if (r.rows[0]?.locale) {
                const loc = String(r.rows[0].locale);
                this.localeByGuild.set(guildId, loc);
                void this.cache.set(`loc:${guildId}`, loc);
                this.cache.setPresence(`g:${guildId}`);
                return loc;
            }
        } else if (this.mongo) {
            const rows = await this.mongo.find({ guild_id: guildId }).project({ locale: 1 }).toArray();
            if (rows[0]?.locale) {
                const loc = String(rows[0].locale);
                this.localeByGuild.set(guildId, loc);
                void this.cache.set(`loc:${guildId}`, loc);
                this.cache.setPresence(`g:${guildId}`);
                return loc;
            }
        }
        return null;
    }

    public async setGuildLocale(guildId: string, locale: string, updatedBy?: string): Promise<void> {
        const features = readFeatures();
        if (!features.guildLocaleEnabled) {
            throw new Error('Guild locale picks are disabled in core config.');
        }
        if (!this.ready) throw new Error('GuildLocale is not ready.');

        const at = Math.floor(Date.now() / 1000);
        const by = updatedBy ?? null;
        if (this.engine === 'sqlite' && this.sqlite) {
            this.sqlite
                .prepare(
                    `INSERT INTO guild_locale (guild_id, locale, updated_at, updated_by) VALUES (?, ?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
                )
                .run(guildId, locale, at, by);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO guild_locale (guild_id, locale, updated_at, updated_by) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guild_id) DO UPDATE SET locale = EXCLUDED.locale, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
                [guildId, locale, at, by],
            );
        } else if (this.mongo) {
            await this.mongo.updateOne(
                { guild_id: guildId },
                { $set: { guild_id: guildId, locale, updated_at: at, updated_by: by } },
                { upsert: true },
            );
        }
        this.localeByGuild.set(guildId, locale);
        void this.cache.set(`loc:${guildId}`, locale);
        this.cache.setPresence(`g:${guildId}`);
    }


    public async setGuildLocaleValidated(
        guildId: string,
        locale: string,
        updatedBy?: string,
    ): Promise<{ ok: true; locale: string } | { ok: false; error: string }> {
        const features = readFeatures();
        if (!features.guildLocaleEnabled) {
            return { ok: false, error: 'Guild locale picks are disabled in core config (guildLocale.enabled=false).' };
        }
        if (!this.ready) {
            return { ok: false, error: 'GuildLocale manager is not ready.' };
        }

        const normalized = locale.trim().toLowerCase();
        if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(normalized)) {
            return { ok: false, error: `Invalid locale code: ${locale}` };
        }

        try {
            const { i18n } = await import('#core/manager/lang.js');
            const failures = i18n.getLangValidationFailures();
            for (const [pluginId, files] of failures.entries()) {
                const hit = files.some((f) => f.includes(`_${normalized}`) || f.endsWith(`_${normalized}.json5`));
                if (hit) {
                    return {
                        ok: false,
                        error: `Locale "${normalized}" failed lang schema/rules for plugin "${pluginId}" (${files.join(', ')}).`,
                    };
                }
            }

            const raw = i18n.getRaw('core', normalized);
            if (raw == null && normalized !== (secrets.getOptional('DefaultLocale') || 'en')) {
                const en = i18n.getRaw('core', 'en');
                if (en == null) {
                    return { ok: false, error: `No language pack loaded for locale "${normalized}" and default en is missing.` };
                }
            }
        } catch (err) {
            return { ok: false, error: `Lang validation path failed: ${(err as Error).message}` };
        }

        try {
            await this.setGuildLocale(guildId, normalized, updatedBy);
            return { ok: true, locale: normalized };
        } catch (err) {
            return { ok: false, error: (err as Error).message };
        }
    }

    public shouldUseGuildLangFiles(): boolean {
        return readFeatures().guildLangFilesEnabled;
    }
}

export const guildLocale = new GuildLocaleManager();
