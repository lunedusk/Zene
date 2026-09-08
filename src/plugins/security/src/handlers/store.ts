import { BaseHandler } from '#core/bases/Handler.js';
import {
    resolveBackend,
    type BackendChoice,
} from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter } from '#core/database/sqlAdapter.js';
import type {
    AntiNukeEventKey,
    AntiNukeRule,
    AutoModSettings,
    BlacklistEntry,
    BlacklistKind,
    TempRoleRecord,
    FreezeStateRow,
    InfractionRow,
    RaidSettings,
    SecurityGuildSettingsRow,
    TempbanRecord,
    VerifySettings,
    ViolationRow,
} from '../lib/types.js';

function newId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default class SecurityStoreHandler extends BaseHandler {
    public readonly name = 'store';
    public readonly version = '1.0.0';
    public readonly description = 'Multi-engine persistence for the security plugin.';

    private adapter: SqlAdapter | null = null;
    private choice: BackendChoice | null = null;

    public async onInitialize(): Promise<void> {
        this.choice = resolveBackend({
            configSection: 'security',
            envEngineKey: 'SecurityEngine',
            envAliasKey: 'SecurityDbAlias',
            defaultAlias: 'main',
        });
        this.adapter = openSqlAdapter(this.choice);
        await this.ensureSchema();
        this.log.info(
            `Security store ready (engine=${this.choice.engine}, alias=${this.choice.alias}).`,
        );
    }

    public async onTeardown(): Promise<void> {
        this.adapter = null;
        this.choice = null;
        this.log.info('Security store torn down.');
    }

    private db(): SqlAdapter {
        if (!this.adapter) {
            throw new Error('Security store is not initialized.');
        }
        return this.adapter;
    }

    private async ensureSchema(): Promise<void> {
        const db = this.db();
        if (db.engine === 'mongo') {
            return;
        }

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_guild_settings (
                guildId TEXT PRIMARY KEY NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_infractions (
                id TEXT PRIMARY KEY NOT NULL,
                guildId TEXT NOT NULL,
                userId TEXT NOT NULL,
                actorId TEXT NOT NULL,
                type TEXT NOT NULL,
                reason TEXT,
                metadata TEXT,
                createdAt INTEGER NOT NULL
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_tempbans (
                id TEXT PRIMARY KEY NOT NULL,
                guildId TEXT NOT NULL,
                userId TEXT NOT NULL,
                actorId TEXT NOT NULL,
                reason TEXT,
                expiresAt INTEGER NOT NULL,
                createdAt INTEGER NOT NULL
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_violations (
                guildId TEXT NOT NULL,
                userId TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                lastActivityAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                PRIMARY KEY (guildId, userId)
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_freeze_state (
                guildId TEXT PRIMARY KEY NOT NULL,
                active INTEGER NOT NULL DEFAULT 0,
                pauseInvites INTEGER NOT NULL DEFAULT 0,
                lockChannels INTEGER NOT NULL DEFAULT 0,
                quarantineJoins INTEGER NOT NULL DEFAULT 0,
                reason TEXT,
                actorId TEXT,
                overwriteSnapshot TEXT,
                invitesPausedUntil INTEGER,
                activatedAt INTEGER,
                updatedAt INTEGER NOT NULL
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_automod_settings (
                guildId TEXT PRIMARY KEY NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                invites INTEGER NOT NULL DEFAULT 0,
                links INTEGER NOT NULL DEFAULT 0,
                spoilers INTEGER NOT NULL DEFAULT 0,
                caps INTEGER NOT NULL DEFAULT 0,
                zalgo INTEGER NOT NULL DEFAULT 0,
                duplicates INTEGER NOT NULL DEFAULT 0,
                massMention INTEGER NOT NULL DEFAULT 0,
                everyoneHere INTEGER NOT NULL DEFAULT 0,
                rolePing INTEGER NOT NULL DEFAULT 0,
                knownSpam INTEGER NOT NULL DEFAULT 0,
                emojiSpam INTEGER NOT NULL DEFAULT 0,
                newlines INTEGER NOT NULL DEFAULT 0,
                attachments INTEGER NOT NULL DEFAULT 0,
                wordBlacklist INTEGER NOT NULL DEFAULT 0,
                linkBlacklist INTEGER NOT NULL DEFAULT 0,
                regexBlacklist INTEGER NOT NULL DEFAULT 0,
                massMentionLimit INTEGER NOT NULL DEFAULT 5,
                capsPercent INTEGER NOT NULL DEFAULT 70,
                capsMinLength INTEGER NOT NULL DEFAULT 12,
                duplicateWindowMs INTEGER NOT NULL DEFAULT 15000,
                duplicateCount INTEGER NOT NULL DEFAULT 3,
                emojiMax INTEGER NOT NULL DEFAULT 12,
                newlineMax INTEGER NOT NULL DEFAULT 15,
                attachmentMax INTEGER NOT NULL DEFAULT 6,
                attachmentWindowMs INTEGER NOT NULL DEFAULT 15000,
                actionDelete INTEGER NOT NULL DEFAULT 1,
                actionWarn INTEGER NOT NULL DEFAULT 0,
                actionTimeout INTEGER NOT NULL DEFAULT 0,
                actionStrike INTEGER NOT NULL DEFAULT 1,
                actionTempRole INTEGER NOT NULL DEFAULT 0,
                timeoutSeconds INTEGER NOT NULL DEFAULT 300,
                tempRoleId TEXT,
                tempRoleDurationMs INTEGER NOT NULL DEFAULT 600000,
                exemptRoleIds TEXT,
                exemptChannelIds TEXT,
                exemptUserIds TEXT,
                updatedAt INTEGER NOT NULL
            )
        `);


        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_antinuke_rules (
                guildId TEXT NOT NULL,
                eventKey TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                windowMs INTEGER NOT NULL DEFAULT 10000,
                maxActions INTEGER NOT NULL DEFAULT 3,
                punishment TEXT NOT NULL DEFAULT 'stripRoles',
                punishmentDurationMs INTEGER NOT NULL DEFAULT 600000,
                whitelistUserIds TEXT,
                whitelistRoleIds TEXT,
                updatedAt INTEGER NOT NULL,
                PRIMARY KEY (guildId, eventKey)
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_raid_settings (
                guildId TEXT PRIMARY KEY NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                maxJoins INTEGER NOT NULL DEFAULT 8,
                windowMs INTEGER NOT NULL DEFAULT 15000,
                action TEXT NOT NULL DEFAULT 'quarantine',
                quarantineRoleId TEXT,
                pauseVerifyMs INTEGER NOT NULL DEFAULT 300000,
                joinRoleId TEXT,
                updatedAt INTEGER NOT NULL
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_verify_settings (
                guildId TEXT PRIMARY KEY NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                verifiedRoleId TEXT,
                quarantineRoleId TEXT,
                maxAttempts INTEGER NOT NULL DEFAULT 3,
                challengeTtlMs INTEGER NOT NULL DEFAULT 120000,
                updatedAt INTEGER NOT NULL
            )
        `);


        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_blacklists (
                id TEXT PRIMARY KEY NOT NULL,
                guildId TEXT NOT NULL,
                kind TEXT NOT NULL,
                pattern TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                actorId TEXT
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS security_temp_roles (
                guildId TEXT NOT NULL,
                userId TEXT NOT NULL,
                roleId TEXT NOT NULL,
                expiresAt INTEGER NOT NULL,
                reason TEXT,
                actorId TEXT,
                createdAt INTEGER NOT NULL,
                PRIMARY KEY (guildId, userId, roleId)
            )
        `);


        // Best-effort column adds for upgraded installs (sqlite/postgres).
        const alterCols = [
            'actionTempRole INTEGER NOT NULL DEFAULT 0',
            'tempRoleId TEXT',
            'tempRoleDurationMs INTEGER NOT NULL DEFAULT 600000',
            'emojiSpam INTEGER NOT NULL DEFAULT 0',
            'newlines INTEGER NOT NULL DEFAULT 0',
            'attachments INTEGER NOT NULL DEFAULT 0',
            'wordBlacklist INTEGER NOT NULL DEFAULT 0',
            'linkBlacklist INTEGER NOT NULL DEFAULT 0',
            'regexBlacklist INTEGER NOT NULL DEFAULT 0',
            'emojiMax INTEGER NOT NULL DEFAULT 12',
            'newlineMax INTEGER NOT NULL DEFAULT 15',
            'attachmentMax INTEGER NOT NULL DEFAULT 6',
            'attachmentWindowMs INTEGER NOT NULL DEFAULT 15000',
        ];
        if (db.engine === 'sqlite' || db.engine === 'postgres') {
            for (const col of alterCols) {
                const name = col.split(' ')[0];
                try {
                    await db.exec(`ALTER TABLE security_automod_settings ADD COLUMN ${col}`);
                } catch {
                    /* column may already exist */
                }
                void name;
            }
        }

        if (db.engine === 'sqlite') {
            await db.exec(
                `CREATE INDEX IF NOT EXISTS idx_security_infractions_guild_user ON security_infractions (guildId, userId)`,
            );
            await db.exec(
                `CREATE INDEX IF NOT EXISTS idx_security_tempbans_expires ON security_tempbans (expiresAt)`,
            );
            await db.exec(
                `CREATE INDEX IF NOT EXISTS idx_security_violations_activity ON security_violations (lastActivityAt)`,
            );
        } else if (db.engine === 'postgres') {
            await db.exec(
                `CREATE INDEX IF NOT EXISTS idx_security_infractions_guild_user ON security_infractions (guildId, userId)`,
            );
            await db.exec(
                `CREATE INDEX IF NOT EXISTS idx_security_tempbans_expires ON security_tempbans (expiresAt)`,
            );
            await db.exec(
                `CREATE INDEX IF NOT EXISTS idx_security_violations_activity ON security_violations (lastActivityAt)`,
            );
        }
    }

    public async ensureGuildSettings(guildId: string): Promise<SecurityGuildSettingsRow> {
        const db = this.db();
        const now = Date.now();

        if (db.engine === 'mongo') {
            const col = db.mongoCollection('security_guild_settings');
            const existing = await col.findOne({ guildId });
            if (existing) {
                return {
                    guildId: String(existing.guildId),
                    createdAt: Number(existing.createdAt),
                    updatedAt: Number(existing.updatedAt),
                };
            }
            await col.insertOne({ _id: guildId, guildId, createdAt: now, updatedAt: now });
            return { guildId, createdAt: now, updatedAt: now };
        }

        const row = await db.get(
            `SELECT guildId, createdAt, updatedAt FROM security_guild_settings WHERE guildId = ?`,
            [guildId],
        );
        if (row) {
            return {
                guildId: String(row.guildId),
                createdAt: Number(row.createdAt),
                updatedAt: Number(row.updatedAt),
            };
        }

        if (db.engine === 'postgres') {
            await db.run(
                `INSERT INTO security_guild_settings (guildId, createdAt, updatedAt)
                 VALUES (?, ?, ?)
                 ON CONFLICT (guildId) DO NOTHING`,
                [guildId, now, now],
            );
        } else {
            await db.run(
                `INSERT INTO security_guild_settings (guildId, createdAt, updatedAt)
                 VALUES (?, ?, ?)
                 ON CONFLICT(guildId) DO NOTHING`,
                [guildId, now, now],
            );
        }

        return { guildId, createdAt: now, updatedAt: now };
    }

    public async recordInfraction(input: {
        guildId: string;
        userId: string;
        actorId: string;
        type: string;
        reason?: string | null;
        metadata?: Record<string, unknown> | null;
    }): Promise<InfractionRow> {
        const db = this.db();
        const id = newId();
        const createdAt = Date.now();
        const reason = input.reason ?? null;
        const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

        if (db.engine === 'mongo') {
            await db.mongoCollection('security_infractions').insertOne({
                _id: id,
                id,
                guildId: input.guildId,
                userId: input.userId,
                actorId: input.actorId,
                type: input.type,
                reason,
                metadata,
                createdAt,
            });
        } else {
            await db.run(
                `INSERT INTO security_infractions (id, guildId, userId, actorId, type, reason, metadata, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, input.guildId, input.userId, input.actorId, input.type, reason, metadata, createdAt],
            );
        }

        return {
            id,
            guildId: input.guildId,
            userId: input.userId,
            actorId: input.actorId,
            type: input.type,
            reason,
            metadata,
            createdAt,
        };
    }

    public async addTempban(input: {
        guildId: string;
        userId: string;
        actorId: string;
        reason?: string | null;
        expiresAt: number;
    }): Promise<TempbanRecord> {
        const db = this.db();
        const id = newId();
        const createdAt = Date.now();
        const reason = input.reason ?? null;

        if (db.engine === 'mongo') {
            await db.mongoCollection('security_tempbans').insertOne({
                _id: id,
                id,
                guildId: input.guildId,
                userId: input.userId,
                actorId: input.actorId,
                reason,
                expiresAt: input.expiresAt,
                createdAt,
            });
        } else {
            await db.run(
                `INSERT INTO security_tempbans (id, guildId, userId, actorId, reason, expiresAt, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, input.guildId, input.userId, input.actorId, reason, input.expiresAt, createdAt],
            );
        }

        return {
            id,
            guildId: input.guildId,
            userId: input.userId,
            actorId: input.actorId,
            reason,
            expiresAt: input.expiresAt,
            createdAt,
        };
    }

    public async listDueTempbans(nowMs: number = Date.now()): Promise<TempbanRecord[]> {
        const db = this.db();

        if (db.engine === 'mongo') {
            const rows = await db.mongoCollection('security_tempbans').find({
                expiresAt: { $lte: nowMs },
            } as Record<string, unknown>);
            return rows.map((r) => ({
                id: String(r.id ?? r._id),
                guildId: String(r.guildId),
                userId: String(r.userId),
                actorId: String(r.actorId),
                reason: r.reason != null ? String(r.reason) : null,
                expiresAt: Number(r.expiresAt),
                createdAt: Number(r.createdAt),
            }));
        }

        const rows = await db.all(
            `SELECT id, guildId, userId, actorId, reason, expiresAt, createdAt
             FROM security_tempbans WHERE expiresAt <= ?`,
            [nowMs],
        );
        return rows.map((r) => ({
            id: String(r.id),
            guildId: String(r.guildId),
            userId: String(r.userId),
            actorId: String(r.actorId),
            reason: r.reason != null ? String(r.reason) : null,
            expiresAt: Number(r.expiresAt),
            createdAt: Number(r.createdAt),
        }));
    }

    public async removeTempban(id: string): Promise<void> {
        const db = this.db();
        if (db.engine === 'mongo') {
            await db.mongoCollection('security_tempbans').deleteOne({
                $or: [{ _id: id }, { id }],
            } as Record<string, unknown>);
            return;
        }
        await db.run(`DELETE FROM security_tempbans WHERE id = ?`, [id]);
    }

    // --- Phase 2: infractions list / delete ---

    public async listInfractions(input: {
        guildId: string;
        userId?: string;
        type?: string;
        limit?: number;
    }): Promise<InfractionRow[]> {
        const db = this.db();
        const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

        if (db.engine === 'mongo') {
            const filter: Record<string, unknown> = { guildId: input.guildId };
            if (input.userId) filter.userId = input.userId;
            if (input.type) filter.type = input.type;
            const rows = await db.mongoCollection('security_infractions').find(filter);
            return rows
                .map((r) => ({
                    id: String(r.id ?? r._id),
                    guildId: String(r.guildId),
                    userId: String(r.userId),
                    actorId: String(r.actorId),
                    type: String(r.type),
                    reason: r.reason != null ? String(r.reason) : null,
                    metadata: r.metadata != null ? String(r.metadata) : null,
                    createdAt: Number(r.createdAt),
                }))
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, limit);
        }

        const clauses: string[] = ['guildId = ?'];
        const params: unknown[] = [input.guildId];
        if (input.userId) {
            clauses.push('userId = ?');
            params.push(input.userId);
        }
        if (input.type) {
            clauses.push('type = ?');
            params.push(input.type);
        }
        params.push(limit);
        const rows = await db.all(
            `SELECT id, guildId, userId, actorId, type, reason, metadata, createdAt
             FROM security_infractions
             WHERE ${clauses.join(' AND ')}
             ORDER BY createdAt DESC
             LIMIT ?`,
            params,
        );
        return rows.map((r) => ({
            id: String(r.id),
            guildId: String(r.guildId),
            userId: String(r.userId),
            actorId: String(r.actorId),
            type: String(r.type),
            reason: r.reason != null ? String(r.reason) : null,
            metadata: r.metadata != null ? String(r.metadata) : null,
            createdAt: Number(r.createdAt),
        }));
    }

    public async getInfraction(id: string, guildId: string): Promise<InfractionRow | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_infractions').findOne({
                $or: [{ _id: id }, { id }],
                guildId,
            } as Record<string, unknown>);
            if (!row) return null;
            return {
                id: String(row.id ?? row._id),
                guildId: String(row.guildId),
                userId: String(row.userId),
                actorId: String(row.actorId),
                type: String(row.type),
                reason: row.reason != null ? String(row.reason) : null,
                metadata: row.metadata != null ? String(row.metadata) : null,
                createdAt: Number(row.createdAt),
            };
        }
        const row = await db.get(
            `SELECT id, guildId, userId, actorId, type, reason, metadata, createdAt
             FROM security_infractions WHERE id = ? AND guildId = ?`,
            [id, guildId],
        );
        if (!row) return null;
        return {
            id: String(row.id),
            guildId: String(row.guildId),
            userId: String(row.userId),
            actorId: String(row.actorId),
            type: String(row.type),
            reason: row.reason != null ? String(row.reason) : null,
            metadata: row.metadata != null ? String(row.metadata) : null,
            createdAt: Number(row.createdAt),
        };
    }

    public async deleteInfraction(id: string, guildId: string): Promise<boolean> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const n = await db.mongoCollection('security_infractions').deleteOne({
                $or: [{ _id: id }, { id }],
                guildId,
            } as Record<string, unknown>);
            return n > 0;
        }
        const before = await this.getInfraction(id, guildId);
        if (!before) return false;
        await db.run(`DELETE FROM security_infractions WHERE id = ? AND guildId = ?`, [id, guildId]);
        return true;
    }

    // --- Phase 2: violations ---

    public async getViolation(guildId: string, userId: string): Promise<ViolationRow | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_violations').findOne({ guildId, userId });
            if (!row) return null;
            return {
                guildId: String(row.guildId),
                userId: String(row.userId),
                points: Number(row.points),
                lastActivityAt: Number(row.lastActivityAt),
                updatedAt: Number(row.updatedAt),
            };
        }
        const row = await db.get(
            `SELECT guildId, userId, points, lastActivityAt, updatedAt
             FROM security_violations WHERE guildId = ? AND userId = ?`,
            [guildId, userId],
        );
        if (!row) return null;
        return {
            guildId: String(row.guildId),
            userId: String(row.userId),
            points: Number(row.points),
            lastActivityAt: Number(row.lastActivityAt),
            updatedAt: Number(row.updatedAt),
        };
    }

    public async setViolation(input: {
        guildId: string;
        userId: string;
        points: number;
        touchActivity?: boolean;
    }): Promise<ViolationRow> {
        const db = this.db();
        const now = Date.now();
        const points = Math.max(0, Math.floor(input.points));
        const existing = await this.getViolation(input.guildId, input.userId);
        const lastActivityAt =
            input.touchActivity === false && existing
                ? existing.lastActivityAt
                : now;

        if (db.engine === 'mongo') {
            await db.mongoCollection('security_violations').updateOne(
                { guildId: input.guildId, userId: input.userId },
                {
                    $set: {
                        guildId: input.guildId,
                        userId: input.userId,
                        points,
                        lastActivityAt,
                        updatedAt: now,
                    },
                },
                { upsert: true },
            );
        } else if (db.engine === 'postgres') {
            await db.run(
                `INSERT INTO security_violations (guildId, userId, points, lastActivityAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (guildId, userId) DO UPDATE SET
                   points = EXCLUDED.points,
                   lastActivityAt = EXCLUDED.lastActivityAt,
                   updatedAt = EXCLUDED.updatedAt`,
                [input.guildId, input.userId, points, lastActivityAt, now],
            );
        } else {
            await db.run(
                `INSERT INTO security_violations (guildId, userId, points, lastActivityAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(guildId, userId) DO UPDATE SET
                   points = excluded.points,
                   lastActivityAt = excluded.lastActivityAt,
                   updatedAt = excluded.updatedAt`,
                [input.guildId, input.userId, points, lastActivityAt, now],
            );
        }

        return {
            guildId: input.guildId,
            userId: input.userId,
            points,
            lastActivityAt,
            updatedAt: now,
        };
    }

    public async listStaleViolations(
        cleanDays: number,
        nowMs: number = Date.now(),
    ): Promise<ViolationRow[]> {
        const cutoff = nowMs - cleanDays * 86_400_000;
        const db = this.db();
        if (db.engine === 'mongo') {
            const rows = await db.mongoCollection('security_violations').find({
                points: { $gt: 0 },
                lastActivityAt: { $lte: cutoff },
            } as Record<string, unknown>);
            return rows.map((r) => ({
                guildId: String(r.guildId),
                userId: String(r.userId),
                points: Number(r.points),
                lastActivityAt: Number(r.lastActivityAt),
                updatedAt: Number(r.updatedAt),
            }));
        }
        const rows = await db.all(
            `SELECT guildId, userId, points, lastActivityAt, updatedAt
             FROM security_violations
             WHERE points > 0 AND lastActivityAt <= ?`,
            [cutoff],
        );
        return rows.map((r) => ({
            guildId: String(r.guildId),
            userId: String(r.userId),
            points: Number(r.points),
            lastActivityAt: Number(r.lastActivityAt),
            updatedAt: Number(r.updatedAt),
        }));
    }

    // --- Phase 2: freeze / lockdown state ---

    public async getFreezeState(guildId: string): Promise<FreezeStateRow | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_freeze_state').findOne({ guildId });
            if (!row) return null;
            return this.mapFreeze(row);
        }
        const row = await db.get(
            `SELECT guildId, active, pauseInvites, lockChannels, quarantineJoins, reason, actorId,
                    overwriteSnapshot, invitesPausedUntil, activatedAt, updatedAt
             FROM security_freeze_state WHERE guildId = ?`,
            [guildId],
        );
        if (!row) return null;
        return this.mapFreeze(row);
    }

    public async listActiveFreezes(): Promise<FreezeStateRow[]> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const rows = await db.mongoCollection('security_freeze_state').find({ active: true });
            return rows.map((r) => this.mapFreeze(r));
        }
        const rows = await db.all(
            `SELECT guildId, active, pauseInvites, lockChannels, quarantineJoins, reason, actorId,
                    overwriteSnapshot, invitesPausedUntil, activatedAt, updatedAt
             FROM security_freeze_state WHERE active = 1 OR active = true`,
        );
        return rows.map((r) => this.mapFreeze(r));
    }

    public async upsertFreezeState(state: FreezeStateRow): Promise<void> {
        const db = this.db();
        const activeVal = state.active ? 1 : 0;
        const pauseVal = state.pauseInvites ? 1 : 0;
        const lockVal = state.lockChannels ? 1 : 0;
        const quarVal = state.quarantineJoins ? 1 : 0;

        if (db.engine === 'mongo') {
            await db.mongoCollection('security_freeze_state').updateOne(
                { guildId: state.guildId },
                {
                    $set: {
                        guildId: state.guildId,
                        active: state.active,
                        pauseInvites: state.pauseInvites,
                        lockChannels: state.lockChannels,
                        quarantineJoins: state.quarantineJoins,
                        reason: state.reason,
                        actorId: state.actorId,
                        overwriteSnapshot: state.overwriteSnapshot,
                        invitesPausedUntil: state.invitesPausedUntil,
                        activatedAt: state.activatedAt,
                        updatedAt: state.updatedAt,
                    },
                },
                { upsert: true },
            );
            return;
        }

        if (db.engine === 'postgres') {
            await db.run(
                `INSERT INTO security_freeze_state
                 (guildId, active, pauseInvites, lockChannels, quarantineJoins, reason, actorId,
                  overwriteSnapshot, invitesPausedUntil, activatedAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (guildId) DO UPDATE SET
                   active = EXCLUDED.active,
                   pauseInvites = EXCLUDED.pauseInvites,
                   lockChannels = EXCLUDED.lockChannels,
                   quarantineJoins = EXCLUDED.quarantineJoins,
                   reason = EXCLUDED.reason,
                   actorId = EXCLUDED.actorId,
                   overwriteSnapshot = EXCLUDED.overwriteSnapshot,
                   invitesPausedUntil = EXCLUDED.invitesPausedUntil,
                   activatedAt = EXCLUDED.activatedAt,
                   updatedAt = EXCLUDED.updatedAt`,
                [
                    state.guildId,
                    activeVal,
                    pauseVal,
                    lockVal,
                    quarVal,
                    state.reason,
                    state.actorId,
                    state.overwriteSnapshot,
                    state.invitesPausedUntil,
                    state.activatedAt,
                    state.updatedAt,
                ],
            );
            return;
        }

        await db.run(
            `INSERT INTO security_freeze_state
             (guildId, active, pauseInvites, lockChannels, quarantineJoins, reason, actorId,
              overwriteSnapshot, invitesPausedUntil, activatedAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET
               active = excluded.active,
               pauseInvites = excluded.pauseInvites,
               lockChannels = excluded.lockChannels,
               quarantineJoins = excluded.quarantineJoins,
               reason = excluded.reason,
               actorId = excluded.actorId,
               overwriteSnapshot = excluded.overwriteSnapshot,
               invitesPausedUntil = excluded.invitesPausedUntil,
               activatedAt = excluded.activatedAt,
               updatedAt = excluded.updatedAt`,
            [
                state.guildId,
                activeVal,
                pauseVal,
                lockVal,
                quarVal,
                state.reason,
                state.actorId,
                state.overwriteSnapshot,
                state.invitesPausedUntil,
                state.activatedAt,
                state.updatedAt,
            ],
        );
    }

    private mapFreeze(row: Record<string, unknown>): FreezeStateRow {
        const activeRaw = row.active;
        const active =
            activeRaw === true || activeRaw === 1 || activeRaw === '1' || activeRaw === 'true';
        return {
            guildId: String(row.guildId),
            active,
            pauseInvites:
                row.pauseInvites === true ||
                row.pauseInvites === 1 ||
                row.pauseInvites === '1' ||
                row.pauseInvites === 'true',
            lockChannels:
                row.lockChannels === true ||
                row.lockChannels === 1 ||
                row.lockChannels === '1' ||
                row.lockChannels === 'true',
            quarantineJoins:
                row.quarantineJoins === true ||
                row.quarantineJoins === 1 ||
                row.quarantineJoins === '1' ||
                row.quarantineJoins === 'true',
            reason: row.reason != null ? String(row.reason) : null,
            actorId: row.actorId != null ? String(row.actorId) : null,
            overwriteSnapshot: row.overwriteSnapshot != null ? String(row.overwriteSnapshot) : null,
            invitesPausedUntil:
                row.invitesPausedUntil != null ? Number(row.invitesPausedUntil) : null,
            activatedAt: row.activatedAt != null ? Number(row.activatedAt) : null,
            updatedAt: Number(row.updatedAt),
        };
    }

    // --- Phase 3: AutoMod settings ---

    public async getAutoModSettings(guildId: string): Promise<AutoModSettings | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_automod_settings').findOne({ guildId });
            if (!row) return null;
            return this.mapAutoMod(row);
        }
        const row = await db.get(
            `SELECT * FROM security_automod_settings WHERE guildId = ?`,
            [guildId],
        );
        if (!row) return null;
        return this.mapAutoMod(row);
    }

    public async upsertAutoModSettings(settings: AutoModSettings): Promise<void> {
        const db = this.db();
        const bool = (v: boolean): number => (v ? 1 : 0);
        const roles = JSON.stringify(settings.exemptRoleIds);
        const channels = JSON.stringify(settings.exemptChannelIds);
        const users = JSON.stringify(settings.exemptUserIds);

        if (db.engine === 'mongo') {
            await db.mongoCollection('security_automod_settings').updateOne(
                { guildId: settings.guildId },
                {
                    $set: {
                        guildId: settings.guildId,
                        enabled: settings.enabled,
                        invites: settings.invites,
                        links: settings.links,
                        spoilers: settings.spoilers,
                        caps: settings.caps,
                        zalgo: settings.zalgo,
                        duplicates: settings.duplicates,
                        massMention: settings.massMention,
                        everyoneHere: settings.everyoneHere,
                        rolePing: settings.rolePing,
                        knownSpam: settings.knownSpam,
                        emojiSpam: settings.emojiSpam,
                        newlines: settings.newlines,
                        attachments: settings.attachments,
                        wordBlacklist: settings.wordBlacklist,
                        linkBlacklist: settings.linkBlacklist,
                        regexBlacklist: settings.regexBlacklist,
                        massMentionLimit: settings.massMentionLimit,
                        capsPercent: settings.capsPercent,
                        capsMinLength: settings.capsMinLength,
                        duplicateWindowMs: settings.duplicateWindowMs,
                        duplicateCount: settings.duplicateCount,
                        emojiMax: settings.emojiMax,
                        newlineMax: settings.newlineMax,
                        attachmentMax: settings.attachmentMax,
                        attachmentWindowMs: settings.attachmentWindowMs,
                        actionDelete: settings.actionDelete,
                        actionWarn: settings.actionWarn,
                        actionTimeout: settings.actionTimeout,
                        actionStrike: settings.actionStrike,
                        actionTempRole: settings.actionTempRole,
                        timeoutSeconds: settings.timeoutSeconds,
                        tempRoleId: settings.tempRoleId,
                        tempRoleDurationMs: settings.tempRoleDurationMs,
                        exemptRoleIds: roles,
                        exemptChannelIds: channels,
                        exemptUserIds: users,
                        updatedAt: settings.updatedAt,
                    },
                },
                { upsert: true },
            );
            return;
        }

        const vals = [
            settings.guildId,
            bool(settings.enabled),
            bool(settings.invites),
            bool(settings.links),
            bool(settings.spoilers),
            bool(settings.caps),
            bool(settings.zalgo),
            bool(settings.duplicates),
            bool(settings.massMention),
            bool(settings.everyoneHere),
            bool(settings.rolePing),
            bool(settings.knownSpam),
            bool(settings.emojiSpam),
            bool(settings.newlines),
            bool(settings.attachments),
            bool(settings.wordBlacklist),
            bool(settings.linkBlacklist),
            bool(settings.regexBlacklist),
            settings.massMentionLimit,
            settings.capsPercent,
            settings.capsMinLength,
            settings.duplicateWindowMs,
            settings.duplicateCount,
            settings.emojiMax,
            settings.newlineMax,
            settings.attachmentMax,
            settings.attachmentWindowMs,
            bool(settings.actionDelete),
            bool(settings.actionWarn),
            bool(settings.actionTimeout),
            bool(settings.actionStrike),
            bool(settings.actionTempRole),
            settings.timeoutSeconds,
            settings.tempRoleId,
            settings.tempRoleDurationMs,
            roles,
            channels,
            users,
            settings.updatedAt,
        ];

        if (db.engine === 'postgres') {
            await db.run(
                `INSERT INTO security_automod_settings (
                    guildId, enabled, invites, links, spoilers, caps, zalgo, duplicates,
                    massMention, everyoneHere, rolePing, knownSpam,
                    emojiSpam, newlines, attachments, wordBlacklist, linkBlacklist, regexBlacklist,
                    massMentionLimit, capsPercent, capsMinLength, duplicateWindowMs, duplicateCount,
                    emojiMax, newlineMax, attachmentMax, attachmentWindowMs,
                    actionDelete, actionWarn, actionTimeout, actionStrike, actionTempRole, timeoutSeconds, tempRoleId, tempRoleDurationMs,
                    exemptRoleIds, exemptChannelIds, exemptUserIds, updatedAt
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (guildId) DO UPDATE SET
                    enabled = EXCLUDED.enabled, invites = EXCLUDED.invites, links = EXCLUDED.links,
                    spoilers = EXCLUDED.spoilers, caps = EXCLUDED.caps, zalgo = EXCLUDED.zalgo,
                    duplicates = EXCLUDED.duplicates, massMention = EXCLUDED.massMention,
                    everyoneHere = EXCLUDED.everyoneHere, rolePing = EXCLUDED.rolePing,
                    knownSpam = EXCLUDED.knownSpam, emojiSpam = EXCLUDED.emojiSpam, newlines = EXCLUDED.newlines, attachments = EXCLUDED.attachments, wordBlacklist = EXCLUDED.wordBlacklist, linkBlacklist = EXCLUDED.linkBlacklist, regexBlacklist = EXCLUDED.regexBlacklist, massMentionLimit = EXCLUDED.massMentionLimit,
                    capsPercent = EXCLUDED.capsPercent, capsMinLength = EXCLUDED.capsMinLength,
                    duplicateWindowMs = EXCLUDED.duplicateWindowMs, duplicateCount = EXCLUDED.duplicateCount, emojiMax = EXCLUDED.emojiMax, newlineMax = EXCLUDED.newlineMax, attachmentMax = EXCLUDED.attachmentMax, attachmentWindowMs = EXCLUDED.attachmentWindowMs,
                    actionDelete = EXCLUDED.actionDelete, actionWarn = EXCLUDED.actionWarn,
                    actionTimeout = EXCLUDED.actionTimeout, actionStrike = EXCLUDED.actionStrike, actionTempRole = EXCLUDED.actionTempRole,
                    timeoutSeconds = EXCLUDED.timeoutSeconds, tempRoleId = EXCLUDED.tempRoleId, tempRoleDurationMs = EXCLUDED.tempRoleDurationMs, exemptRoleIds = EXCLUDED.exemptRoleIds,
                    exemptChannelIds = EXCLUDED.exemptChannelIds, exemptUserIds = EXCLUDED.exemptUserIds,
                    updatedAt = EXCLUDED.updatedAt`,
                vals,
            );
            return;
        }

        await db.run(
            `INSERT INTO security_automod_settings (
                guildId, enabled, invites, links, spoilers, caps, zalgo, duplicates,
                massMention, everyoneHere, rolePing, knownSpam,
                massMentionLimit, capsPercent, capsMinLength, duplicateWindowMs, duplicateCount,
                actionDelete, actionWarn, actionTimeout, actionStrike, actionTempRole, timeoutSeconds, tempRoleId, tempRoleDurationMs,
                exemptRoleIds, exemptChannelIds, exemptUserIds, updatedAt
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET
                enabled = excluded.enabled, invites = excluded.invites, links = excluded.links,
                spoilers = excluded.spoilers, caps = excluded.caps, zalgo = excluded.zalgo,
                duplicates = excluded.duplicates, massMention = excluded.massMention,
                everyoneHere = excluded.everyoneHere, rolePing = excluded.rolePing,
                knownSpam = excluded.knownSpam, emojiSpam = excluded.emojiSpam, newlines = excluded.newlines, attachments = excluded.attachments, wordBlacklist = excluded.wordBlacklist, linkBlacklist = excluded.linkBlacklist, regexBlacklist = excluded.regexBlacklist, massMentionLimit = excluded.massMentionLimit,
                capsPercent = excluded.capsPercent, capsMinLength = excluded.capsMinLength,
                duplicateWindowMs = excluded.duplicateWindowMs, duplicateCount = excluded.duplicateCount, emojiMax = excluded.emojiMax, newlineMax = excluded.newlineMax, attachmentMax = excluded.attachmentMax, attachmentWindowMs = excluded.attachmentWindowMs,
                actionDelete = excluded.actionDelete, actionWarn = excluded.actionWarn,
                actionTimeout = excluded.actionTimeout, actionStrike = excluded.actionStrike, actionTempRole = excluded.actionTempRole,
                timeoutSeconds = excluded.timeoutSeconds, tempRoleId = excluded.tempRoleId, tempRoleDurationMs = excluded.tempRoleDurationMs, exemptRoleIds = excluded.exemptRoleIds,
                exemptChannelIds = excluded.exemptChannelIds, exemptUserIds = excluded.exemptUserIds,
                updatedAt = excluded.updatedAt`,
            vals,
        );
    }

    private mapAutoMod(row: Record<string, unknown>): AutoModSettings {
        const b = (v: unknown): boolean =>
            v === true || v === 1 || v === '1' || v === 'true';
        const parseIds = (raw: unknown): string[] => {
            if (Array.isArray(raw)) return raw.map(String);
            if (typeof raw === 'string' && raw.trim()) {
                try {
                    const p: unknown = JSON.parse(raw);
                    if (Array.isArray(p)) return p.map(String);
                } catch {
                    return [];
                }
            }
            return [];
        };
        return {
            guildId: String(row.guildId),
            enabled: b(row.enabled),
            invites: b(row.invites),
            links: b(row.links),
            spoilers: b(row.spoilers),
            caps: b(row.caps),
            zalgo: b(row.zalgo),
            duplicates: b(row.duplicates),
            massMention: b(row.massMention),
            everyoneHere: b(row.everyoneHere),
            rolePing: b(row.rolePing),
            knownSpam: b(row.knownSpam),
            emojiSpam: b(row.emojiSpam),
            newlines: b(row.newlines),
            attachments: b(row.attachments),
            wordBlacklist: b(row.wordBlacklist),
            linkBlacklist: b(row.linkBlacklist),
            regexBlacklist: b(row.regexBlacklist),
            massMentionLimit: Number(row.massMentionLimit ?? 5),
            capsPercent: Number(row.capsPercent ?? 70),
            capsMinLength: Number(row.capsMinLength ?? 12),
            duplicateWindowMs: Number(row.duplicateWindowMs ?? 15000),
            duplicateCount: Number(row.duplicateCount ?? 3),
            emojiMax: Number(row.emojiMax ?? 12),
            newlineMax: Number(row.newlineMax ?? 15),
            attachmentMax: Number(row.attachmentMax ?? 6),
            attachmentWindowMs: Number(row.attachmentWindowMs ?? 15000),
            actionDelete: b(row.actionDelete),
            actionWarn: b(row.actionWarn),
            actionTimeout: b(row.actionTimeout),
            actionStrike: b(row.actionStrike),
            actionTempRole: b(row.actionTempRole),
            timeoutSeconds: Number(row.timeoutSeconds ?? 300),
            tempRoleId: row.tempRoleId != null ? String(row.tempRoleId) : null,
            tempRoleDurationMs: Number(row.tempRoleDurationMs ?? 600000),
            exemptRoleIds: parseIds(row.exemptRoleIds),
            exemptChannelIds: parseIds(row.exemptChannelIds),
            exemptUserIds: parseIds(row.exemptUserIds),
            updatedAt: Number(row.updatedAt ?? Date.now()),
        };
    }

    // --- Phase 4: anti-nuke / raid / verify ---

    public async getAntiNukeRule(guildId: string, eventKey: string): Promise<AntiNukeRule | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_antinuke_rules').findOne({ guildId, eventKey });
            if (!row) return null;
            return this.mapAntiNuke(row);
        }
        const row = await db.get(
            `SELECT * FROM security_antinuke_rules WHERE guildId = ? AND eventKey = ?`,
            [guildId, eventKey],
        );
        if (!row) return null;
        return this.mapAntiNuke(row);
    }

    public async listAntiNukeRules(guildId: string): Promise<AntiNukeRule[]> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const rows = await db.mongoCollection('security_antinuke_rules').find({ guildId });
            return rows.map((r) => this.mapAntiNuke(r));
        }
        const rows = await db.all(`SELECT * FROM security_antinuke_rules WHERE guildId = ?`, [guildId]);
        return rows.map((r) => this.mapAntiNuke(r));
    }

    public async upsertAntiNukeRule(rule: AntiNukeRule): Promise<void> {
        const db = this.db();
        const bool = (v: boolean): number => (v ? 1 : 0);
        const users = JSON.stringify(rule.whitelistUserIds);
        const roles = JSON.stringify(rule.whitelistRoleIds);
        if (db.engine === 'mongo') {
            await db.mongoCollection('security_antinuke_rules').updateOne(
                { guildId: rule.guildId, eventKey: rule.eventKey },
                {
                    $set: {
                        guildId: rule.guildId,
                        eventKey: rule.eventKey,
                        enabled: rule.enabled,
                        windowMs: rule.windowMs,
                        maxActions: rule.maxActions,
                        punishment: rule.punishment,
                        punishmentDurationMs: rule.punishmentDurationMs,
                        whitelistUserIds: users,
                        whitelistRoleIds: roles,
                        updatedAt: rule.updatedAt,
                    },
                },
                { upsert: true },
            );
            return;
        }
        const vals = [
            rule.guildId,
            rule.eventKey,
            bool(rule.enabled),
            rule.windowMs,
            rule.maxActions,
            rule.punishment,
            rule.punishmentDurationMs,
            users,
            roles,
            rule.updatedAt,
        ];
        if (db.engine === 'postgres') {
            await db.run(
                `INSERT INTO security_antinuke_rules
                 (guildId, eventKey, enabled, windowMs, maxActions, punishment, punishmentDurationMs, whitelistUserIds, whitelistRoleIds, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (guildId, eventKey) DO UPDATE SET
                   enabled = EXCLUDED.enabled, windowMs = EXCLUDED.windowMs, maxActions = EXCLUDED.maxActions,
                   punishment = EXCLUDED.punishment, punishmentDurationMs = EXCLUDED.punishmentDurationMs,
                   whitelistUserIds = EXCLUDED.whitelistUserIds, whitelistRoleIds = EXCLUDED.whitelistRoleIds,
                   updatedAt = EXCLUDED.updatedAt`,
                vals,
            );
            return;
        }
        await db.run(
            `INSERT INTO security_antinuke_rules
             (guildId, eventKey, enabled, windowMs, maxActions, punishment, punishmentDurationMs, whitelistUserIds, whitelistRoleIds, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guildId, eventKey) DO UPDATE SET
               enabled = excluded.enabled, windowMs = excluded.windowMs, maxActions = excluded.maxActions,
               punishment = excluded.punishment, punishmentDurationMs = excluded.punishmentDurationMs,
               whitelistUserIds = excluded.whitelistUserIds, whitelistRoleIds = excluded.whitelistRoleIds,
               updatedAt = excluded.updatedAt`,
            vals,
        );
    }

    private mapAntiNuke(row: Record<string, unknown>): AntiNukeRule {
        const b = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
        const parseIds = (raw: unknown): string[] => {
            if (Array.isArray(raw)) return raw.map(String);
            if (typeof raw === 'string' && raw.trim()) {
                try {
                    const p: unknown = JSON.parse(raw);
                    if (Array.isArray(p)) return p.map(String);
                } catch { return []; }
            }
            return [];
        };
        return {
            guildId: String(row.guildId),
            eventKey: String(row.eventKey) as AntiNukeEventKey,
            enabled: b(row.enabled),
            windowMs: Number(row.windowMs ?? 10000),
            maxActions: Number(row.maxActions ?? 3),
            punishment: (String(row.punishment ?? 'stripRoles')) as AntiNukeRule['punishment'],
            punishmentDurationMs: Number(row.punishmentDurationMs ?? 600000),
            whitelistUserIds: parseIds(row.whitelistUserIds),
            whitelistRoleIds: parseIds(row.whitelistRoleIds),
            updatedAt: Number(row.updatedAt ?? Date.now()),
        };
    }

    public async getRaidSettings(guildId: string): Promise<RaidSettings | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_raid_settings').findOne({ guildId });
            if (!row) return null;
            return this.mapRaid(row);
        }
        const row = await db.get(`SELECT * FROM security_raid_settings WHERE guildId = ?`, [guildId]);
        if (!row) return null;
        return this.mapRaid(row);
    }

    public async upsertRaidSettings(settings: RaidSettings): Promise<void> {
        const db = this.db();
        const bool = (v: boolean): number => (v ? 1 : 0);
        if (db.engine === 'mongo') {
            await db.mongoCollection('security_raid_settings').updateOne(
                { guildId: settings.guildId },
                { $set: { ...settings, enabled: settings.enabled } },
                { upsert: true },
            );
            return;
        }
        const vals = [
            settings.guildId,
            bool(settings.enabled),
            settings.maxJoins,
            settings.windowMs,
            settings.action,
            settings.quarantineRoleId,
            settings.pauseVerifyMs,
            settings.joinRoleId,
            settings.updatedAt,
        ];
        const sql = db.engine === 'postgres'
            ? `INSERT INTO security_raid_settings
               (guildId, enabled, maxJoins, windowMs, action, quarantineRoleId, pauseVerifyMs, joinRoleId, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (guildId) DO UPDATE SET
                 enabled = EXCLUDED.enabled, maxJoins = EXCLUDED.maxJoins, windowMs = EXCLUDED.windowMs,
                 action = EXCLUDED.action, quarantineRoleId = EXCLUDED.quarantineRoleId,
                 pauseVerifyMs = EXCLUDED.pauseVerifyMs, joinRoleId = EXCLUDED.joinRoleId, updatedAt = EXCLUDED.updatedAt`
            : `INSERT INTO security_raid_settings
               (guildId, enabled, maxJoins, windowMs, action, quarantineRoleId, pauseVerifyMs, joinRoleId, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(guildId) DO UPDATE SET
                 enabled = excluded.enabled, maxJoins = excluded.maxJoins, windowMs = excluded.windowMs,
                 action = excluded.action, quarantineRoleId = excluded.quarantineRoleId,
                 pauseVerifyMs = excluded.pauseVerifyMs, joinRoleId = excluded.joinRoleId, updatedAt = excluded.updatedAt`;
        await db.run(sql, vals);
    }

    private mapRaid(row: Record<string, unknown>): RaidSettings {
        const b = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
        return {
            guildId: String(row.guildId),
            enabled: b(row.enabled),
            maxJoins: Number(row.maxJoins ?? 8),
            windowMs: Number(row.windowMs ?? 15000),
            action: (String(row.action ?? 'quarantine')) as RaidSettings['action'],
            quarantineRoleId: row.quarantineRoleId != null ? String(row.quarantineRoleId) : null,
            pauseVerifyMs: Number(row.pauseVerifyMs ?? 300000),
            joinRoleId: row.joinRoleId != null ? String(row.joinRoleId) : null,
            updatedAt: Number(row.updatedAt ?? Date.now()),
        };
    }

    public async getVerifySettings(guildId: string): Promise<VerifySettings | null> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const row = await db.mongoCollection('security_verify_settings').findOne({ guildId });
            if (!row) return null;
            return this.mapVerify(row);
        }
        const row = await db.get(`SELECT * FROM security_verify_settings WHERE guildId = ?`, [guildId]);
        if (!row) return null;
        return this.mapVerify(row);
    }

    public async upsertVerifySettings(settings: VerifySettings): Promise<void> {
        const db = this.db();
        const bool = (v: boolean): number => (v ? 1 : 0);
        if (db.engine === 'mongo') {
            await db.mongoCollection('security_verify_settings').updateOne(
                { guildId: settings.guildId },
                { $set: { ...settings } },
                { upsert: true },
            );
            return;
        }
        const vals = [
            settings.guildId,
            bool(settings.enabled),
            settings.verifiedRoleId,
            settings.quarantineRoleId,
            settings.maxAttempts,
            settings.challengeTtlMs,
            settings.updatedAt,
        ];
        const sql = db.engine === 'postgres'
            ? `INSERT INTO security_verify_settings
               (guildId, enabled, verifiedRoleId, quarantineRoleId, maxAttempts, challengeTtlMs, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (guildId) DO UPDATE SET
                 enabled = EXCLUDED.enabled, verifiedRoleId = EXCLUDED.verifiedRoleId,
                 quarantineRoleId = EXCLUDED.quarantineRoleId, maxAttempts = EXCLUDED.maxAttempts,
                 challengeTtlMs = EXCLUDED.challengeTtlMs, updatedAt = EXCLUDED.updatedAt`
            : `INSERT INTO security_verify_settings
               (guildId, enabled, verifiedRoleId, quarantineRoleId, maxAttempts, challengeTtlMs, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(guildId) DO UPDATE SET
                 enabled = excluded.enabled, verifiedRoleId = excluded.verifiedRoleId,
                 quarantineRoleId = excluded.quarantineRoleId, maxAttempts = excluded.maxAttempts,
                 challengeTtlMs = excluded.challengeTtlMs, updatedAt = excluded.updatedAt`;
        await db.run(sql, vals);
    }

    private mapVerify(row: Record<string, unknown>): VerifySettings {
        const b = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
        return {
            guildId: String(row.guildId),
            enabled: b(row.enabled),
            verifiedRoleId: row.verifiedRoleId != null ? String(row.verifiedRoleId) : null,
            quarantineRoleId: row.quarantineRoleId != null ? String(row.quarantineRoleId) : null,
            maxAttempts: Number(row.maxAttempts ?? 3),
            challengeTtlMs: Number(row.challengeTtlMs ?? 120000),
            updatedAt: Number(row.updatedAt ?? Date.now()),
        };
    }

    // --- Phase 6: blacklists + temp roles ---

    public async listBlacklist(guildId: string, kind?: BlacklistKind): Promise<BlacklistEntry[]> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const q: Record<string, unknown> = { guildId };
            if (kind) q.kind = kind;
            const rows = await db.mongoCollection('security_blacklists').find(q);
            return rows.map((r) => this.mapBlacklist(r));
        }
        if (kind) {
            const rows = await db.all(
                `SELECT * FROM security_blacklists WHERE guildId = ? AND kind = ? ORDER BY createdAt ASC`,
                [guildId, kind],
            );
            return rows.map((r) => this.mapBlacklist(r));
        }
        const rows = await db.all(
            `SELECT * FROM security_blacklists WHERE guildId = ? ORDER BY kind ASC, createdAt ASC`,
            [guildId],
        );
        return rows.map((r) => this.mapBlacklist(r));
    }

    public async addBlacklist(entry: BlacklistEntry): Promise<void> {
        const db = this.db();
        if (db.engine === 'mongo') {
            await db.mongoCollection('security_blacklists').updateOne(
                { id: entry.id },
                { $set: { ...entry } },
                { upsert: true },
            );
            return;
        }
        await db.run(
            `INSERT INTO security_blacklists (id, guildId, kind, pattern, createdAt, actorId)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [entry.id, entry.guildId, entry.kind, entry.pattern, entry.createdAt, entry.actorId],
        );
    }

    public async removeBlacklist(guildId: string, id: string): Promise<boolean> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const deleted = await db.mongoCollection('security_blacklists').deleteOne({ guildId, id });
            return deleted > 0;
        }
        // SqlAdapter.run returns void; verify by presence before delete.
        const existing = await db.get(
            `SELECT id FROM security_blacklists WHERE guildId = ? AND id = ?`,
            [guildId, id],
        );
        if (!existing) return false;
        await db.run(`DELETE FROM security_blacklists WHERE guildId = ? AND id = ?`, [
            guildId,
            id,
        ]);
        return true;
    }

    private mapBlacklist(row: Record<string, unknown>): BlacklistEntry {
        return {
            id: String(row.id),
            guildId: String(row.guildId),
            kind: String(row.kind) as BlacklistKind,
            pattern: String(row.pattern),
            createdAt: Number(row.createdAt ?? Date.now()),
            actorId: row.actorId != null ? String(row.actorId) : null,
        };
    }

    public async upsertTempRole(rec: TempRoleRecord): Promise<void> {
        const db = this.db();
        if (db.engine === 'mongo') {
            await db.mongoCollection('security_temp_roles').updateOne(
                { guildId: rec.guildId, userId: rec.userId, roleId: rec.roleId },
                { $set: { ...rec } },
                { upsert: true },
            );
            return;
        }
        const vals = [
            rec.guildId,
            rec.userId,
            rec.roleId,
            rec.expiresAt,
            rec.reason,
            rec.actorId,
            rec.createdAt,
        ];
        const sql =
            db.engine === 'postgres'
                ? `INSERT INTO security_temp_roles
                   (guildId, userId, roleId, expiresAt, reason, actorId, createdAt)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (guildId, userId, roleId) DO UPDATE SET
                     expiresAt = EXCLUDED.expiresAt, reason = EXCLUDED.reason,
                     actorId = EXCLUDED.actorId, createdAt = EXCLUDED.createdAt`
                : `INSERT INTO security_temp_roles
                   (guildId, userId, roleId, expiresAt, reason, actorId, createdAt)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(guildId, userId, roleId) DO UPDATE SET
                     expiresAt = excluded.expiresAt, reason = excluded.reason,
                     actorId = excluded.actorId, createdAt = excluded.createdAt`;
        await db.run(sql, vals);
    }

    public async listExpiredTempRoles(beforeMs: number): Promise<TempRoleRecord[]> {
        const db = this.db();
        if (db.engine === 'mongo') {
            const rows = await db
                .mongoCollection('security_temp_roles')
                .find({ expiresAt: { $lte: beforeMs } });
            return rows.map((r) => this.mapTempRole(r));
        }
        const rows = await db.all(
            `SELECT * FROM security_temp_roles WHERE expiresAt <= ?`,
            [beforeMs],
        );
        return rows.map((r) => this.mapTempRole(r));
    }

    public async deleteTempRole(guildId: string, userId: string, roleId: string): Promise<void> {
        const db = this.db();
        if (db.engine === 'mongo') {
            await db
                .mongoCollection('security_temp_roles')
                .deleteOne({ guildId, userId, roleId });
            return;
        }
        await db.run(
            `DELETE FROM security_temp_roles WHERE guildId = ? AND userId = ? AND roleId = ?`,
            [guildId, userId, roleId],
        );
    }

    private mapTempRole(row: Record<string, unknown>): TempRoleRecord {
        return {
            guildId: String(row.guildId),
            userId: String(row.userId),
            roleId: String(row.roleId),
            expiresAt: Number(row.expiresAt),
            reason: row.reason != null ? String(row.reason) : null,
            actorId: row.actorId != null ? String(row.actorId) : null,
            createdAt: Number(row.createdAt ?? Date.now()),
        };
    }
}
