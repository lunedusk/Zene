import { getLogger } from '#core/utils/logger.js';
import { sqliteDB } from '#core/database/sqlite.js';
import { cacheFacade } from '#core/manager/cacheFacade.js';
import { resolveCoreDataBackend, resolveBackend, type DataEngine } from '#core/database/backendSelector.js';
import { configManager } from '#core/manager/config.js';
import { secrets } from '#core/helpers/secretManager.js';

const log = getLogger('GuildAccess');

export type AccessListKind = 'blacklist' | 'whitelist';

export interface GuildAccessRow {
    guildId: string;
    reason: string | null;
    updatedAt: number;
    updatedBy: string | null;
}

export interface GuildAccessPolicy {
    enabled: boolean;
    conflictPriority: 'blacklist' | 'whitelist';
    emptyWhitelistMeans: 'allow_all' | 'deny_all';
    leaveOnBoot: boolean;
    leaveOnJoin: boolean;
    allowOwner: boolean;
    leaveReason: string;
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
        sort(spec: object): { toArray(): Promise<Record<string, unknown>[]> };
        toArray(): Promise<Record<string, unknown>[]>;
    };
    updateOne(filter: object, update: object, opts?: { upsert?: boolean }): Promise<unknown>;
    deleteOne(filter: object): Promise<{ deletedCount?: number }>;
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function readPolicy(): GuildAccessPolicy {
    try {
        const core = configManager.get<{
            guildAccess?: Partial<GuildAccessPolicy>;
        }>('core');
        const g = core?.guildAccess ?? {};
        return {
            enabled: g.enabled !== false,
            conflictPriority: g.conflictPriority === 'whitelist' ? 'whitelist' : 'blacklist',
            emptyWhitelistMeans: g.emptyWhitelistMeans === 'deny_all' ? 'deny_all' : 'allow_all',
            leaveOnBoot: g.leaveOnBoot !== false,
            leaveOnJoin: g.leaveOnJoin !== false,
            allowOwner: g.allowOwner !== false,
            leaveReason:
                typeof g.leaveReason === 'string' && g.leaveReason.length > 0
                    ? g.leaveReason
                    : 'Guild is not allowed by bot access policy.',
        };
    } catch {
        return {
            enabled: true,
            conflictPriority: 'blacklist',
            emptyWhitelistMeans: 'allow_all',
            leaveOnBoot: true,
            leaveOnJoin: true,
            allowOwner: true,
            leaveReason: 'Guild is not allowed by bot access policy.',
        };
    }
}

export class GuildAccessManager {
    private ready = false;
    private engine: DataEngine = 'sqlite';
    private alias = 'main';
    private sqlite: SqliteDb | null = null;
    private pgPool: PgPool | null = null;
    private mongoBlack: MongoCol | null = null;
    private mongoWhite: MongoCol | null = null;
    private mongoOwner: MongoCol | null = null;
    private readonly presence = cacheFacade.namespace('guildAccess');
    private whitelistCount = 0;

    public isReady(): boolean {
        return this.ready;
    }

    public getPolicy(): GuildAccessPolicy {
        return readPolicy();
    }

    public async init(cfg?: { engine?: string | null; alias?: string | null }): Promise<void> {
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
                envEngineKey: 'GuildAccessEngine',
                envAliasKey: 'GuildAccessDbAlias',
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
            const getCol = (name: string): MongoCol => {
                if (typeof conn.collection === 'function') return conn.collection(name);
                if (conn.db) return conn.db.collection(name);
                throw new Error('GuildAccess: mongo connection has no collection()');
            };
            this.mongoBlack = getCol('guild_access_blacklist');
            this.mongoWhite = getCol('guild_access_whitelist');
            this.mongoOwner = getCol('guild_access_owner_authorized');
        } else {
            this.sqlite = sqliteDB.get(this.alias) as SqliteDb;
        }

        await this.warmCache();
        this.ready = true;
        log.info(`GuildAccess ready (engine=${this.engine}, alias=${this.alias}).`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('guildaccess.ready', { engine: this.engine, alias: this.alias }),
            )
            .catch(() => undefined);
    }

    private async warmCache(): Promise<void> {
        this.presence.clearPresence();
        const keys: string[] = [];
        const addRows = (prefix: string, rows: Record<string, unknown>[], field: string) => {
            for (const row of rows) keys.push(`${prefix}:${String(row[field])}`);
        };

        if (this.engine === 'sqlite' && this.sqlite) {
            addRows('b', this.sqlite.prepare(`SELECT guild_id FROM guild_access_blacklist`).all(), 'guild_id');
            addRows('w', this.sqlite.prepare(`SELECT guild_id FROM guild_access_whitelist`).all(), 'guild_id');
            addRows('o', this.sqlite.prepare(`SELECT guild_id FROM guild_access_owner_authorized`).all(), 'guild_id');
        } else if (this.engine === 'postgres' && this.pgPool) {
            addRows('b', (await this.pgPool.query(`SELECT guild_id FROM guild_access_blacklist`)).rows, 'guild_id');
            addRows('w', (await this.pgPool.query(`SELECT guild_id FROM guild_access_whitelist`)).rows, 'guild_id');
            addRows('o', (await this.pgPool.query(`SELECT guild_id FROM guild_access_owner_authorized`)).rows, 'guild_id');
        } else if (this.mongoBlack && this.mongoWhite && this.mongoOwner) {
            addRows('b', await this.mongoBlack.find({}).project({ guild_id: 1 }).toArray(), 'guild_id');
            addRows('w', await this.mongoWhite.find({}).project({ guild_id: 1 }).toArray(), 'guild_id');
            addRows('o', await this.mongoOwner.find({}).project({ guild_id: 1 }).toArray(), 'guild_id');
        }
        this.presence.loadPresence(keys);
        this.whitelistCount = keys.filter((k) => k.startsWith('w:')).length;
    }

    public isOnBlacklist(guildId: string): boolean {
        return this.ready && this.presence.hasPresence(`b:${guildId}`);
    }

    public isOnWhitelist(guildId: string): boolean {
        return this.ready && this.presence.hasPresence(`w:${guildId}`);
    }

    public isOwnerAuthorized(guildId: string): boolean {
        return this.ready && this.presence.hasPresence(`o:${guildId}`);
    }

    public isGuildAllowed(guildId: string | null | undefined): boolean {
        if (!guildId) return true;
        const policy = readPolicy();
        if (!policy.enabled || !this.ready) return true;

        if (policy.allowOwner && this.isOwnerAuthorized(guildId)) return true;

        const onBlack = this.isOnBlacklist(guildId);
        const onWhite = this.isOnWhitelist(guildId);

        if (onBlack && onWhite) {
            return policy.conflictPriority === 'whitelist';
        }
        if (onBlack) return false;
        if (onWhite) return true;

        if (this.whitelistCount > 0) return false;
        return policy.emptyWhitelistMeans === 'allow_all';
    }

    public async addToList(
        kind: AccessListKind,
        guildId: string,
        updatedBy?: string,
        reason?: string | null,
    ): Promise<void> {
        const table = kind === 'blacklist' ? 'guild_access_blacklist' : 'guild_access_whitelist';
        const prefix = kind === 'blacklist' ? 'b' : 'w';
        const at = nowSeconds();
        const by = updatedBy ?? null;
        const why = reason ?? null;

        if (this.engine === 'sqlite' && this.sqlite) {
            this.sqlite
                .prepare(
                    `INSERT INTO ${table} (guild_id, reason, updated_at, updated_by) VALUES (?, ?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
                )
                .run(guildId, why, at, by);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO ${table} (guild_id, reason, updated_at, updated_by) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guild_id) DO UPDATE SET reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
                [guildId, why, at, by],
            );
        } else if (kind === 'blacklist' && this.mongoBlack) {
            await this.mongoBlack.updateOne(
                { guild_id: guildId },
                { $set: { guild_id: guildId, reason: why, updated_at: at, updated_by: by } },
                { upsert: true },
            );
        } else if (kind === 'whitelist' && this.mongoWhite) {
            await this.mongoWhite.updateOne(
                { guild_id: guildId },
                { $set: { guild_id: guildId, reason: why, updated_at: at, updated_by: by } },
                { upsert: true },
            );
        }
        if (!this.presence.hasPresence(`${prefix}:${guildId}`)) {
            this.presence.setPresence(`${prefix}:${guildId}`);
            if (prefix === 'w') this.whitelistCount += 1;
        }
        await this.emitChanged(kind, guildId, 'add');
    }

    public async removeFromList(kind: AccessListKind, guildId: string): Promise<boolean> {
        const table = kind === 'blacklist' ? 'guild_access_blacklist' : 'guild_access_whitelist';
        const prefix = kind === 'blacklist' ? 'b' : 'w';
        let removed = false;

        if (this.engine === 'sqlite' && this.sqlite) {
            removed = this.sqlite.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId).changes > 0;
        } else if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(`DELETE FROM ${table} WHERE guild_id = $1`, [guildId]);
            removed = (r.rowCount ?? 0) > 0;
        } else if (kind === 'blacklist' && this.mongoBlack) {
            const r = await this.mongoBlack.deleteOne({ guild_id: guildId });
            removed = (r.deletedCount ?? 0) > 0;
        } else if (kind === 'whitelist' && this.mongoWhite) {
            const r = await this.mongoWhite.deleteOne({ guild_id: guildId });
            removed = (r.deletedCount ?? 0) > 0;
        }
        if (removed) {
            if (this.presence.hasPresence(`${prefix}:${guildId}`)) {
                this.presence.deletePresence(`${prefix}:${guildId}`);
                if (prefix === 'w') this.whitelistCount = Math.max(0, this.whitelistCount - 1);
            }
            await this.emitChanged(kind, guildId, 'remove');
        }
        return removed;
    }

    public async authorizeOwnerGuild(guildId: string, authorizedBy: string): Promise<void> {
        const at = nowSeconds();
        if (this.engine === 'sqlite' && this.sqlite) {
            this.sqlite
                .prepare(
                    `INSERT INTO guild_access_owner_authorized (guild_id, authorized_by, updated_at) VALUES (?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET authorized_by = excluded.authorized_by, updated_at = excluded.updated_at`,
                )
                .run(guildId, authorizedBy, at);
        } else if (this.engine === 'postgres' && this.pgPool) {
            await this.pgPool.query(
                `INSERT INTO guild_access_owner_authorized (guild_id, authorized_by, updated_at) VALUES ($1, $2, $3)
                 ON CONFLICT (guild_id) DO UPDATE SET authorized_by = EXCLUDED.authorized_by, updated_at = EXCLUDED.updated_at`,
                [guildId, authorizedBy, at],
            );
        } else if (this.mongoOwner) {
            await this.mongoOwner.updateOne(
                { guild_id: guildId },
                { $set: { guild_id: guildId, authorized_by: authorizedBy, updated_at: at } },
                { upsert: true },
            );
        }
        this.presence.setPresence(`o:${guildId}`);
        await this.emitChanged('owner', guildId, 'add');
    }

    public async list(kind: AccessListKind): Promise<GuildAccessRow[]> {
        const table = kind === 'blacklist' ? 'guild_access_blacklist' : 'guild_access_whitelist';
        if (this.engine === 'sqlite' && this.sqlite) {
            return this.sqlite
                .prepare(
                    `SELECT guild_id AS guildId, reason, updated_at AS updatedAt, updated_by AS updatedBy FROM ${table} ORDER BY updated_at DESC`,
                )
                .all() as unknown as GuildAccessRow[];
        }
        if (this.engine === 'postgres' && this.pgPool) {
            const r = await this.pgPool.query(
                `SELECT guild_id AS "guildId", reason, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM ${table} ORDER BY updated_at DESC`,
            );
            return r.rows as unknown as GuildAccessRow[];
        }
        const col = kind === 'blacklist' ? this.mongoBlack : this.mongoWhite;
        if (col) {
            const rows = await col.find({}).sort({ updated_at: -1 }).toArray();
            return rows.map((r) => ({
                guildId: String(r.guild_id ?? ''),
                reason: (r.reason as string | null) ?? null,
                updatedAt: Number(r.updated_at ?? 0),
                updatedBy: (r.updated_by as string | null) ?? null,
            }));
        }
        return [];
    }

    private async emitChanged(kind: string, guildId: string, action: string): Promise<void> {
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('guildaccess.changed', { kind, guildId, action }),
            )
            .catch(() => undefined);
        if (secrets.getBoolean('CROSS_HOST', false)) {
            void import('#core/database/redis.js')
                .then(async ({ redisDB }) => {
                    const clients =
                        redisDB.tryGet('crosshost') ??
                        redisDB.tryGet('main') ??
                        null;
                    const pub = clients?.pub;
                    if (!pub) return;
                    await pub.publish(
                        'zene:guildaccess:reevaluate',
                        JSON.stringify({ guildId, kind, action, at: Date.now() }),
                    );
                })
                .catch(() => undefined);
        }
    }
}

export const guildAccess = new GuildAccessManager();
