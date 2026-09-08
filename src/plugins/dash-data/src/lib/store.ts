import { type IHeart } from '#core/heart/index.js';
import { resolveDashboardBackend } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter, type Row } from '#core/database/sqlAdapter.js';

let adapter: SqlAdapter | null = null;

export async function ensureDashboardAdapter(): Promise<SqlAdapter> {
    if (adapter) return adapter;
    adapter = openSqlAdapter(resolveDashboardBackend());
    return adapter;
}

export function getDashboardAdapter(): SqlAdapter {
    if (!adapter) {
        adapter = openSqlAdapter(resolveDashboardBackend());
    }
    return adapter;
}

export async function initSchema(_heart: IHeart): Promise<void> {
    await ensureDashboardAdapter();
}

export async function dashGet(sql: string, params: unknown[] = []): Promise<Row | null> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        throw new Error('dashGet is SQL-only; use dashMongo helpers');
    }
    return db.get(sql, params);
}

export async function dashAll(sql: string, params: unknown[] = []): Promise<Row[]> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        throw new Error('dashAll is SQL-only; use dashMongo helpers');
    }
    return db.all(sql, params);
}

export async function dashRun(sql: string, params: unknown[] = []): Promise<void> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        throw new Error('dashRun is SQL-only; use dashMongo helpers');
    }
    await db.run(sql, params);
}

export async function dashMongo(name: string) {
    const db = await ensureDashboardAdapter();
    if (db.engine !== 'mongo') {
        throw new Error('dashMongo requires mongo engine');
    }
    return db.mongoCollection(name);
}

export async function isGloballyBanned(_heart: IHeart, userId: string): Promise<boolean> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_global_member_bans').findOne({
            $or: [{ userId }, { _id: userId }],
        });
        return !!row;
    }
    const row = await db.get(`SELECT userId FROM dash_global_member_bans WHERE userId = ?`, [userId]);
    return !!row;
}

export async function banGlobal(
    _heart: IHeart,
    userId: string,
    reason: string | undefined,
    bannedBy: string,
): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_global_member_bans').updateOne(
            { _id: userId },
            {
                $set: {
                    _id: userId,
                    userId,
                    reason: reason ?? null,
                    bannedBy,
                    bannedAt: at,
                },
            },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_global_member_bans (userId, reason, bannedBy, bannedAt)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (userId) DO UPDATE SET reason = EXCLUDED.reason, bannedBy = EXCLUDED.bannedBy, bannedAt = EXCLUDED.bannedAt`,
            [userId, reason ?? null, bannedBy, at],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_global_member_bans (userId, reason, bannedBy, bannedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET reason = excluded.reason, bannedBy = excluded.bannedBy, bannedAt = excluded.bannedAt`,
        [userId, reason ?? null, bannedBy, at],
    );
}

export async function unbanGlobal(_heart: IHeart, userId: string): Promise<void> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_global_member_bans').deleteOne({
            $or: [{ _id: userId }, { userId }],
        });
        return;
    }
    await db.run(`DELETE FROM dash_global_member_bans WHERE userId = ?`, [userId]);
}

export async function getServerPluginConfig(
    _heart: IHeart,
    guildId: string,
    pluginId: string,
): Promise<Record<string, unknown>> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_server_plugin_config').findOne({ guildId, pluginId });
        if (!row) return {};
        const raw = row.config;
        if (typeof raw === 'string') return JSON.parse(raw) as Record<string, unknown>;
        if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
        return {};
    }
    const row = await db.get(
        `SELECT config FROM dash_server_plugin_config WHERE guildId = ? AND pluginId = ?`,
        [guildId, pluginId],
    );
    return row ? (JSON.parse(String(row.config)) as Record<string, unknown>) : {};
}

export async function setServerPluginConfig(
    _heart: IHeart,
    guildId: string,
    pluginId: string,
    config: Record<string, unknown>,
): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    const payload = JSON.stringify(config);
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_server_plugin_config').updateOne(
            { guildId, pluginId },
            {
                $set: {
                    guildId,
                    pluginId,
                    config: payload,
                    updatedAt: at,
                },
            },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_server_plugin_config (guildId, pluginId, config, updatedAt) VALUES (?, ?, ?, ?)
             ON CONFLICT (guildId, pluginId) DO UPDATE SET config = EXCLUDED.config, updatedAt = EXCLUDED.updatedAt`,
            [guildId, pluginId, payload, at],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_server_plugin_config (guildId, pluginId, config, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, pluginId) DO UPDATE SET config = excluded.config, updatedAt = excluded.updatedAt`,
        [guildId, pluginId, payload, at],
    );
}

/** Document shape used by dashboard routes (former NovaDB docs). */
export type DashDoc = Record<string, unknown> & { _id?: string };

/**
 * Surreal-backed collection with the NovaCollection surface used by dashboard routes:
 * `upsert`, `get`, `delete`, async `scan(start, end)`.
 *
 * Each logical document is a Surreal record `table:⟨key⟩` plus a string `key` field
 * for range scans (prefix queries on former Nova `_id` values).
 */
export class SurrealDocCollection {
    public constructor(
        private readonly db: import('surrealdb').Surreal,
        private readonly table: string,
    ) {}

    public async upsert(doc: DashDoc): Promise<string> {
        const key = String(doc._id ?? newId('doc'));
        if (doc.__deleted__ === true) {
            await this.delete(key);
            return key;
        }

        const data: Record<string, unknown> = { key };
        for (const [k, v] of Object.entries(doc)) {
            if (k === '_id' || k.startsWith('__')) continue;
            data[k] = v;
        }

        await this.db.query(
            'UPSERT type::thing($table, $key) CONTENT $data RETURN NONE',
            { table: this.table, key, data },
        );
        return key;
    }

    public async get(id: string): Promise<DashDoc | null> {
        const result = await this.db.query<[DashDoc[]]>(
            'SELECT * FROM ONLY type::thing($table, $key)',
            { table: this.table, key: id },
        );
        const row = unwrapQueryRow(result);
        if (!row || typeof row !== 'object') return null;
        return normalizeDoc(row as Record<string, unknown>, id);
    }

    public async delete(id: string): Promise<boolean> {
        await this.db.query('DELETE type::thing($table, $key) RETURN NONE', {
            table: this.table,
            key: id,
        });
        return true;
    }

    public async *scan(start: string, end: string): AsyncGenerator<DashDoc> {
        const result = await this.db.query<[DashDoc[]]>(
            `SELECT * FROM type::table($table)
             WHERE key >= $start AND key <= $end
             ORDER BY key ASC`,
            { table: this.table, start, end },
        );
        const rows = unwrapQueryList(result);
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            const rec = row as Record<string, unknown>;
            const key = typeof rec.key === 'string' ? rec.key : extractRecordKey(rec);
            if (key === null) continue;
            yield normalizeDoc(rec, key);
        }
    }
}

function unwrapQueryRow(result: unknown): unknown {
    if (!Array.isArray(result) || result.length === 0) return null;
    const first = result[0];
    if (Array.isArray(first)) return first[0] ?? null;
    return first ?? null;
}

function unwrapQueryList(result: unknown): unknown[] {
    if (!Array.isArray(result) || result.length === 0) return [];
    const first = result[0];
    if (Array.isArray(first)) return first;
    if (first && typeof first === 'object') return [first];
    return [];
}

function extractRecordKey(row: Record<string, unknown>): string | null {
    const id = row.id;
    if (typeof id === 'string') {
        const idx = id.indexOf(':');
        return idx >= 0 ? id.slice(idx + 1).replace(/^⟨|⟩$/g, '') : id;
    }
    if (id && typeof id === 'object' && 'id' in id) {
        return String((id as { id: unknown }).id);
    }
    return null;
}

function normalizeDoc(row: Record<string, unknown>, key: string): DashDoc {
    const out: DashDoc = { _id: key };
    for (const [k, v] of Object.entries(row)) {
        if (k === 'id' || k === 'key') continue;
        out[k] = v;
    }
    return out;
}

function surrealMain(heart: IHeart): import('surrealdb').Surreal {
    return heart.db.surreal.get('main');
}

export async function infractionsCollection(heart: IHeart): Promise<SurrealDocCollection> {
    return new SurrealDocCollection(surrealMain(heart), 'dash_infractions');
}

export async function auditCollection(heart: IHeart): Promise<SurrealDocCollection> {
    return new SurrealDocCollection(surrealMain(heart), 'dash_audit_log');
}

export async function cmdCounterCollection(heart: IHeart): Promise<SurrealDocCollection> {
    return new SurrealDocCollection(surrealMain(heart), 'dash_command_counters');
}

export async function writeAudit(
    heart: IHeart,
    entry: {
        actorId: string;
        action: string;
        target?: string;
        guildId?: string | null;
        meta?: Record<string, unknown>;
    },
): Promise<void> {
    const col = await auditCollection(heart);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    await col.upsert({
        _id: `log_${entry.guildId ?? 'global'}_${ts}_${rand}`,
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target ?? null,
        guildId: entry.guildId ?? null,
        meta: entry.meta ?? {},
        createdAt: ts,
    });
}

export const GLOBAL_BAN_SENTINEL = 'global';

export function newId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function kvGet(ns: string, key: string): Promise<unknown | null> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_kv').findOne({ ns, key });
        if (!row) return null;
        const raw = row.value;
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw) as unknown;
            } catch {
                return raw;
            }
        }
        return raw ?? null;
    }
    const row = await db.get(`SELECT value FROM dash_kv WHERE ns = ? AND key = ?`, [ns, key]);
    if (!row) return null;
    try {
        return JSON.parse(String(row.value)) as unknown;
    } catch {
        return row.value;
    }
}

export async function kvSet(ns: string, key: string, value: unknown): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    const payload = JSON.stringify(value ?? null);
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_kv').updateOne(
            { ns, key },
            { $set: { ns, key, value: payload, updatedAt: at } },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_kv (ns, key, value, updatedAt) VALUES (?, ?, ?, ?)
             ON CONFLICT (ns, key) DO UPDATE SET value = EXCLUDED.value, updatedAt = EXCLUDED.updatedAt`,
            [ns, key, payload, at],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_kv (ns, key, value, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        [ns, key, payload, at],
    );
}

export async function kvDel(ns: string, key: string): Promise<void> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_kv').deleteOne({ ns, key });
        return;
    }
    await db.run(`DELETE FROM dash_kv WHERE ns = ? AND key = ?`, [ns, key]);
}

export type LayoutScope =
    | 'public_landing'
    | 'global_shell'
    | 'owner_home'
    | 'server_default'
    | 'server_guild';

export interface DashLayoutDoc {
    id: string;
    scope: LayoutScope;
    guildId?: string | null;
    name: string;
    version: number;
    schemaVersion: number;
    grid: Record<string, unknown>;
    navOrder?: string[] | null;
    themeOverrideId?: string | null;
    updatedAt: number;
    updatedBy: string;
}

function rowToLayout(row: Record<string, unknown>): DashLayoutDoc {
    let grid: Record<string, unknown> = {};
    const rawGrid = row.grid;
    if (typeof rawGrid === 'string') {
        try {
            grid = JSON.parse(rawGrid) as Record<string, unknown>;
        } catch {
            grid = {};
        }
    } else if (rawGrid && typeof rawGrid === 'object') {
        grid = rawGrid as Record<string, unknown>;
    }
    let navOrder: string[] | null = null;
    const rawNav = row.navOrder;
    if (typeof rawNav === 'string' && rawNav.length) {
        try {
            const parsed: unknown = JSON.parse(rawNav);
            if (Array.isArray(parsed)) navOrder = parsed.map(String);
        } catch {
            navOrder = null;
        }
    }
    return {
        id: String(row.id),
        scope: String(row.scope) as LayoutScope,
        guildId: row.guildId == null ? null : String(row.guildId),
        name: String(row.name ?? ''),
        version: Number(row.version ?? 1),
        schemaVersion: Number(row.schemaVersion ?? 1),
        grid,
        navOrder,
        themeOverrideId: row.themeOverrideId == null ? null : String(row.themeOverrideId),
        updatedAt: Number(row.updatedAt ?? 0),
        updatedBy: String(row.updatedBy ?? ''),
    };
}

export async function getLayout(scope: LayoutScope, guildId?: string): Promise<DashLayoutDoc | null> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const q: Record<string, unknown> = { scope };
        if (guildId) q.guildId = guildId;
        else q.guildId = null;
        const row = await db.mongoCollection('dash_layouts').findOne(q);
        if (!row) return null;
        return rowToLayout(row as Record<string, unknown>);
    }
    if (guildId) {
        const row = await db.get(
            `SELECT * FROM dash_layouts WHERE scope = ? AND guildId = ? LIMIT 1`,
            [scope, guildId],
        );
        return row ? rowToLayout(row as Record<string, unknown>) : null;
    }
    const row = await db.get(
        `SELECT * FROM dash_layouts WHERE scope = ? AND (guildId IS NULL OR guildId = '') LIMIT 1`,
        [scope],
    );
    return row ? rowToLayout(row as Record<string, unknown>) : null;
}

export async function putLayout(doc: DashLayoutDoc): Promise<void> {
    const db = await ensureDashboardAdapter();
    const grid = JSON.stringify(doc.grid ?? {});
    const navOrder = doc.navOrder ? JSON.stringify(doc.navOrder) : null;
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_layouts').updateOne(
            { id: doc.id },
            {
                $set: {
                    id: doc.id,
                    scope: doc.scope,
                    guildId: doc.guildId ?? null,
                    name: doc.name,
                    version: doc.version,
                    schemaVersion: doc.schemaVersion,
                    grid,
                    navOrder,
                    themeOverrideId: doc.themeOverrideId ?? null,
                    updatedAt: doc.updatedAt,
                    updatedBy: doc.updatedBy,
                },
            },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_layouts
                (id, scope, guildId, name, version, schemaVersion, grid, navOrder, themeOverrideId, updatedAt, updatedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
                scope = EXCLUDED.scope,
                guildId = EXCLUDED.guildId,
                name = EXCLUDED.name,
                version = EXCLUDED.version,
                schemaVersion = EXCLUDED.schemaVersion,
                grid = EXCLUDED.grid,
                navOrder = EXCLUDED.navOrder,
                themeOverrideId = EXCLUDED.themeOverrideId,
                updatedAt = EXCLUDED.updatedAt,
                updatedBy = EXCLUDED.updatedBy`,
            [
                doc.id,
                doc.scope,
                doc.guildId ?? null,
                doc.name,
                doc.version,
                doc.schemaVersion,
                grid,
                navOrder,
                doc.themeOverrideId ?? null,
                doc.updatedAt,
                doc.updatedBy,
            ],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_layouts
            (id, scope, guildId, name, version, schemaVersion, grid, navOrder, themeOverrideId, updatedAt, updatedBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            scope = excluded.scope,
            guildId = excluded.guildId,
            name = excluded.name,
            version = excluded.version,
            schemaVersion = excluded.schemaVersion,
            grid = excluded.grid,
            navOrder = excluded.navOrder,
            themeOverrideId = excluded.themeOverrideId,
            updatedAt = excluded.updatedAt,
            updatedBy = excluded.updatedBy`,
        [
            doc.id,
            doc.scope,
            doc.guildId ?? null,
            doc.name,
            doc.version,
            doc.schemaVersion,
            grid,
            navOrder,
            doc.themeOverrideId ?? null,
            doc.updatedAt,
            doc.updatedBy,
        ],
    );
}

export async function getTheme(): Promise<{ tokens: Record<string, unknown>; updatedAt: number }> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_theme').findOne({
            $or: [{ id: 'current' }, { _id: 'current' }],
        });
        if (!row) return { tokens: {}, updatedAt: 0 };
        const raw = row.tokens;
        const tokens =
            typeof raw === 'string'
                ? (JSON.parse(raw) as Record<string, unknown>)
                : ((raw as Record<string, unknown>) ?? {});
        return { tokens, updatedAt: Number(row.updatedAt ?? 0) };
    }
    const row = await db.get(`SELECT tokens, updatedAt FROM dash_theme WHERE id = 'current'`);
    if (!row) return { tokens: {}, updatedAt: 0 };
    return {
        tokens: JSON.parse(String(row.tokens)) as Record<string, unknown>,
        updatedAt: Number(row.updatedAt ?? 0),
    };
}

export async function putTheme(tokens: Record<string, unknown>): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    const payload = JSON.stringify(tokens);
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_theme').updateOne(
            { id: 'current' },
            { $set: { id: 'current', tokens: payload, updatedAt: at } },
            { upsert: true },
        );
        return;
    }
    await db.run(`UPDATE dash_theme SET tokens = ?, updatedAt = ? WHERE id = 'current'`, [payload, at]);
}

export async function getSurfaceFlag(
    pluginId: string,
    surfaceId: string,
): Promise<{ enabled: boolean; updatedAt: number } | null> {
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('dash_surface_flags').findOne({ pluginId, surfaceId });
        if (!row) return null;
        return { enabled: row.enabled !== false && row.enabled !== 0, updatedAt: Number(row.updatedAt ?? 0) };
    }
    const row = await db.get(
        `SELECT enabled, updatedAt FROM dash_surface_flags WHERE pluginId = ? AND surfaceId = ?`,
        [pluginId, surfaceId],
    );
    if (!row) return null;
    return { enabled: Number(row.enabled) !== 0, updatedAt: Number(row.updatedAt ?? 0) };
}

export async function setSurfaceFlag(
    pluginId: string,
    surfaceId: string,
    enabled: boolean,
    updatedBy?: string,
): Promise<void> {
    const db = await ensureDashboardAdapter();
    const at = Date.now();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_surface_flags').updateOne(
            { pluginId, surfaceId },
            { $set: { pluginId, surfaceId, enabled, updatedAt: at, updatedBy: updatedBy ?? null } },
            { upsert: true },
        );
        return;
    }
    if (db.engine === 'postgres') {
        await db.run(
            `INSERT INTO dash_surface_flags (pluginId, surfaceId, enabled, updatedAt, updatedBy)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (pluginId, surfaceId) DO UPDATE SET
                enabled = EXCLUDED.enabled, updatedAt = EXCLUDED.updatedAt, updatedBy = EXCLUDED.updatedBy`,
            [pluginId, surfaceId, enabled ? 1 : 0, at, updatedBy ?? null],
        );
        return;
    }
    await db.run(
        `INSERT INTO dash_surface_flags (pluginId, surfaceId, enabled, updatedAt, updatedBy)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pluginId, surfaceId) DO UPDATE SET
            enabled = excluded.enabled, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`,
        [pluginId, surfaceId, enabled ? 1 : 0, at, updatedBy ?? null],
    );
}

export function resetDashDataAdapterCache(): void {
    adapter = null;
}

export interface DashModerationAction {
    id: string;
    action: string;
    actorId: string;
    targetUserId: string;
    guildId: string | null;
    reason: string | null;
    outcome: string;
    detail: string | null;
    createdAt: number;
}

export async function recordModerationAction(entry: {
    action: string;
    actorId: string;
    targetUserId: string;
    guildId?: string | null;
    reason?: string | null;
    outcome?: string;
    detail?: string | null;
}): Promise<DashModerationAction> {
    const id = newId('mod');
    const createdAt = Date.now();
    const row: DashModerationAction = {
        id,
        action: entry.action,
        actorId: entry.actorId,
        targetUserId: entry.targetUserId,
        guildId: entry.guildId ?? null,
        reason: entry.reason ?? null,
        outcome: entry.outcome ?? 'success',
        detail: entry.detail ?? null,
        createdAt,
    };
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        await db.mongoCollection('dash_moderation_actions').insertOne({
            _id: row.id,
            ...row,
        });
        return row;
    }
    await db.run(
        `INSERT INTO dash_moderation_actions
         (id, action, actorId, targetUserId, guildId, reason, outcome, detail, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            row.id,
            row.action,
            row.actorId,
            row.targetUserId,
            row.guildId,
            row.reason,
            row.outcome,
            row.detail,
            row.createdAt,
        ],
    );
    return row;
}

export async function listModerationActions(opts?: {
    actorId?: string;
    targetUserId?: string;
    guildId?: string;
    limit?: number;
}): Promise<DashModerationAction[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 500);
    const db = await ensureDashboardAdapter();
    if (db.engine === 'mongo') {
        const q: Record<string, string> = {};
        if (opts?.actorId) q.actorId = opts.actorId;
        if (opts?.targetUserId) q.targetUserId = opts.targetUserId;
        if (opts?.guildId) q.guildId = opts.guildId;
        const rows = await db.mongoCollection('dash_moderation_actions').find(q);
        return rows
            .map((r) => ({
                id: String(r.id ?? r._id),
                action: String(r.action),
                actorId: String(r.actorId),
                targetUserId: String(r.targetUserId),
                guildId: r.guildId != null ? String(r.guildId) : null,
                reason: r.reason != null ? String(r.reason) : null,
                outcome: String(r.outcome ?? 'success'),
                detail: r.detail != null ? String(r.detail) : null,
                createdAt: Number(r.createdAt),
            }))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.actorId) {
        clauses.push('actorId = ?');
        params.push(opts.actorId);
    }
    if (opts?.targetUserId) {
        clauses.push('targetUserId = ?');
        params.push(opts.targetUserId);
    }
    if (opts?.guildId) {
        clauses.push('guildId = ?');
        params.push(opts.guildId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = await db.all(
        `SELECT * FROM dash_moderation_actions ${where} ORDER BY createdAt DESC LIMIT ?`,
        params,
    );
    return rows.map((r) => ({
        id: String(r.id),
        action: String(r.action),
        actorId: String(r.actorId),
        targetUserId: String(r.targetUserId),
        guildId: r.guildId != null ? String(r.guildId) : null,
        reason: r.reason != null ? String(r.reason) : null,
        outcome: String(r.outcome ?? 'success'),
        detail: r.detail != null ? String(r.detail) : null,
        createdAt: Number(r.createdAt),
    }));
}
