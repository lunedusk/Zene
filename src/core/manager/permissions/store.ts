/**
 * PermissionStore — persistence port for bits + bot/server roles.
 * Domain rules (owner guards, hierarchy, resolve) stay on PermissionsManager.
 * All mongo vs SQL branching for these collections lives here.
 */
import { BUILT_IN_BITS, type BotWideRoleDoc, type PermBitDoc, type ServerRoleDoc } from '#core/types/permissions.js';
import type { SqlAdapter, Row } from '#core/database/sqlAdapter.js';

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function parseJsonArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
        try {
            const parsed: unknown = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [];
        }
    }
    return [];
}

export interface PermissionStore {
    readonly db: SqlAdapter;
    seedBuiltInBits(): Promise<void>;
    registerBit(
        bit: string,
        description: string,
        scope: PermBitDoc['scope'],
        pluginId: string | null,
    ): Promise<void>;
    listBits(scope?: 'bot' | 'server' | 'plugin'): Promise<PermBitDoc[]>;
    bitsExist(bits: string[]): Promise<boolean>;
    insertBotRole(doc: BotWideRoleDoc): Promise<void>;
    updateBotRoleRow(roleId: string, updated: BotWideRoleDoc): Promise<void>;
    deleteBotRoleRow(roleId: string): Promise<void>;
    getBotRole(roleId: string): Promise<BotWideRoleDoc | null>;
    listBotRoles(): Promise<BotWideRoleDoc[]>;
    writeBotAssigned(roleId: string, assigned: string[]): Promise<void>;
    insertServerRole(doc: ServerRoleDoc): Promise<void>;
    updateServerRoleRow(guildId: string, roleId: string, updated: ServerRoleDoc): Promise<void>;
    deleteServerRoleRow(guildId: string, roleId: string): Promise<void>;
    getServerRole(guildId: string, roleId: string): Promise<ServerRoleDoc | null>;
    listServerRoles(guildId: string): Promise<ServerRoleDoc[]>;
    listAllServerRoles(): Promise<ServerRoleDoc[]>;
    writeServerAssigned(guildId: string, roleId: string, assigned: string[]): Promise<void>;
    listServerRoleAssignmentRows(): Promise<
        Array<{ id?: string; _id?: string; guildId?: string; assignedUserIds?: unknown }>
    >;
}

export class AdapterPermissionStore implements PermissionStore {
    constructor(public readonly db: SqlAdapter) {}

    public async seedBuiltInBits(): Promise<void> {
        const at = nowSeconds();
        if (this.db.engine === 'mongo') {
            const col = this.db.mongoCollection('perm_bits');
            for (const b of BUILT_IN_BITS) {
                await col.updateOne(
                    { _id: b.bit },
                    {
                        $set: {
                            _id: b.bit,
                            id: b.bit,
                            description: b.description,
                            scope: b.scope,
                            pluginId: null,
                            builtIn: 1,
                            createdAt: at,
                        },
                    },
                    { upsert: true },
                );
            }
            return;
        }
        for (const b of BUILT_IN_BITS) {
            const excluded = this.db.engine === 'postgres' ? 'EXCLUDED' : 'excluded';
            await this.db.run(
                `INSERT INTO perm_bits (id, description, scope, pluginId, builtIn, createdAt)
                 VALUES (?, ?, ?, ?, 1, ?)
                 ON CONFLICT(id) DO UPDATE SET description = ${excluded}.description, scope = ${excluded}.scope`,
                [b.bit, b.description, b.scope, null, at],
            );
        }
    }

    public async registerBit(
        bit: string,
        description: string,
        scope: PermBitDoc['scope'],
        pluginId: string | null,
    ): Promise<void> {
        const at = nowSeconds();
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_bits').updateOne(
                { _id: bit },
                {
                    $set: {
                        _id: bit,
                        id: bit,
                        description,
                        scope,
                        pluginId,
                        builtIn: 0,
                        createdAt: at,
                    },
                },
                { upsert: true },
            );
            return;
        }
        const conflict = this.db.engine === 'postgres' ? 'EXCLUDED.description' : 'excluded.description';
        await this.db.run(
            `INSERT INTO perm_bits (id, description, scope, pluginId, builtIn, createdAt)
             VALUES (?, ?, ?, ?, 0, ?)
             ON CONFLICT(id) DO UPDATE SET description = ${conflict}`,
            [bit, description, scope, pluginId, at],
        );
    }

    public async listBits(scope?: 'bot' | 'server' | 'plugin'): Promise<PermBitDoc[]> {
        if (this.db.engine === 'mongo') {
            const filter = scope ? { scope } : {};
            const rows = await this.db.mongoCollection('perm_bits').find(filter);
            return rows.map((r) => this.rowToBit(r));
        }
        const rows = scope
            ? await this.db.all(`SELECT * FROM perm_bits WHERE scope = ? ORDER BY id`, [scope])
            : await this.db.all(`SELECT * FROM perm_bits ORDER BY id`);
        return rows.map((r) => this.rowToBit(r));
    }

    public async bitsExist(bits: string[]): Promise<boolean> {
        if (bits.length === 0) return true;
        if (this.db.engine === 'mongo') {
            const col = this.db.mongoCollection('perm_bits');
            for (const b of bits) {
                const doc = await col.findOne({ $or: [{ _id: b }, { id: b }] });
                if (!doc) return false;
            }
            return true;
        }
        const placeholders = bits.map(() => '?').join(',');
        const row = await this.db.get(
            `SELECT COUNT(*) AS cnt FROM perm_bits WHERE id IN (${placeholders})`,
            bits,
        );
        return Number(row?.cnt ?? 0) === bits.length;
    }

    public async insertBotRole(doc: BotWideRoleDoc): Promise<void> {
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_bwroles').insertOne({
                _id: doc._id,
                id: doc._id,
                name: doc.name,
                color: doc.color,
                bits: JSON.stringify(doc.bits),
                assignedUserIds: JSON.stringify(doc.assignedUserIds),
                createdAt: doc.createdAt,
                createdBy: doc.createdBy,
                updatedAt: doc.updatedAt,
            });
            return;
        }
        await this.db.run(
            `INSERT INTO perm_bwroles (id, name, color, bits, assignedUserIds, createdAt, createdBy, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                doc._id,
                doc.name,
                doc.color,
                JSON.stringify(doc.bits),
                JSON.stringify(doc.assignedUserIds),
                doc.createdAt,
                doc.createdBy,
                doc.updatedAt,
            ],
        );
    }

    public async updateBotRoleRow(roleId: string, updated: BotWideRoleDoc): Promise<void> {
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_bwroles').updateOne(
                { $or: [{ _id: roleId }, { id: roleId }] },
                {
                    $set: {
                        name: updated.name,
                        color: updated.color,
                        bits: JSON.stringify(updated.bits),
                        updatedAt: updated.updatedAt,
                    },
                },
            );
            return;
        }
        await this.db.run(
            `UPDATE perm_bwroles SET name = ?, color = ?, bits = ?, updatedAt = ? WHERE id = ?`,
            [updated.name, updated.color, JSON.stringify(updated.bits), updated.updatedAt, roleId],
        );
    }

    public async deleteBotRoleRow(roleId: string): Promise<void> {
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_bwroles').deleteOne({ $or: [{ _id: roleId }, { id: roleId }] });
            return;
        }
        await this.db.run(`DELETE FROM perm_bwroles WHERE id = ?`, [roleId]);
    }

    public async getBotRole(roleId: string): Promise<BotWideRoleDoc | null> {
        if (this.db.engine === 'mongo') {
            const row = await this.db.mongoCollection('perm_bwroles').findOne({
                $or: [{ _id: roleId }, { id: roleId }],
            });
            return row ? this.rowToBotRole(row) : null;
        }
        const row = await this.db.get(`SELECT * FROM perm_bwroles WHERE id = ?`, [roleId]);
        return row ? this.rowToBotRole(row) : null;
    }

    public async listBotRoles(): Promise<BotWideRoleDoc[]> {
        if (this.db.engine === 'mongo') {
            const rows = await this.db.mongoCollection('perm_bwroles').find({});
            return rows.map((r) => this.rowToBotRole(r));
        }
        const rows = await this.db.all(`SELECT * FROM perm_bwroles ORDER BY createdAt`);
        return rows.map((r) => this.rowToBotRole(r));
    }

    public async writeBotAssigned(roleId: string, assigned: string[]): Promise<void> {
        const at = nowSeconds();
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_bwroles').updateOne(
                { $or: [{ _id: roleId }, { id: roleId }] },
                { $set: { assignedUserIds: JSON.stringify(assigned), updatedAt: at } },
            );
            return;
        }
        await this.db.run(`UPDATE perm_bwroles SET assignedUserIds = ?, updatedAt = ? WHERE id = ?`, [
            JSON.stringify(assigned),
            at,
            roleId,
        ]);
    }

    public async insertServerRole(doc: ServerRoleDoc): Promise<void> {
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_sroles').insertOne({
                _id: doc._id,
                id: doc._id,
                guildId: doc.guildId,
                name: doc.name,
                color: doc.color,
                bits: JSON.stringify(doc.bits),
                assignedUserIds: JSON.stringify(doc.assignedUserIds),
                createdAt: doc.createdAt,
                createdBy: doc.createdBy,
                updatedAt: doc.updatedAt,
            });
            return;
        }
        await this.db.run(
            `INSERT INTO perm_sroles (id, guildId, name, color, bits, assignedUserIds, createdAt, createdBy, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                doc._id,
                doc.guildId,
                doc.name,
                doc.color,
                JSON.stringify(doc.bits),
                JSON.stringify(doc.assignedUserIds),
                doc.createdAt,
                doc.createdBy,
                doc.updatedAt,
            ],
        );
    }

    public async updateServerRoleRow(
        guildId: string,
        roleId: string,
        updated: ServerRoleDoc,
    ): Promise<void> {
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_sroles').updateOne(
                { $and: [{ $or: [{ _id: roleId }, { id: roleId }] }, { guildId }] },
                {
                    $set: {
                        name: updated.name,
                        color: updated.color,
                        bits: JSON.stringify(updated.bits),
                        updatedAt: updated.updatedAt,
                    },
                },
            );
            return;
        }
        await this.db.run(
            `UPDATE perm_sroles SET name = ?, color = ?, bits = ?, updatedAt = ? WHERE id = ? AND guildId = ?`,
            [updated.name, updated.color, JSON.stringify(updated.bits), updated.updatedAt, roleId, guildId],
        );
    }

    public async deleteServerRoleRow(guildId: string, roleId: string): Promise<void> {
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_sroles').deleteOne({
                $and: [{ $or: [{ _id: roleId }, { id: roleId }] }, { guildId }],
            });
            return;
        }
        await this.db.run(`DELETE FROM perm_sroles WHERE id = ? AND guildId = ?`, [roleId, guildId]);
    }

    public async getServerRole(guildId: string, roleId: string): Promise<ServerRoleDoc | null> {
        if (this.db.engine === 'mongo') {
            const row = await this.db.mongoCollection('perm_sroles').findOne({
                $and: [{ $or: [{ _id: roleId }, { id: roleId }] }, { guildId }],
            });
            return row ? this.rowToServerRole(row) : null;
        }
        const row = await this.db.get(`SELECT * FROM perm_sroles WHERE id = ? AND guildId = ?`, [
            roleId,
            guildId,
        ]);
        return row ? this.rowToServerRole(row) : null;
    }

    public async listServerRoles(guildId: string): Promise<ServerRoleDoc[]> {
        if (this.db.engine === 'mongo') {
            const rows = await this.db.mongoCollection('perm_sroles').find({ guildId });
            return rows.map((r) => this.rowToServerRole(r));
        }
        const rows = await this.db.all(
            `SELECT * FROM perm_sroles WHERE guildId = ? ORDER BY createdAt`,
            [guildId],
        );
        return rows.map((r) => this.rowToServerRole(r));
    }

    public async listAllServerRoles(): Promise<ServerRoleDoc[]> {
        if (this.db.engine === 'mongo') {
            const rows = await this.db.mongoCollection('perm_sroles').find({});
            return rows.map((r) => this.rowToServerRole(r));
        }
        const rows = await this.db.all(`SELECT * FROM perm_sroles ORDER BY guildId, createdAt`);
        return rows.map((r) => this.rowToServerRole(r));
    }

    public async writeServerAssigned(
        guildId: string,
        roleId: string,
        assigned: string[],
    ): Promise<void> {
        const at = nowSeconds();
        if (this.db.engine === 'mongo') {
            await this.db.mongoCollection('perm_sroles').updateOne(
                { $and: [{ $or: [{ _id: roleId }, { id: roleId }] }, { guildId }] },
                { $set: { assignedUserIds: JSON.stringify(assigned), updatedAt: at } },
            );
            return;
        }
        await this.db.run(
            `UPDATE perm_sroles SET assignedUserIds = ?, updatedAt = ? WHERE id = ? AND guildId = ?`,
            [JSON.stringify(assigned), at, roleId, guildId],
        );
    }

    public async listServerRoleAssignmentRows(): Promise<
        Array<{ id?: string; _id?: string; guildId?: string; assignedUserIds?: unknown }>
    > {
        if (this.db.engine === 'mongo') {
            return (await this.db.mongoCollection('perm_sroles').find({})) as Array<{
                id?: string;
                _id?: string;
                guildId?: string;
                assignedUserIds?: unknown;
            }>;
        }
        return (await this.db.all(`SELECT id, guildId, assignedUserIds FROM perm_sroles`)) as Array<{
            id?: string;
            _id?: string;
            guildId?: string;
            assignedUserIds?: unknown;
        }>;
    }

    private rowToBit(r: Row): PermBitDoc {
        return {
            _id: String(r.id ?? r._id),
            description: String(r.description),
            scope: r.scope as PermBitDoc['scope'],
            pluginId: r.pluginId != null ? String(r.pluginId) : undefined,
            builtIn: !!r.builtIn,
            createdAt: Number(r.createdAt),
        };
    }

    private rowToBotRole(r: Row): BotWideRoleDoc {
        return {
            _id: String(r.id ?? r._id),
            name: String(r.name),
            color: String(r.color),
            bits: parseJsonArray(r.bits),
            assignedUserIds: parseJsonArray(r.assignedUserIds),
            createdAt: Number(r.createdAt),
            createdBy: String(r.createdBy),
            updatedAt: Number(r.updatedAt),
        };
    }

    private rowToServerRole(r: Row): ServerRoleDoc {
        return {
            _id: String(r.id ?? r._id),
            guildId: String(r.guildId),
            name: String(r.name),
            color: String(r.color),
            bits: parseJsonArray(r.bits),
            assignedUserIds: parseJsonArray(r.assignedUserIds),
            createdAt: Number(r.createdAt),
            createdBy: String(r.createdBy),
            updatedAt: Number(r.updatedAt),
        };
    }
}
