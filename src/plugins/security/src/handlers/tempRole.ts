import { PermissionFlagsBits, type Guild } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import type { TempRoleRecord } from '../lib/types.js';
import type SecurityStoreHandler from './store.js';

export default class TempRoleHandler extends BaseHandler {
    public readonly name = 'tempRole';
    public readonly version = '1.0.0';
    public readonly description = 'Temporary role assignment with scheduled expiry.';

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async apply(input: {
        guild: Guild;
        userId: string;
        roleId: string;
        durationMs: number;
        reason?: string;
        actorId?: string;
    }): Promise<{ ok: boolean; detail: string }> {
        const { guild, userId, roleId, durationMs } = input;
        const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
        if (!role) return { ok: false, detail: 'role_not_found' };

        const me = guild.members.me;
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { ok: false, detail: 'missing_manage_roles' };
        }
        if (role.position >= me.roles.highest.position || role.managed) {
            return { ok: false, detail: 'role_hierarchy' };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, detail: 'member_not_found' };

        await member.roles.add(role, input.reason ?? 'Security: temp role').catch(() => undefined);

        const store = this.store();
        const now = Date.now();
        const rec: TempRoleRecord = {
            guildId: guild.id,
            userId,
            roleId,
            expiresAt: now + Math.max(5_000, durationMs),
            reason: input.reason ?? null,
            actorId: input.actorId ?? null,
            createdAt: now,
        };
        if (store) await store.upsertTempRole(rec);

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.TEMP_ROLE_ADD, {
            guildId: guild.id,
            userId,
            roleId,
            expiresAt: rec.expiresAt,
            actorId: input.actorId ?? null,
        });

        return { ok: true, detail: 'applied' };
    }

    public async remove(
        guild: Guild,
        userId: string,
        roleId: string,
        reason = 'Security: temp role expired',
    ): Promise<void> {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member?.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, reason).catch(() => undefined);
        }
        const store = this.store();
        if (store) await store.deleteTempRole(guild.id, userId, roleId);
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.TEMP_ROLE_REMOVE, {
            guildId: guild.id,
            userId,
            roleId,
        });
    }

    public async processExpired(): Promise<number> {
        const store = this.store();
        if (!store) return 0;
        const expired = await store.listExpiredTempRoles(Date.now());
        let n = 0;
        for (const rec of expired) {
            const guild = this.heart.client.guilds.cache.get(rec.guildId);
            if (guild) {
                await this.remove(guild, rec.userId, rec.roleId);
                n += 1;
            } else {
                await store.deleteTempRole(rec.guildId, rec.userId, rec.roleId);
            }
        }
        return n;
    }
}
