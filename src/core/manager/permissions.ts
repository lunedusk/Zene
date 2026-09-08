import { randomUUID } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';
import { audit } from '#core/audit/index.js';
import { secrets } from '#core/helpers/secretManager.js';
import { configManager } from '#core/manager/config.js';
import {
    OWNER_BIT,
    BOT_PROTECTED_BIT,
    SERVER_PROTECTED_BIT,
    bitsIncludeOwner,
    bitsIncludeBotProtected,
    bitsIncludeServerProtected,
    envOwnerIds,
    isEnvOwner,
} from '#core/manager/permissions/guards.js';
import {
    PermissionError,
    BUILT_IN_BITS,
    type PermBitDoc,
    type BotWideRoleDoc,
    type ServerRoleDoc,
    type ResolvedPermissions,
    type PermissionCheckResult,
    type CreateBotRoleInput,
    type CreateServerRoleInput,
} from '#core/types/permissions.js';
import {
    PermissionsBitField,
    type Interaction,
    type GuildMember,
    type APIInteractionGuildMember,
    type PermissionResolvable,
} from 'discord.js';
import type { Request, Response, NextFunction } from 'express';
import type { PermissionCache } from '#core/manager/permissionCache.js';
import { resolvePermissionsBackend } from '#core/database/backendSelector.js';
import { openSqlAdapter, type SqlAdapter, type Row } from '#core/database/sqlAdapter.js';
import { AdapterPermissionStore, type PermissionStore } from '#core/manager/permissions/store.js';

const log = getLogger('PermissionsManager');

const ALL_BOT_BITS = BUILT_IN_BITS.filter(b => b.scope === 'bot').map(b => b.bit);

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function parseJsonArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}


function assertCanMutateOwnerBit(
    actorUserId: string | null | undefined,
    bits: string[] | undefined | null,
    action: string,
    target: string,
): void {
    if (!bitsIncludeOwner(bits)) return;
    if (isEnvOwner(actorUserId)) return;
    void audit.record({
        actorType: actorUserId ? 'user' : 'api_key',
        actorId: actorUserId ?? 'api_key',
        action,
        target,
        outcome: 'fail',
        reason: 'FORBIDDEN',
        meta: { bit: OWNER_BIT },
    });
    throw new PermissionError(
        'FORBIDDEN',
        'Only BotOwnerIds (env) Discord users may create, modify, assign, revoke, or delete roles that include bot.owner. API keys cannot perform these mutations.',
    );
}

export interface RouteAccessConfig {
    permissionLevel?: string;
    roleIds?: string[];
    userIds?: string[];
    userPermissions?: import('discord.js').PermissionResolvable[];
    clientPermissions?: import('discord.js').PermissionResolvable[];
    allowInDm?: boolean;
    denyMessage?: string;
    devOnly?: boolean;
    serverBit?: string | string[];
    require?: string | string[] | ((resolved: ResolvedPermissions) => boolean);
    requireAll?: string[];
    requireAny?: string[];
    denyIf?: string | string[];
    denyIfAny?: string | string[];
}

export type CommandBuilderLike = {
    setDefaultMemberPermissions(rights: bigint | string | number | null | undefined): unknown;
    setDMPermission(enabled: boolean | null | undefined): unknown;
};

export interface PermissionLevelConfig {
    roleIds?: string[];
    userIds?: string[];
    discordPermissions?: import('discord.js').PermissionResolvable[];
    denyMessage?: string;
}

export interface PermissionsConfigShape {
    enabled?: boolean;
    defaultLevel?: string;
    levels?: Record<string, PermissionLevelConfig>;
    httpRoutes?: HttpRouteAccessConfig[];
}

export interface HttpRouteAccessConfig {
    method: string;
    path: string;
    bits?: string[];
    bitsMode?: 'all' | 'any';
    public?: boolean;
    denyMessage?: string;
}

export class PermissionsManager {
    private store!: PermissionStore;
    private cache?: PermissionCache;

    /** Adapter surface for role-link helpers that still take SqlAdapter */
    private get db(): SqlAdapter {
        return this.store.db;
    }

    constructor() {}

    public setCache(cache: PermissionCache): void {
        this.cache = cache;
    }

    public async init(cfg?: { engine?: string | null; alias?: string | null }): Promise<void> {
        const choice = resolvePermissionsBackend(cfg);
        this.store = new AdapterPermissionStore(openSqlAdapter(choice));

        await this.store.seedBuiltInBits();
        const { ensureRoleLinkSchema, migrateLegacyAssignedAsDirect } = await import(
            '#core/manager/permissionRoleLinks.js'
        );
        await ensureRoleLinkSchema(this.db);
        const { ensureMirrorSchema } = await import('#core/permissions/discordMirror.js');
        await ensureMirrorSchema(this.db);
        try {
            const botRoles = await this.listBotRoles();
            const serverRows = await this.store.listServerRoleAssignmentRows();
            await migrateLegacyAssignedAsDirect(this.db, [
                ...botRoles.map((r) => ({
                    roleId: r._id,
                    guildId: null as string | null,
                    userIds: r.assignedUserIds,
                })),
                ...serverRows.map((row) => {
                    const r = row as {
                        id?: string;
                        _id?: string;
                        guildId?: string;
                        assignedUserIds?: unknown;
                    };
                    return {
                        roleId: String(r._id ?? r.id ?? ''),
                        guildId: String(r.guildId ?? ''),
                        userIds: Array.isArray(r.assignedUserIds)
                            ? r.assignedUserIds.map(String)
                            : (() => {
                                  try {
                                      const parsed = JSON.parse(String(r.assignedUserIds ?? '[]'));
                                      return Array.isArray(parsed) ? parsed.map(String) : [];
                                  } catch {
                                      return [] as string[];
                                  }
                              })(),
                    };
                }),
            ]);
        } catch (err) {
            log.warn(`Legacy grant migration skipped: ${(err as Error).message}`);
        }
        await this.warnPreexistingOwnerRoles();
        log.info(`PermissionsManager initialized (engine=${choice.engine}, alias=${choice.alias}).`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('permissions.ready', { engine: choice.engine, alias: choice.alias }))
            .catch(() => undefined);

    }

    private async warnPreexistingOwnerRoles(): Promise<void> {
        try {
            const roles = await this.listBotRoles();
            const hits = roles.filter((r) => bitsIncludeOwner(r.bits));
            if (hits.length === 0) return;
            log.warn(
                `Found ${hits.length} bot-wide role(s) carrying bot.owner (pre-existing). They are active for resolve; only BotOwnerIds may mutate them: ${hits.map((r) => r._id).join(', ')}`,
            );
        } catch (err) {
            log.warn(`Owner-role boot scan failed: ${(err as Error).message}`);
        }
    }

    public applyCommandDefaults(data: CommandBuilderLike, config: RouteAccessConfig | null | undefined): void {
        if (!config) return;
        if (config.userPermissions && config.userPermissions.length > 0) {
            const bits = new PermissionsBitField(config.userPermissions);
            data.setDefaultMemberPermissions(bits.bitfield);
        }
        if (typeof config.allowInDm === 'boolean') {
            data.setDMPermission(config.allowInDm);
        }
    }

    public resolveHttpRouteAccess(method: string, path: string): HttpRouteAccessConfig | null {
        const permConfig = configManager.get<PermissionsConfigShape | undefined>('permissions');
        const routeConfigs: HttpRouteAccessConfig[] = Array.isArray(permConfig?.httpRoutes)
            ? permConfig.httpRoutes
            : [];
        const normalizedMethod = method.toUpperCase();
        const normalizedPath = this.normalizeHttpPath(path.split('?')[0] ?? path);
        for (const route of routeConfigs) {
            const routeMethod = String(route.method ?? '').toUpperCase();
            if (routeMethod !== '*' && routeMethod !== normalizedMethod) continue;
            if (this.matchesHttpRoute(route.path, normalizedPath)) {
                return route;
            }
        }
        return null;
    }

    private normalizeHttpPath(path: string): string {
        if (!path) return '/';
        if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
        return path;
    }

    private matchesHttpRoute(template: string, actualPath: string): boolean {
        if (!template) return false;
        const normalizedTemplate = this.normalizeHttpPath(template);
        if (normalizedTemplate === actualPath) return true;
        const escaped = normalizedTemplate
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/:([A-Za-z0-9_]+)/g, '[^/]+')
            .replace(/\\\*/g, '.*');
        return new RegExp(`^${escaped}$`).test(actualPath);
    }

    public async registerBit(
        bit: string,
        description: string,
        pluginId?: string,
        rank?: number,
    ): Promise<void> {
        const scope: PermBitDoc['scope'] = bit.startsWith('bot.')
            ? 'bot'
            : bit.startsWith('server.')
              ? 'server'
              : 'plugin';
        if (typeof rank === 'number' && Number.isFinite(rank)) {
            const { setBitRank } = await import('#core/types/permissions.js');
            setBitRank(bit, rank);
        }
        await this.store.registerBit(bit, description, scope, pluginId ?? null);
    }

    public async listBits(scope?: 'bot' | 'server' | 'plugin'): Promise<PermBitDoc[]> {
        return this.store.listBits(scope);
    }

    private async bitsExist(bits: string[]): Promise<boolean> {
        return this.store.bitsExist(bits);
    }

    private async assertCanMutateBotProtectedBit(
        actorUserId: string | null | undefined,
        bits: string[] | undefined | null,
        action: string,
        target: string,
    ): Promise<void> {
        if (!bitsIncludeBotProtected(bits)) return;
        if (bitsIncludeOwner(bits)) {
            assertCanMutateOwnerBit(actorUserId, bits, action, target);
            return;
        }
        if (!actorUserId) {
            throw new PermissionError(
                'FORBIDDEN',
                'Only users with bot.owner may create, modify, assign, or revoke roles that include bot.protected.',
            );
        }
        if (isEnvOwner(actorUserId)) return;
        const resolved = await this.resolve(actorUserId);
        if (resolved.botOwner || resolved.bits.has(OWNER_BIT)) return;
        void audit.record({
            actorType: 'user',
            actorId: actorUserId,
            action,
            target,
            outcome: 'fail',
            reason: 'FORBIDDEN',
            meta: { bit: BOT_PROTECTED_BIT },
        });
        throw new PermissionError(
            'FORBIDDEN',
            'Only users with bot.owner may create, modify, assign, or revoke roles that include bot.protected.',
        );
    }

    private async assertCanMutateServerProtectedBit(
        actorUserId: string | null | undefined,
        guildId: string,
        bits: string[] | undefined | null,
        action: string,
        target: string,
    ): Promise<void> {
        if (!bitsIncludeServerProtected(bits)) return;
        if (!actorUserId) {
            throw new PermissionError(
                'FORBIDDEN',
                'Only server.owner (or bot.owner) may manage roles that include server.protected.',
            );
        }
        const resolved = await this.resolve(actorUserId, guildId);
        if (resolved.bits.has('server.owner')) return;
        if (resolved.botOwner || resolved.bits.has(OWNER_BIT) || isEnvOwner(actorUserId)) return;
        void audit.record({
            actorType: 'user',
            actorId: actorUserId,
            action,
            target,
            outcome: 'fail',
            reason: 'FORBIDDEN',
            meta: { bit: SERVER_PROTECTED_BIT, guildId },
        });
        throw new PermissionError(
            'FORBIDDEN',
            'Only server.owner (or bot.owner) may manage roles that include server.protected.',
        );
    }

    private async assertActorHoldsRoleBits(
        actorUserId: string | null | undefined,
        bits: string[] | undefined | null,
        guildId?: string,
    ): Promise<void> {
        if (!bits || bits.length === 0) return;
        if (!actorUserId) {
            throw new PermissionError(
                'FORBIDDEN',
                'API keys cannot grant permission bits onto roles without a Discord actor context.',
            );
        }
        const { actorHoldsAllBits } = await import('#core/permissions/hierarchy.js');
        const resolved = await this.resolve(actorUserId, guildId);
        const check = actorHoldsAllBits(actorUserId, resolved, bits);
        if (!check.ok) {
            let detail = `You cannot place bits you do not hold on a role. Missing: ${check.missing.join(', ')}`;
            try {
                const { coreErrorMessage } = await import('#plugins/core/src/lib/coreErrors.js');
                detail = coreErrorMessage('ROLE_BITS_MISSING', { missing: check.missing.join(', ') });
            } catch {
                
            }
            throw new PermissionError('FORBIDDEN', detail);
        }
        for (const b of bits) {
            if (b.startsWith('bot.') && guildId) {
                throw new PermissionError(
                    'INVALID_SCOPE',
                    `Bot-scoped bit "${b}" cannot be attached to a server role.`,
                );
            }
        }
    }

    public async canActOnMember(
        actorUserId: string,
        targetUserId: string,
        guildId?: string,
        discordGuildOwnerId?: string,
    ): Promise<import('#core/permissions/hierarchy.js').HierarchyDecision> {
        const { canActOnMember } = await import('#core/permissions/hierarchy.js');
        const actor = await this.resolve(actorUserId, guildId, discordGuildOwnerId);
        const target = await this.resolve(targetUserId, guildId, discordGuildOwnerId);
        return canActOnMember({
            actorUserId,
            targetUserId,
            actor,
            target,
            scope: guildId ? 'any' : 'bot',
        });
    }

    public async createBotRole(
        data: CreateBotRoleInput,
        actorUserId?: string | null,
    ): Promise<BotWideRoleDoc> {
        assertCanMutateOwnerBit(actorUserId, data.bits, 'perm.role.create', 'bot-role');
        await this.assertCanMutateBotProtectedBit(actorUserId, data.bits, 'perm.role.create', 'bot-role');
        await this.assertActorHoldsRoleBits(actorUserId, data.bits);
        if (!(await this.bitsExist(data.bits))) {
            throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
        }
        const doc: BotWideRoleDoc = {
            _id: `bwrole_${randomUUID()}`,
            name: data.name,
            color: data.color,
            bits: data.bits,
            assignedUserIds: [],
            createdAt: nowSeconds(),
            createdBy: data.createdBy,
            updatedAt: nowSeconds(),
        };
        await this.store.insertBotRole(doc);
        if (bitsIncludeOwner(doc.bits)) {
            void audit.record({
                actorType: actorUserId ? 'user' : 'api_key',
                actorId: actorUserId ?? 'api_key',
                action: 'perm.role.create',
                target: doc._id,
                outcome: 'success',
                meta: { bit: OWNER_BIT, name: doc.name },
            });
        }
        return doc;
    }

    public async updateBotRole(
        roleId: string,
        data: Partial<CreateBotRoleInput>,
        actorUserId?: string | null,
    ): Promise<BotWideRoleDoc> {
        const existing = await this.getBotRole(roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Bot role ${roleId} not found.`);
        const nextBits = data.bits ?? existing.bits;
        const involves =
            bitsIncludeOwner(existing.bits) ||
            bitsIncludeOwner(data.bits) ||
            (Array.isArray(data.bits) && bitsIncludeOwner(nextBits));
        assertCanMutateOwnerBit(actorUserId, [...(existing.bits ?? []), ...(data.bits ?? [])], 'perm.role.update', roleId);
        await this.assertCanMutateBotProtectedBit(actorUserId, [...(existing.bits ?? []), ...(data.bits ?? [])], 'perm.role.update', roleId);
        if (data.bits) {
            await this.assertActorHoldsRoleBits(actorUserId, data.bits);
        }
        if (data.bits) {
            if (!(await this.bitsExist(data.bits))) {
                throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
            }
        }
        const updated: BotWideRoleDoc = {
            ...existing,
            ...data,
            bits: data.bits ?? existing.bits,
            updatedAt: nowSeconds(),
        };
        await this.store.updateBotRoleRow(roleId, updated);
        if (involves) {
            void audit.record({
                actorType: actorUserId ? 'user' : 'api_key',
                actorId: actorUserId ?? 'api_key',
                action: 'perm.role.update',
                target: roleId,
                outcome: 'success',
                meta: { bit: OWNER_BIT },
            });
        }
        return updated;
    }

    public async deleteBotRole(roleId: string, actorUserId?: string | null): Promise<void> {
        const existing = await this.getBotRole(roleId);
        assertCanMutateOwnerBit(actorUserId, existing?.bits, 'perm.role.delete', roleId);
        await this.assertCanMutateBotProtectedBit(actorUserId, existing?.bits, 'perm.role.delete', roleId);
        await this.store.deleteBotRoleRow(roleId);
        if (existing) {
            await Promise.all(existing.assignedUserIds.map((uid) => this.invalidateUserCache(uid)));
            if (bitsIncludeOwner(existing.bits)) {
                void audit.record({
                    actorType: actorUserId ? 'user' : 'api_key',
                    actorId: actorUserId ?? 'api_key',
                    action: 'perm.role.delete',
                    target: roleId,
                    outcome: 'success',
                    meta: { bit: OWNER_BIT },
                });
            }
        }
    }

    private async getBotRole(roleId: string): Promise<BotWideRoleDoc | null> {
        return this.store.getBotRole(roleId);
    }

    public async listBotRoles(): Promise<BotWideRoleDoc[]> {
        return this.store.listBotRoles();
    }

    public async assignBotRole(
        roleId: string,
        userIds: string[],
        actorUserId?: string | null,
    ): Promise<void> {
        const existing = await this.getBotRole(roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Bot role ${roleId} not found.`);
        assertCanMutateOwnerBit(actorUserId, existing.bits, 'perm.role.assign', roleId);
        await this.assertCanMutateBotProtectedBit(actorUserId, existing.bits, 'perm.role.assign', roleId);
        const { upsertGrant } = await import('#core/manager/permissionRoleLinks.js');
        for (const uid of userIds) {
            await upsertGrant(this.db, {
                userId: uid,
                permRoleId: roleId,
                guildId: null,
                source: 'direct',
                discordRoleId: null,
            });
        }
        const merged = Array.from(new Set([...existing.assignedUserIds, ...userIds]));
        await this.writeBotAssigned(roleId, merged);
        await Promise.all(userIds.map((uid) => this.invalidateUserCache(uid)));
        if (bitsIncludeOwner(existing.bits)) {
            void audit.record({
                actorType: actorUserId ? 'user' : 'api_key',
                actorId: actorUserId ?? 'api_key',
                action: 'perm.role.assign',
                target: roleId,
                outcome: 'success',
                meta: { bit: OWNER_BIT, count: userIds.length },
            });
        }
    }

    public async revokeBotRole(
        roleId: string,
        userIds: string[],
        actorUserId?: string | null,
    ): Promise<void> {
        const existing = await this.getBotRole(roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Bot role ${roleId} not found.`);
        assertCanMutateOwnerBit(actorUserId, existing.bits, 'perm.role.revoke', roleId);
        await this.assertCanMutateBotProtectedBit(actorUserId, existing.bits, 'perm.role.revoke', roleId);
        const { deleteGrants, userHasAnyGrant } = await import('#core/manager/permissionRoleLinks.js');
        const remaining = [...existing.assignedUserIds];
        for (const uid of userIds) {
            await deleteGrants(this.db, {
                userId: uid,
                permRoleId: roleId,
                guildId: null,
                source: 'direct',
            });
            const still = await userHasAnyGrant(this.db, uid, roleId, null);
            if (!still) {
                const idx = remaining.indexOf(uid);
                if (idx >= 0) remaining.splice(idx, 1);
            }
        }
        await this.writeBotAssigned(roleId, remaining);
        await Promise.all(userIds.map((uid) => this.invalidateUserCache(uid)));
        if (bitsIncludeOwner(existing.bits)) {
            void audit.record({
                actorType: actorUserId ? 'user' : 'api_key',
                actorId: actorUserId ?? 'api_key',
                action: 'perm.role.revoke',
                target: roleId,
                outcome: 'success',
                meta: { bit: OWNER_BIT, count: userIds.length },
            });
        }
    }

    private async writeBotAssigned(roleId: string, assigned: string[]): Promise<void> {
        await this.store.writeBotAssigned(roleId, assigned);
    }

    private assertServerScopedBits(bits: string[]): void {
        const offender = bits.find((b) => !(b.startsWith('server.') || b.startsWith('plugin.')));
        if (offender) {
            throw new PermissionError(
                'INVALID_SCOPE',
                `Server roles cannot contain bot-scoped bit "${offender}".`,
            );
        }
    }

    public async createServerRole(guildId: string, data: CreateServerRoleInput, actorUserId?: string | null): Promise<ServerRoleDoc> {
        this.assertServerScopedBits(data.bits);
        await this.assertCanMutateServerProtectedBit(actorUserId, guildId, data.bits, 'perm.srole.create', guildId);
        await this.assertActorHoldsRoleBits(actorUserId, data.bits, guildId);
        if (!(await this.bitsExist(data.bits))) {
            throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
        }
        const doc: ServerRoleDoc = {
            _id: `srole_${guildId}_${randomUUID()}`,
            guildId,
            name: data.name,
            color: data.color,
            bits: data.bits,
            assignedUserIds: [],
            createdAt: nowSeconds(),
            createdBy: data.createdBy,
            updatedAt: nowSeconds(),
        };
        await this.store.insertServerRole(doc);
        return doc;
    }

    public async updateServerRole(
        guildId: string,
        roleId: string,
        data: Partial<CreateServerRoleInput>,
        actorUserId?: string | null,
    ): Promise<ServerRoleDoc> {
        const existing = await this.getServerRole(guildId, roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Server role ${roleId} not found.`);
        if (data.bits) {
            this.assertServerScopedBits(data.bits);
            await this.assertCanMutateServerProtectedBit(
                actorUserId ?? data.createdBy ?? null,
                guildId,
                [...existing.bits, ...data.bits],
                'perm.srole.update',
                roleId,
            );
            await this.assertActorHoldsRoleBits(actorUserId ?? data.createdBy ?? null, data.bits, guildId);
            if (!(await this.bitsExist(data.bits))) {
                throw new PermissionError('INVALID_BIT', 'One or more bits do not exist in the catalogue.');
            }
        }
        const updated: ServerRoleDoc = {
            ...existing,
            ...data,
            bits: data.bits ?? existing.bits,
            updatedAt: nowSeconds(),
        };
        await this.store.updateServerRoleRow(guildId, roleId, updated);
        return updated;
    }

    public async deleteServerRole(guildId: string, roleId: string): Promise<void> {
        const existing = await this.getServerRole(guildId, roleId);
        await this.store.deleteServerRoleRow(guildId, roleId);
        if (existing) {
            await Promise.all(existing.assignedUserIds.map((uid) => this.invalidateUserCache(uid, guildId)));
        }
    }

    private async getServerRole(guildId: string, roleId: string): Promise<ServerRoleDoc | null> {
        return this.store.getServerRole(guildId, roleId);
    }

    public async listServerRoles(guildId: string): Promise<ServerRoleDoc[]> {
        return this.store.listServerRoles(guildId);
    }

    public async listAllServerRoles(): Promise<ServerRoleDoc[]> {
        return this.store.listAllServerRoles();
    }

    public async findHoldersOfBit(bit: string): Promise<{
        botWide: string[];
        byGuild: Map<string, string[]>;
    }> {
        const botWide = new Set<string>();
        const byGuild = new Map<string, Set<string>>();

        const botRoles = await this.listBotRoles();
        for (const role of botRoles) {
            if (!role.bits.includes(bit)) continue;
            for (const uid of role.assignedUserIds) botWide.add(uid);
        }

        const serverRoles = await this.listAllServerRoles();
        for (const role of serverRoles) {
            if (!role.bits.includes(bit)) continue;
            let set = byGuild.get(role.guildId);
            if (!set) {
                set = new Set<string>();
                byGuild.set(role.guildId, set);
            }
            for (const uid of role.assignedUserIds) set.add(uid);
        }

        const byGuildOut = new Map<string, string[]>();
        for (const [gid, set] of byGuild) {
            byGuildOut.set(gid, [...set].sort());
        }
        return { botWide: [...botWide].sort(), byGuild: byGuildOut };
    }

    public async assignServerRole(guildId: string, roleId: string, userIds: string[]): Promise<void> {
        const existing = await this.getServerRole(guildId, roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Server role ${roleId} not found.`);
        const { upsertGrant } = await import('#core/manager/permissionRoleLinks.js');
        for (const uid of userIds) {
            await upsertGrant(this.db, {
                userId: uid,
                permRoleId: roleId,
                guildId,
                source: 'direct',
                discordRoleId: null,
            });
        }
        const merged = Array.from(new Set([...existing.assignedUserIds, ...userIds]));
        await this.writeServerAssigned(guildId, roleId, merged);
        await Promise.all(userIds.map((uid) => this.invalidateUserCache(uid, guildId)));
    }

    public async revokeServerRole(guildId: string, roleId: string, userIds: string[]): Promise<void> {
        const existing = await this.getServerRole(guildId, roleId);
        if (!existing) throw new PermissionError('INVALID_BIT', `Server role ${roleId} not found.`);
        const { deleteGrants, userHasAnyGrant } = await import('#core/manager/permissionRoleLinks.js');
        const remaining = [...existing.assignedUserIds];
        for (const uid of userIds) {
            await deleteGrants(this.db, {
                userId: uid,
                permRoleId: roleId,
                guildId,
                source: 'direct',
            });
            const still = await userHasAnyGrant(this.db, uid, roleId, guildId);
            if (!still) {
                const idx = remaining.indexOf(uid);
                if (idx >= 0) remaining.splice(idx, 1);
            }
        }
        await this.writeServerAssigned(guildId, roleId, remaining);
        await Promise.all(userIds.map((uid) => this.invalidateUserCache(uid, guildId)));
    }

    private async writeServerAssigned(guildId: string, roleId: string, assigned: string[]): Promise<void> {
        await this.store.writeServerAssigned(guildId, roleId, assigned);
    }

    public async resolve(
        userId: string,
        guildId?: string,
        discordGuildOwnerId?: string,
    ): Promise<ResolvedPermissions> {
        const ownerIdsRaw = secrets.getOptional('BotOwnerIds', '') ?? '';
        const ownerIds = ownerIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);

        if (ownerIds.includes(userId)) {
            return {
                botOwner: true,
                bits: new Set(ALL_BOT_BITS),
                guildId,
                resolvedAt: nowSeconds(),
            };
        }

        const effectiveBits = new Set<string>();

        const botRoles = await this.store.listBotRoles();
        for (const role of botRoles) {
            if (role.assignedUserIds.includes(userId)) {
                for (const bit of role.bits) effectiveBits.add(bit);
            }
        }
        if (guildId) {
            if (discordGuildOwnerId && discordGuildOwnerId === userId) {
                effectiveBits.add('server.owner');
            }
            const serverRoles = await this.store.listServerRoles(guildId);
            for (const role of serverRoles) {
                if (role.assignedUserIds.includes(userId)) {
                    for (const bit of role.bits) effectiveBits.add(bit);
                }
            }
        }

        if (effectiveBits.has(OWNER_BIT)) {
            return {
                botOwner: true,
                bits: new Set(ALL_BOT_BITS),
                guildId,
                resolvedAt: nowSeconds(),
            };
        }

        return {
            botOwner: false,
            bits: effectiveBits,
            guildId,
            resolvedAt: nowSeconds(),
        };
    }

    public async cachedResolve(
        userId: string,
        guildId?: string,
        discordGuildOwnerId?: string,
    ): Promise<ResolvedPermissions> {
        if (this.cache) {
            return this.cache.cachedResolve(userId, guildId, discordGuildOwnerId);
        }
        return this.resolve(userId, guildId, discordGuildOwnerId);
    }

    public async hasBit(userId: string, bit: string, guildId?: string): Promise<boolean> {
        const resolved = await this.cachedResolve(userId, guildId);
        return resolved.botOwner || resolved.bits.has(bit);
    }

    public async hasAllBits(userId: string, bits: string[], guildId?: string): Promise<boolean> {
        const resolved = await this.cachedResolve(userId, guildId);
        if (resolved.botOwner) return true;
        return bits.every((b) => resolved.bits.has(b));
    }

    public async hasAnyBit(userId: string, bits: string[], guildId?: string): Promise<boolean> {
        const resolved = await this.cachedResolve(userId, guildId);
        if (resolved.botOwner) return true;
        return bits.some((b) => resolved.bits.has(b));
    }

    public async requireBit(userId: string, bit: string, guildId?: string): Promise<void> {
        if (!(await this.hasBit(userId, bit, guildId))) {
            throw new PermissionError('MISSING_BIT', `User ${userId} is missing required bit "${bit}".`);
        }
    }

    public async canExecute(interaction: Interaction, access?: RouteAccessConfig | null): Promise<PermissionCheckResult> {
            if (!access) {
                return { allowed: true, reason: '', ephemeral: false };
            }

            try {
                const userId = interaction.user.id;
                const guildId = interaction.guildId ?? undefined;
                const discordGuildOwnerId = interaction.guild?.ownerId;
                                let resolved = await this.cachedResolve(userId, guildId, discordGuildOwnerId);
                if (guildId && interaction.memberPermissions) {
                    const bits = new Set(resolved.bits);
                    await this.applyDiscordMirrorBits(bits, guildId, interaction.memberPermissions);
                    resolved = { ...resolved, bits };
                }
 if (resolved.botOwner) {
                    return { allowed: true, reason: '', ephemeral: false };
                }

                const denyMsg = access.denyMessage ?? 'You do not have permission to do this.';

                if (access.devOnly) {
                    return { allowed: false, reason: denyMsg, ephemeral: true };
                }

                if (access.userIds && access.userIds.length > 0) {
                    if (!access.userIds.includes(userId)) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                const needsGuild = ((access.roleIds?.length ?? 0) > 0)
                    || ((access.userPermissions?.length ?? 0) > 0)
                    || ((access.clientPermissions?.length ?? 0) > 0)
                    || Boolean(access.serverBit);

                if (!guildId) {
                    const allowDm = access.allowInDm ?? !needsGuild;
                    if (!allowDm) {
                        return {
                            allowed: false,
                            reason: access.denyMessage ?? 'This action is not available in DMs.',
                            ephemeral: true,
                        };
                    }
                }

                if (guildId && access.roleIds && access.roleIds.length > 0) {
                    const member = interaction.guild?.members?.cache.get(userId)
                        ?? interaction.member ?? undefined;

                    if (member) {
                        const roles = member.roles;
                        const memberRoles: string[] =
                            roles && typeof roles === 'object' && 'cache' in roles
                                ? Array.from((roles as GuildMember['roles']).cache.keys())
                                : Array.isArray(roles)
                                  ? roles.map(String)
                                  : [];

                        const hasRole = access.roleIds.some((rid: string) => memberRoles.includes(rid));
                        if (!hasRole) {
                            return { allowed: false, reason: denyMsg, ephemeral: true };
                        }
                    }
                }

                if (guildId && access.userPermissions && access.userPermissions.length > 0) {
                    const memberPerms = interaction.memberPermissions ?? null;
                    if (memberPerms) {
                        const required = new PermissionsBitField(access.userPermissions);
                        if (!memberPerms.has(required)) {
                            return { allowed: false, reason: denyMsg, ephemeral: true };
                        }
                    }
                }

                if (guildId && access.clientPermissions && access.clientPermissions.length > 0) {
                    const appPerms = interaction.appPermissions ?? null;
                    if (appPerms) {
                        const required = new PermissionsBitField(access.clientPermissions);
                        if (!appPerms.has(required)) {
                            return {
                                allowed: false,
                                reason: 'I lack the required permissions to execute this action.',
                                ephemeral: true,
                            };
                        }
                    }
                }

                if (access.permissionLevel) {
                    const levelAllowed = await this.checkPermissionLevel(
                        access.permissionLevel, userId, interaction
                    );
                    if (!levelAllowed.allowed) {
                        return levelAllowed;
                    }
                }

                if (access.serverBit) {
                    const bits = Array.isArray(access.serverBit) ? access.serverBit : [access.serverBit];
                    const hasBits = bits.every((b: string) => resolved.bits.has(b));
                    if (!hasBits) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                const denyIfBits = access.denyIf
                    ? Array.isArray(access.denyIf)
                        ? access.denyIf
                        : [access.denyIf]
                    : [];
                if (denyIfBits.length > 0 && denyIfBits.every((b) => resolved.bits.has(b))) {
                    return { allowed: false, reason: denyMsg, ephemeral: true };
                }

                const denyIfAnyBits = access.denyIfAny
                    ? Array.isArray(access.denyIfAny)
                        ? access.denyIfAny
                        : [access.denyIfAny]
                    : [];
                if (denyIfAnyBits.length > 0 && denyIfAnyBits.some((b) => resolved.bits.has(b))) {
                    return { allowed: false, reason: denyMsg, ephemeral: true };
                }

                if (access.require) {
                    let requirePassed: boolean;
                    if (typeof access.require === 'function') {
                        requirePassed = access.require(resolved);
                    } else {
                        const bits = Array.isArray(access.require) ? access.require : [access.require];
                        requirePassed = bits.every((b: string) => resolved.bits.has(b));
                    }
                    if (!requirePassed) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                if (access.requireAll && access.requireAll.length > 0) {
                    if (!access.requireAll.every((b) => resolved.bits.has(b))) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                if (access.requireAny && access.requireAny.length > 0) {
                    if (!access.requireAny.some((b) => resolved.bits.has(b))) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }

                return { allowed: true, reason: '', ephemeral: false };
            } catch (err) {
                log.error(`canExecute failed: ${(err as Error).message}`);
                return { allowed: false, reason: 'An internal permission error occurred.', ephemeral: true };
            }
        }

        private async checkPermissionLevel(
            levelName: string,
            userId: string,
            interaction: Interaction
        ): Promise<PermissionCheckResult> {
            const { configManager } = await import('#core/manager/config.js');
            const permConfig = configManager.get<PermissionsConfigShape | undefined>('permissions');

            if (!permConfig?.enabled) {
                return { allowed: true, reason: '', ephemeral: false };
            }

            const level = permConfig.levels?.[levelName];
            if (!level) {
                if (levelName === 'public' || levelName === (permConfig.defaultLevel ?? 'public')) {
                    return { allowed: true, reason: '', ephemeral: false };
                }
                log.warn(`Permission level "${levelName}" not found in permissions.json5.`);
                return { allowed: false, reason: `Permission level "${levelName}" is not configured.`, ephemeral: true };
            }

            const denyMsg = level.denyMessage ?? `You do not have the "${levelName}" permission level.`;
            const guildId = interaction.guildId ?? undefined;

            if (level.roleIds && level.roleIds.length > 0 && guildId) {
                const member: GuildMember | APIInteractionGuildMember | null | undefined =
                    interaction.guild?.members?.cache.get(userId) ?? interaction.member ?? undefined;

                if (member) {
                    const roles = member.roles;
                const memberRoles: string[] =
                    roles && typeof roles === 'object' && 'cache' in roles
                        ? Array.from((roles as GuildMember['roles']).cache.keys())
                        : Array.isArray(roles)
                          ? roles.map(String)
                          : [];

                    const hasRole = level.roleIds.some((rid: string) => memberRoles.includes(rid));
                    if (!hasRole) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }
            }

            if (level.discordPermissions && level.discordPermissions.length > 0 && guildId) {
                const memberPerms = interaction.memberPermissions ?? null;
                if (memberPerms) {
                    const required = new PermissionsBitField(level.discordPermissions);
                    if (!memberPerms.has(required)) {
                        return { allowed: false, reason: denyMsg, ephemeral: true };
                    }
                }
            }

            return { allowed: true, reason: '', ephemeral: false };
        }

    public async sendDenied(interaction: Interaction, reason: string): Promise<void> {
        if (!interaction.isRepliable()) return;

        const payload = {
            content: `%%emoji_cross%% ${reason}`,
            ephemeral: true,
        };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch (err) {
            log.error(`sendDenied failed: ${(err as Error).message}`);
        }
    }

    public async getGuildDiscordMirror(guildId: string) {
        const { getGuildMirror } = await import('#core/permissions/discordMirror.js');
        return getGuildMirror(this.db, guildId);
    }

    public async setGuildDiscordMirror(
        guildId: string,
        input: { enabled: boolean; map?: Record<string, string> | null; updatedBy: string | null },
    ) {
        const { setGuildMirror } = await import('#core/permissions/discordMirror.js');
        return setGuildMirror(this.db, guildId, input);
    }

    public async applyDiscordMirrorBits(
        bits: Set<string>,
        guildId: string | undefined,
        memberPermissions: import('discord.js').PermissionsBitField | null | undefined,
    ): Promise<Set<string>> {
        if (!guildId || !memberPermissions) return bits;
        const { getGuildMirror, mirrorDiscordPermissionsToBits } = await import(
            '#core/permissions/discordMirror.js'
        );
        const state = await getGuildMirror(this.db, guildId);
        if (!state.enabled) return bits;
        const mirrored = mirrorDiscordPermissionsToBits(memberPermissions, state.map);
        for (const b of mirrored) bits.add(b);
        return bits;
    }

    public async linkDiscordRole(input: {
        scope: 'bot' | 'server';
        guildId: string | null;
        discordRoleId: string;
        permRoleId: string;
        createdBy: string;
    }): Promise<import('#core/manager/permissionRoleLinks.js').RoleLinkDoc> {
        if (input.scope === 'bot') {
            const role = await this.getBotRole(input.permRoleId);
            if (!role) throw new PermissionError('INVALID_BIT', `Bot role ${input.permRoleId} not found.`);
        } else {
            if (!input.guildId) throw new PermissionError('NOT_IN_GUILD', 'guildId required for server role links');
            const role = await this.getServerRole(input.guildId, input.permRoleId);
            if (!role) throw new PermissionError('INVALID_BIT', `Server role ${input.permRoleId} not found.`);
        }
        const { insertLink } = await import('#core/manager/permissionRoleLinks.js');
        const doc = await insertLink(this.db, input);
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('permissions.role_link.linked', {
                    ...input,
                    at: Date.now(),
                }),
            )
            .catch(() => undefined);
        return doc;
    }

    public async unlinkDiscordRole(input: {
        scope: 'bot' | 'server';
        guildId: string | null;
        discordRoleId: string;
        permRoleId: string;
    }): Promise<void> {
        const { deleteLink, deleteGrants, listGrantsForRole, userHasAnyGrant } = await import(
            '#core/manager/permissionRoleLinks.js'
        );
        await deleteLink(this.db, input);
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('permissions.role_link.unlinked', {
                    ...input,
                    at: Date.now(),
                }),
            )
            .catch(() => undefined);
        const guildKey = input.scope === 'bot' ? null : input.guildId;
        await deleteGrants(this.db, {
            permRoleId: input.permRoleId,
            guildId: guildKey,
            source: 'discord_role',
            discordRoleId: input.discordRoleId,
        });
        const grants = await listGrantsForRole(this.db, input.permRoleId, guildKey);
        const still = new Set(grants.map((g) => g.userId));
        if (input.scope === 'bot') {
            const role = await this.getBotRole(input.permRoleId);
            if (role) {
                const next = role.assignedUserIds.filter((uid) => still.has(uid));
                await this.writeBotAssigned(input.permRoleId, next);
                await Promise.all(role.assignedUserIds.map((uid) => this.invalidateUserCache(uid)));
            }
        } else if (input.guildId) {
            const role = await this.getServerRole(input.guildId, input.permRoleId);
            if (role) {
                const next = role.assignedUserIds.filter((uid) => still.has(uid));
                await this.writeServerAssigned(input.guildId, input.permRoleId, next);
                await Promise.all(role.assignedUserIds.map((uid) => this.invalidateUserCache(uid, input.guildId!)));
            }
        }
        void userHasAnyGrant;
    }

    public async listDiscordRoleLinks(filter?: {
        scope?: 'bot' | 'server';
        guildId?: string | null;
    }): Promise<import('#core/manager/permissionRoleLinks.js').RoleLinkDoc[]> {
        const { listLinks } = await import('#core/manager/permissionRoleLinks.js');
        return listLinks(this.db, filter);
    }

    public async applyDiscordGrant(
        scope: 'bot' | 'server',
        guildId: string | null,
        permRoleId: string,
        userId: string,
        discordRoleId: string,
    ): Promise<void> {
        const { upsertGrant } = await import('#core/manager/permissionRoleLinks.js');
        const gId = scope === 'bot' ? null : guildId;
        await upsertGrant(this.db, {
            userId,
            permRoleId,
            guildId: gId,
            source: 'discord_role',
            discordRoleId,
        });
        if (scope === 'bot') {
            const existing = await this.getBotRole(permRoleId);
            if (!existing) return;
            if (!existing.assignedUserIds.includes(userId)) {
                await this.writeBotAssigned(permRoleId, [...existing.assignedUserIds, userId]);
            }
            await this.invalidateUserCache(userId);
        } else if (guildId) {
            const existing = await this.getServerRole(guildId, permRoleId);
            if (!existing) return;
            if (!existing.assignedUserIds.includes(userId)) {
                await this.writeServerAssigned(guildId, permRoleId, [...existing.assignedUserIds, userId]);
            }
            await this.invalidateUserCache(userId, guildId);
        }
    }

    public async revokeDiscordGrantIfOrphan(
        scope: 'bot' | 'server',
        guildId: string | null,
        permRoleId: string,
        userId: string,
        discordRoleId: string,
    ): Promise<void> {
        const { deleteGrants, userHasAnyGrant } = await import('#core/manager/permissionRoleLinks.js');
        const gId = scope === 'bot' ? null : guildId;
        await deleteGrants(this.db, {
            userId,
            permRoleId,
            guildId: gId,
            source: 'discord_role',
            discordRoleId,
        });
        const still = await userHasAnyGrant(this.db, userId, permRoleId, gId);
        if (still) return;
        if (scope === 'bot') {
            const existing = await this.getBotRole(permRoleId);
            if (!existing) return;
            await this.writeBotAssigned(
                permRoleId,
                existing.assignedUserIds.filter((u) => u !== userId),
            );
            await this.invalidateUserCache(userId);
        } else if (guildId) {
            const existing = await this.getServerRole(guildId, permRoleId);
            if (!existing) return;
            await this.writeServerAssigned(
                guildId,
                permRoleId,
                existing.assignedUserIds.filter((u) => u !== userId),
            );
            await this.invalidateUserCache(userId, guildId);
        }
    }

    public async invalidateUserCache(userId: string, guildId?: string): Promise<void> {
        if (this.cache) {
            await this.cache.invalidate(userId, guildId);
        }
    }

    public async invalidateGuildCache(guildId: string): Promise<void> {
        if (this.cache) {
            await this.cache.invalidateGuild(guildId);
        }
    }
}

export let permissionsManager: PermissionsManager | undefined;

export function createPermissionsManager(): PermissionsManager {
    permissionsManager = new PermissionsManager();
    return permissionsManager;
}
