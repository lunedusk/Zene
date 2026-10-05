import { randomUUID } from 'node:crypto';
import { GatewayIntentBits, type Client, type GuildMember } from 'discord.js';
import type { SqlAdapter } from '#core/database/sqlAdapter.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('PermRoleLinks');

export type RoleLinkScope = 'bot' | 'server';
export type GrantSource = 'direct' | 'discord_role';

export interface RoleLinkDoc {
    readonly _id: string;
    readonly scope: RoleLinkScope;
    readonly guildId: string | null;
    readonly discordRoleId: string;
    readonly permRoleId: string;
    readonly createdAt: number;
    readonly createdBy: string;
}

export interface GrantDoc {
    readonly userId: string;
    readonly permRoleId: string;
    readonly guildId: string | null;
    readonly source: GrantSource;
    readonly discordRoleId: string | null;
    readonly createdAt: number;
}

export interface SyncSummary {
    readonly linkedRoles: number;
    readonly granted: number;
    readonly revoked: number;
    readonly skipped: number;
    readonly warnings: string[];
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function sqlTextKey(value: string | null | undefined): string {
    return value == null || value === '' ? '' : String(value);
}

function fromSqlTextKey(value: unknown): string | null {
    if (value == null) return null;
    const s = String(value);
    return s === '' ? null : s;
}

export function clientHasGuildMembersIntent(client: Client): boolean {
    try {
        const intents = client.options.intents;
        if (!intents) return false;
        if (typeof (intents as { has?: (b: number) => boolean }).has === 'function') {
            return (intents as { has: (b: number) => boolean }).has(GatewayIntentBits.GuildMembers);
        }
        const bitfield = BigInt(String(intents));
        return (bitfield & BigInt(GatewayIntentBits.GuildMembers)) !== 0n;
    } catch {
        return false;
    }
}

async function roleLinkSchemaNeedsRebuild(db: SqlAdapter): Promise<boolean> {
    if (db.engine === 'sqlite') {
        const grants = await db.get(
            `SELECT sql AS ddl FROM sqlite_master WHERE type = 'table' AND name = 'perm_role_grants'`,
        );
        if (!grants) return true;
        const ddl = String(grants.ddl ?? '');
        if (ddl.includes('COALESCE')) return true;
        const links = await db.get(
            `SELECT sql AS ddl FROM sqlite_master WHERE type = 'table' AND name = 'perm_role_links'`,
        );
        if (!links) return true;
        return String(links.ddl ?? '').includes('COALESCE');
    }

    if (db.engine === 'postgres') {
        const col = await db.get(
            `SELECT is_nullable AS nullable
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'perm_role_grants'
               AND column_name = 'guildid'`,
        );
        if (!col) {
            const any = await db.get(
                `SELECT 1 AS ok FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'perm_role_grants'`,
            );
            return !any;
        }
        return String(col.nullable).toUpperCase() === 'YES';
    }

    return false;
}

export async function ensureRoleLinkSchema(db: SqlAdapter): Promise<void> {
    if (db.engine === 'mongo') {
        return;
    }

    const rebuild = await roleLinkSchemaNeedsRebuild(db);
    if (rebuild) {
        log.warn('Rebuilding perm_role_links / perm_role_grants schema (legacy or missing)');
        await db.exec(`DROP TABLE IF EXISTS perm_role_grants`);
        await db.exec(`DROP TABLE IF EXISTS perm_role_links`);
        try {
            await db.exec(`DROP INDEX IF EXISTS idx_perm_role_links_unique`);
        } catch {

        }
    }

    await db.run(
        `CREATE TABLE IF NOT EXISTS perm_role_links (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            guildId TEXT NOT NULL DEFAULT '',
            discordRoleId TEXT NOT NULL,
            permRoleId TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            createdBy TEXT NOT NULL
        )`,
    );
    await db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_perm_role_links_unique
         ON perm_role_links(scope, guildId, discordRoleId, permRoleId)`,
    );
    await db.run(
        `CREATE TABLE IF NOT EXISTS perm_role_grants (
            userId TEXT NOT NULL,
            permRoleId TEXT NOT NULL,
            guildId TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL,
            discordRoleId TEXT NOT NULL DEFAULT '',
            createdAt INTEGER NOT NULL,
            PRIMARY KEY (userId, permRoleId, guildId, source, discordRoleId)
        )`,
    );
}

export async function insertLink(
    db: SqlAdapter,
    input: {
        scope: RoleLinkScope;
        guildId: string | null;
        discordRoleId: string;
        permRoleId: string;
        createdBy: string;
    },
): Promise<RoleLinkDoc> {
    const at = nowSeconds();
    const id = randomUUID().replace(/-/g, '').slice(0, 16);
    const guildKey = sqlTextKey(input.guildId);
    const doc: RoleLinkDoc = {
        _id: id,
        scope: input.scope,
        guildId: fromSqlTextKey(guildKey),
        discordRoleId: input.discordRoleId,
        permRoleId: input.permRoleId,
        createdAt: at,
        createdBy: input.createdBy,
    };

    if (db.engine === 'mongo') {
        await db.mongoCollection('perm_role_links').updateOne(
            {
                scope: doc.scope,
                guildId: doc.guildId,
                discordRoleId: doc.discordRoleId,
                permRoleId: doc.permRoleId,
            },
            {
                $setOnInsert: {
                    _id: doc._id,
                    id: doc._id,
                    scope: doc.scope,
                    guildId: doc.guildId,
                    discordRoleId: doc.discordRoleId,
                    permRoleId: doc.permRoleId,
                    createdAt: doc.createdAt,
                    createdBy: doc.createdBy,
                },
            },
            { upsert: true },
        );
        return doc;
    }

    await db.run(
        `INSERT INTO perm_role_links (id, scope, guildId, discordRoleId, permRoleId, createdAt, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [
            doc._id,
            doc.scope,
            guildKey,
            doc.discordRoleId,
            doc.permRoleId,
            doc.createdAt,
            doc.createdBy,
        ],
    );
    return doc;
}

export async function deleteLink(
    db: SqlAdapter,
    input: {
        scope: RoleLinkScope;
        guildId: string | null;
        discordRoleId: string;
        permRoleId: string;
    },
): Promise<boolean> {
    if (db.engine === 'mongo') {
        const n = await db.mongoCollection('perm_role_links').deleteOne({
            scope: input.scope,
            guildId: input.guildId,
            discordRoleId: input.discordRoleId,
            permRoleId: input.permRoleId,
        });
        return n > 0;
    }
    await db.run(
        `DELETE FROM perm_role_links
         WHERE scope = ? AND guildId = ?
           AND discordRoleId = ? AND permRoleId = ?`,
        [input.scope, sqlTextKey(input.guildId), input.discordRoleId, input.permRoleId],
    );
    return true;
}

export async function listLinks(
    db: SqlAdapter,
    filter?: { scope?: RoleLinkScope; guildId?: string | null },
): Promise<RoleLinkDoc[]> {
    if (db.engine === 'mongo') {
        const q: Record<string, unknown> = {};
        if (filter?.scope) q.scope = filter.scope;
        if (filter?.guildId !== undefined) q.guildId = filter.guildId;
        const rows = await db.mongoCollection('perm_role_links').find(q);
        return rows.map((r) => ({
            _id: String(r._id ?? r.id),
            scope: r.scope as RoleLinkScope,
            guildId: (r.guildId as string | null) ?? null,
            discordRoleId: String(r.discordRoleId),
            permRoleId: String(r.permRoleId),
            createdAt: Number(r.createdAt),
            createdBy: String(r.createdBy),
        }));
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.scope) {
        clauses.push('scope = ?');
        params.push(filter.scope);
    }
    if (filter?.guildId !== undefined) {
        clauses.push(`guildId = ?`);
        params.push(sqlTextKey(filter.guildId));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.all(
        `SELECT id, scope, guildId, discordRoleId, permRoleId, createdAt, createdBy
         FROM perm_role_links ${where} ORDER BY createdAt`,
        params,
    );
    return rows.map((r) => ({
        _id: String(r.id),
        scope: r.scope as RoleLinkScope,
        guildId: fromSqlTextKey(r.guildId),
        discordRoleId: String(r.discordRoleId),
        permRoleId: String(r.permRoleId),
        createdAt: Number(r.createdAt),
        createdBy: String(r.createdBy),
    }));
}

export async function upsertGrant(
    db: SqlAdapter,
    grant: Omit<GrantDoc, 'createdAt'> & { createdAt?: number },
): Promise<void> {
    const at = grant.createdAt ?? nowSeconds();
    if (db.engine === 'mongo') {
        await db.mongoCollection('perm_role_grants').updateOne(
            {
                userId: grant.userId,
                permRoleId: grant.permRoleId,
                guildId: grant.guildId,
                source: grant.source,
                discordRoleId: grant.discordRoleId,
            },
            {
                $setOnInsert: {
                    userId: grant.userId,
                    permRoleId: grant.permRoleId,
                    guildId: grant.guildId,
                    source: grant.source,
                    discordRoleId: grant.discordRoleId,
                    createdAt: at,
                },
            },
            { upsert: true },
        );
        return;
    }
    await db.run(
        `INSERT INTO perm_role_grants (userId, permRoleId, guildId, source, discordRoleId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [
            grant.userId,
            grant.permRoleId,
            sqlTextKey(grant.guildId),
            grant.source,
            sqlTextKey(grant.discordRoleId),
            at,
        ],
    );
}

export async function deleteGrants(
    db: SqlAdapter,
    filter: {
        userId?: string;
        permRoleId?: string;
        guildId?: string | null;
        source?: GrantSource;
        discordRoleId?: string | null;
    },
): Promise<number> {
    if (db.engine === 'mongo') {
        const q: Record<string, unknown> = {};
        if (filter.userId) q.userId = filter.userId;
        if (filter.permRoleId) q.permRoleId = filter.permRoleId;
        if (filter.guildId !== undefined) q.guildId = filter.guildId;
        if (filter.source) q.source = filter.source;
        if (filter.discordRoleId !== undefined) q.discordRoleId = filter.discordRoleId;
        const n = await db.mongoCollection('perm_role_grants').deleteMany(q);
        return n;
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.userId) {
        clauses.push('userId = ?');
        params.push(filter.userId);
    }
    if (filter.permRoleId) {
        clauses.push('permRoleId = ?');
        params.push(filter.permRoleId);
    }
    if (filter.guildId !== undefined) {
        clauses.push(`guildId = ?`);
        params.push(sqlTextKey(filter.guildId));
    }
    if (filter.source) {
        clauses.push('source = ?');
        params.push(filter.source);
    }
    if (filter.discordRoleId !== undefined) {
        clauses.push(`discordRoleId = ?`);
        params.push(sqlTextKey(filter.discordRoleId));
    }
    if (clauses.length === 0) return 0;
    await db.run(`DELETE FROM perm_role_grants WHERE ${clauses.join(' AND ')}`, params);
    return 1;
}

export async function listGrantsForRole(
    db: SqlAdapter,
    permRoleId: string,
    guildId: string | null,
): Promise<GrantDoc[]> {
    if (db.engine === 'mongo') {
        const rows = await db.mongoCollection('perm_role_grants').find({
            permRoleId,
            guildId,
        });
        return rows.map((r) => ({
            userId: String(r.userId),
            permRoleId: String(r.permRoleId),
            guildId: (r.guildId as string | null) ?? null,
            source: r.source as GrantSource,
            discordRoleId: (r.discordRoleId as string | null) ?? null,
            createdAt: Number(r.createdAt),
        }));
    }
    const rows = await db.all(
        `SELECT userId, permRoleId, guildId, source, discordRoleId, createdAt
         FROM perm_role_grants
         WHERE permRoleId = ? AND guildId = ?`,
        [permRoleId, sqlTextKey(guildId)],
    );
    return rows.map((r) => ({
        userId: String(r.userId),
        permRoleId: String(r.permRoleId),
        guildId: fromSqlTextKey(r.guildId),
        source: r.source as GrantSource,
        discordRoleId: fromSqlTextKey(r.discordRoleId),
        createdAt: Number(r.createdAt),
    }));
}

export async function userHasAnyGrant(
    db: SqlAdapter,
    userId: string,
    permRoleId: string,
    guildId: string | null,
): Promise<boolean> {
    if (db.engine === 'mongo') {
        const row = await db.mongoCollection('perm_role_grants').findOne({
            userId,
            permRoleId,
            guildId,
        });
        return Boolean(row);
    }
    const row = await db.get(
        `SELECT 1 AS ok FROM perm_role_grants
         WHERE userId = ? AND permRoleId = ? AND guildId = ?
         LIMIT 1`,
        [userId, permRoleId, sqlTextKey(guildId)],
    );
    return Boolean(row);
}

export async function migrateLegacyAssignedAsDirect(
    db: SqlAdapter,
    roles: Array<{ roleId: string; guildId: string | null; userIds: string[] }>,
): Promise<number> {
    let n = 0;
    for (const role of roles) {
        for (const userId of role.userIds) {
            const has = await userHasAnyGrant(db, userId, role.roleId, role.guildId);
            if (has) continue;
            await upsertGrant(db, {
                userId,
                permRoleId: role.roleId,
                guildId: role.guildId,
                source: 'direct',
                discordRoleId: null,
            });
            n += 1;
        }
    }
    if (n > 0) log.info(`Migrated ${n} legacy role assignment(s) to direct grants`);
    return n;
}

export async function syncMemberDiscordRoles(options: {
    db: SqlAdapter;
    member: GuildMember;
    links: RoleLinkDoc[];
    onGrant: (permRoleId: string, userId: string) => Promise<void>;
    onRevokeIfOrphan: (permRoleId: string, userId: string) => Promise<void>;
}): Promise<{ granted: number; revoked: number }> {
    const { db, member, links, onGrant, onRevokeIfOrphan } = options;
    const guildId = member.guild.id;
    const userId = member.id;
    const memberRoleIds = new Set(member.roles.cache.keys());
    let granted = 0;
    let revoked = 0;

    const relevant = links.filter(
        (l) =>
            (l.scope === 'server' && l.guildId === guildId) ||
            (l.scope === 'bot' && (l.guildId === null || l.guildId === guildId)),
    );

    for (const link of relevant) {
        const hasDiscord = memberRoleIds.has(link.discordRoleId);
        if (hasDiscord) {
            await upsertGrant(db, {
                userId,
                permRoleId: link.permRoleId,
                guildId: link.scope === 'bot' ? null : guildId,
                source: 'discord_role',
                discordRoleId: link.discordRoleId,
            });
            await onGrant(link.permRoleId, userId);
            granted += 1;
        } else {
            await deleteGrants(db, {
                userId,
                permRoleId: link.permRoleId,
                guildId: link.scope === 'bot' ? null : guildId,
                source: 'discord_role',
                discordRoleId: link.discordRoleId,
            });
            const still = await userHasAnyGrant(
                db,
                userId,
                link.permRoleId,
                link.scope === 'bot' ? null : guildId,
            );
            if (!still) {
                await onRevokeIfOrphan(link.permRoleId, userId);
                revoked += 1;
            }
        }
    }
    return { granted, revoked };
}
