import type { Guild, GuildMember } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import { resolveQuarantineRoleId } from '../lib/quarantineRole.js';
import type { RaidSettings, SecurityActor } from '../lib/types.js';
import type FreezeControllerHandler from './freezeController.js';
import type ModerationBridgeHandler from './moderationBridge.js';
import type SecurityStoreHandler from './store.js';

const DEFAULT_RAID = (guildId: string): RaidSettings => ({
    guildId,
    enabled: false,
    maxJoins: 8,
    windowMs: 15_000,
    action: 'quarantine',
    quarantineRoleId: null,
    pauseVerifyMs: 300_000,
    joinRoleId: null,
    updatedAt: Date.now(),
});

export default class RaidGuardHandler extends BaseHandler {
    public readonly name = 'raidGuard';
    public readonly version = '1.0.0';
    public readonly description = 'Join-rate raid protection and quarantine on join.';

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async getSettings(guildId: string): Promise<RaidSettings> {
        const store = this.store();
        if (!store) return DEFAULT_RAID(guildId);
        return (await store.getRaidSettings(guildId)) ?? DEFAULT_RAID(guildId);
    }

    public async saveSettings(settings: RaidSettings): Promise<RaidSettings> {
        const store = this.store();
        if (!store) throw new Error('Security store unavailable');
        await store.upsertRaidSettings(settings);
        return settings;
    }

    public async setEnabled(guildId: string, enabled: boolean): Promise<RaidSettings> {
        const current = await this.getSettings(guildId);
        return this.saveSettings({ ...current, enabled, updatedAt: Date.now() });
    }

    public async isRaidActive(guildId: string): Promise<boolean> {
        const cache = this.heart.cache.ns('security');
        const raw = await cache.get(`raid:active:${guildId}`);
        return raw === '1';
    }

    public async isVerifyPaused(guildId: string): Promise<boolean> {
        const cache = this.heart.cache.ns('security');
        const raw = await cache.get(`raid:pauseVerify:${guildId}`);
        return raw === '1';
    }

    public async onMemberJoin(member: GuildMember): Promise<void> {
        const guild = member.guild;
        if (member.user.bot) return;

        const settings = await this.getSettings(guild.id);
        const freeze = this.heart.system.handler.$get<FreezeControllerHandler>(
            'security',
            'freezeController',
        );
        const freezeState = freeze ? await freeze.getStatus(guild.id) : null;
        const quarantineFromFreeze = freezeState?.active === true && freezeState.quarantineJoins;

        if (settings.enabled) {
            const count = await this.bumpJoinCounter(guild.id, settings.windowMs);
            if (count >= settings.maxJoins) {
                await this.triggerRaid(guild, settings, count);
            }
        }

        const raidActive = await this.isRaidActive(guild.id);
        const quarantineRoleId =
            settings.quarantineRoleId ?? (await resolveQuarantineRoleId(this.heart, guild.id));

        if ((raidActive || quarantineFromFreeze) && quarantineRoleId) {
            await member.roles
                .add(quarantineRoleId, 'Security: raid/quarantine joins')
                .catch(() => undefined);
            await emitSecurityEvent(this.heart, SECURITY_EVENTS.RAID_JOIN, {
                guildId: guild.id,
                userId: member.id,
                quarantined: true,
            });
            if (raidActive && settings.action === 'kick') {
                await this.actOnJoin(member, 'kick', settings);
            } else if (raidActive && settings.action === 'ban') {
                await this.actOnJoin(member, 'ban', settings);
            }
            return;
        }

        if (!raidActive && settings.joinRoleId && !settings.enabled) {
            // join role only when raid guard not managing joins aggressively
        }

        if (!raidActive && settings.joinRoleId) {
            const verify = await this.store()?.getVerifySettings(guild.id);
            if (!verify?.enabled) {
                await member.roles
                    .add(settings.joinRoleId, 'Security: join role')
                    .catch(() => undefined);
            }
        }
    }

    private async bumpJoinCounter(guildId: string, windowMs: number): Promise<number> {
        const cache = this.heart.cache.ns('security');
        const key = `raid:joins:${guildId}`;
        const raw = await cache.get(key);
        const count = raw ? Number(raw) + 1 : 1;
        await cache.set(key, String(count), windowMs);
        return count;
    }

    private async triggerRaid(
        guild: Guild,
        settings: RaidSettings,
        count: number,
    ): Promise<void> {
        const cache = this.heart.cache.ns('security');
        const ttl = Math.max(settings.windowMs, settings.pauseVerifyMs, 60_000);
        await cache.set(`raid:active:${guild.id}`, '1', ttl);
        if (settings.action === 'pauseVerify' || settings.pauseVerifyMs > 0) {
            await cache.set(
                `raid:pauseVerify:${guild.id}`,
                '1',
                Math.max(settings.pauseVerifyMs, 30_000),
            );
        }
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.RAID_TRIGGER, {
            guildId: guild.id,
            count,
            maxJoins: settings.maxJoins,
            action: settings.action,
        });
        this.log.warn(`Raid mode triggered in ${guild.id} (${count} joins).`);
    }

    private async actOnJoin(
        member: GuildMember,
        action: 'kick' | 'ban',
        settings: RaidSettings,
    ): Promise<void> {
        const bridge = this.heart.system.handler.$get<ModerationBridgeHandler>(
            'security',
            'moderationBridge',
        );
        if (!bridge) return;
        const actor: SecurityActor = {
            userId: this.heart.client.user?.id ?? '0',
            tag: 'security:raid',
        };
        if (action === 'kick') {
            await bridge
                .kick({
                    guildIds: [member.guild.id],
                    userId: member.id,
                    actor,
                    reason: 'Raid protection',
                    denied: [],
                })
                .catch(() => undefined);
        } else {
            await bridge
                .ban({
                    guildIds: [member.guild.id],
                    userId: member.id,
                    actor,
                    reason: 'Raid protection',
                    denied: [],
                })
                .catch(() => undefined);
        }
        void settings;
    }
}
