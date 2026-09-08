import {
    PermissionFlagsBits,
    type Guild,
    type GuildAuditLogsEntry,
    type GuildMember,
} from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import {
    AUDIT_TO_EVENT,
    defaultAntiNukeRule,
    isAntiNukeEventKey,
} from '../lib/antiNukeEvents.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import type { AntiNukeEventKey, AntiNukeRule, SecurityActor } from '../lib/types.js';
import type ModerationBridgeHandler from './moderationBridge.js';
import type SecurityStoreHandler from './store.js';

export default class AntiNukeHandler extends BaseHandler {
    public readonly name = 'antiNuke';
    public readonly version = '1.0.0';
    public readonly description = 'Per-event anti-nuke thresholds, whitelists, and punishments.';

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async getRule(guildId: string, eventKey: AntiNukeEventKey): Promise<AntiNukeRule> {
        const store = this.store();
        if (!store) return defaultAntiNukeRule(guildId, eventKey);
        const row = await store.getAntiNukeRule(guildId, eventKey);
        return row ?? defaultAntiNukeRule(guildId, eventKey);
    }

    public async listRules(guildId: string): Promise<AntiNukeRule[]> {
        const store = this.store();
        if (!store) return [];
        return store.listAntiNukeRules(guildId);
    }

    public async upsertRule(rule: AntiNukeRule): Promise<AntiNukeRule> {
        const store = this.store();
        if (!store) throw new Error('Security store unavailable');
        await store.upsertAntiNukeRule(rule);
        return rule;
    }

    public async setEnabled(guildId: string, eventKey: AntiNukeEventKey, enabled: boolean): Promise<AntiNukeRule> {
        const current = await this.getRule(guildId, eventKey);
        const next: AntiNukeRule = { ...current, enabled, updatedAt: Date.now() };
        return this.upsertRule(next);
    }

    /**
     * Process a resolved audit action for anti-nuke.
     */
    public async handleAction(input: {
        guild: Guild;
        eventKey: AntiNukeEventKey;
        actorId: string;
        detail?: string;
    }): Promise<void> {
        const { guild, eventKey, actorId } = input;
        if (!actorId || actorId === this.heart.client.user?.id) return;
        if (actorId === guild.ownerId) return; // Discord server owner always protected

        const rule = await this.getRule(guild.id, eventKey);
        if (!rule.enabled) return;

        if (rule.whitelistUserIds.includes(actorId)) return;

        let member: GuildMember | null = null;
        try {
            member = await guild.members.fetch(actorId);
        } catch {
            member = null;
        }
        if (member) {
            for (const roleId of rule.whitelistRoleIds) {
                if (member.roles.cache.has(roleId)) return;
            }
            // Bit holders of antinuke manage are exempt
            try {
                const has = await this.heart.permissions.hasBit(
                    actorId,
                    'plugin.security.antinuke.manage',
                    guild.id,
                );
                if (has) return;
            } catch {
                /* ignore */
            }
        }

        const count = await this.bumpCounter(guild.id, eventKey, actorId, rule.windowMs);
        if (count < rule.maxActions) return;

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.ANTINUKE_TRIP, {
            guildId: guild.id,
            eventKey,
            actorId,
            count,
            maxActions: rule.maxActions,
            detail: input.detail ?? null,
        });

        await this.punish(guild, actorId, member, rule);
    }

    public async handleAuditEntry(guild: Guild, entry: GuildAuditLogsEntry): Promise<void> {
        const mapped = AUDIT_TO_EVENT[entry.action as number];
        if (!mapped || !isAntiNukeEventKey(mapped)) return;
        const actorId = entry.executorId ?? entry.executor?.id;
        if (!actorId) return;
        await this.handleAction({
            guild,
            eventKey: mapped,
            actorId,
            detail: entry.reason ?? undefined,
        });
    }

    private async bumpCounter(
        guildId: string,
        eventKey: AntiNukeEventKey,
        actorId: string,
        windowMs: number,
    ): Promise<number> {
        const cache = this.heart.cache.ns('security');
        const key = `an:${guildId}:${eventKey}:${actorId}`;
        const raw = await cache.get(key);
        const count = raw ? Number(raw) + 1 : 1;
        await cache.set(key, String(count), windowMs);
        return count;
    }

    private async punish(
        guild: Guild,
        actorId: string,
        member: GuildMember | null,
        rule: AntiNukeRule,
    ): Promise<void> {
        const bridge = this.heart.system.handler.$get<ModerationBridgeHandler>(
            'security',
            'moderationBridge',
        );
        const actor: SecurityActor = {
            userId: this.heart.client.user?.id ?? '0',
            tag: 'security:antinuke',
        };
        const reason = `Anti-nuke:${rule.eventKey}`;

        try {
            switch (rule.punishment) {
                case 'kick':
                    if (bridge) {
                        await bridge.kick({
                            guildIds: [guild.id],
                            userId: actorId,
                            actor,
                            reason,
                            denied: [],
                        });
                    }
                    break;
                case 'ban':
                    if (bridge) {
                        await bridge.ban({
                            guildIds: [guild.id],
                            userId: actorId,
                            actor,
                            reason,
                            denied: [],
                        });
                    }
                    break;
                case 'timeout':
                    if (bridge) {
                        await bridge.timeout({
                            guildIds: [guild.id],
                            userId: actorId,
                            actor,
                            durationMs: Math.max(5_000, rule.punishmentDurationMs),
                            reason,
                            denied: [],
                        });
                    }
                    break;
                case 'quarantine': {
                    const { resolveQuarantineRoleId } = await import('../lib/quarantineRole.js');
                    const roleId = await resolveQuarantineRoleId(this.heart, guild.id);
                    if (roleId && member) {
                        await member.roles.add(roleId, reason).catch(() => undefined);
                    } else if (bridge) {
                        await bridge.timeout({
                            guildIds: [guild.id],
                            userId: actorId,
                            actor,
                            durationMs: Math.max(5_000, rule.punishmentDurationMs),
                            reason,
                            denied: [],
                        });
                    }
                    break;
                }
                case 'tempRole': {
                    const autoMod = this.heart.system.handler.$get<
                        import('./autoMod.js').default
                    >('security', 'autoMod');
                    const temp = this.heart.system.handler.$get<
                        import('./tempRole.js').default
                    >('security', 'tempRole');
                    const am = autoMod ? await autoMod.getSettings(guild.id) : null;
                    const roleId = am?.tempRoleId;
                    if (temp && roleId) {
                        await temp
                            .apply({
                                guild,
                                userId: actorId,
                                roleId,
                                durationMs: Math.max(
                                    5_000,
                                    rule.punishmentDurationMs || am?.tempRoleDurationMs || 600_000,
                                ),
                                reason,
                                actorId: this.heart.client.user?.id ?? '0',
                            })
                            .catch(() => undefined);
                    } else if (bridge) {
                        await bridge.timeout({
                            guildIds: [guild.id],
                            userId: actorId,
                            actor,
                            durationMs: Math.max(5_000, rule.punishmentDurationMs),
                            reason,
                            denied: [],
                        });
                    }
                    break;
                }
                case 'stripRoles':
                default: {
                    if (member) {
                        const me = guild.members.me;
                        if (me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
                            const removable = member.roles.cache.filter(
                                (r) => r.id !== guild.id && r.editable && r.position < (me.roles.highest.position ?? 0),
                            );
                            if (removable.size > 0) {
                                await member.roles.remove(removable, reason).catch(() => undefined);
                            }
                        }
                    }
                    break;
                }
            }
        } catch (err: unknown) {
            this.log.warn(
                `Anti-nuke punish failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.ANTINUKE_ACTION, {
            guildId: guild.id,
            eventKey: rule.eventKey,
            actorId,
            punishment: rule.punishment,
        });
    }
}
