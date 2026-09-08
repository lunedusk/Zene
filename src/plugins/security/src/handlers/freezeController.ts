import {
    ChannelType,
    PermissionFlagsBits,
    type Guild,
    type GuildChannel,
    type TextChannel,
} from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import type {
    ChannelOverwriteSnapshot,
    FreezeStateRow,
    LockdownOptions,
    SecurityActor,
} from '../lib/types.js';
import type SecurityStoreHandler from './store.js';

/** Discord API max for invites_disabled_until is 24 hours. Refresh slightly before. */
const INVITE_PAUSE_MS = 24 * 60 * 60 * 1000;
const INVITE_REFRESH_BEFORE_MS = 60 * 60 * 1000;

function everyoneId(guild: Guild): string {
    return guild.id;
}

export default class FreezeControllerHandler extends BaseHandler {
    public readonly name = 'freezeController';
    public readonly version = '1.0.0';
    public readonly description =
        'Unified lockdown/freeze: channel locks, invite pause (disableInvites), quarantine flag.';

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async getStatus(guildId: string): Promise<FreezeStateRow | null> {
        return (await this.store()?.getFreezeState(guildId)) ?? null;
    }

    /**
     * Enable lockdown/freeze with selected filters.
     * Uses guild.disableInvites(true) when pauseInvites is set (24h API max; refreshed by scheduler).
     */
    public async enable(
        guild: Guild,
        actor: SecurityActor,
        options: LockdownOptions,
    ): Promise<{ ok: boolean; detail?: string; state?: FreezeStateRow }> {
        const store = this.store();
        if (!store) return { ok: false, detail: 'store_unavailable' };

        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        if (!me) return { ok: false, detail: 'bot_not_in_guild' };

        let overwriteSnapshot: string | null = null;
        if (options.lockChannels) {
            if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return { ok: false, detail: 'bot_missing_manage_channels' };
            }
            const snapshots = await this.lockAllTextChannels(guild);
            overwriteSnapshot = JSON.stringify(snapshots);
        }

        let invitesPausedUntil: number | null = null;
        if (options.pauseInvites) {
            if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return { ok: false, detail: 'bot_missing_manage_guild' };
            }
            try {
                await guild.disableInvites(true);
                invitesPausedUntil = Date.now() + INVITE_PAUSE_MS;
            } catch (err: unknown) {
                this.log.warn(
                    `disableInvites failed in ${guild.id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
                return { ok: false, detail: 'invite_pause_failed' };
            }
        }

        const now = Date.now();
        const state: FreezeStateRow = {
            guildId: guild.id,
            active: true,
            pauseInvites: options.pauseInvites,
            lockChannels: options.lockChannels,
            quarantineJoins: options.quarantineJoins,
            reason: options.reason ?? null,
            actorId: actor.userId,
            overwriteSnapshot,
            invitesPausedUntil,
            activatedAt: now,
            updatedAt: now,
        };
        await store.upsertFreezeState(state);

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.LOCKDOWN_START, {
            guildId: guild.id,
            actorId: actor.userId,
            pauseInvites: options.pauseInvites,
            lockChannels: options.lockChannels,
            quarantineJoins: options.quarantineJoins,
            reason: options.reason ?? null,
        });

        return { ok: true, state };
    }

    public async disable(
        guild: Guild,
        actor: SecurityActor,
    ): Promise<{ ok: boolean; detail?: string }> {
        const store = this.store();
        if (!store) return { ok: false, detail: 'store_unavailable' };

        const existing = await store.getFreezeState(guild.id);
        if (!existing?.active) {
            return { ok: false, detail: 'not_active' };
        }

        if (existing.lockChannels && existing.overwriteSnapshot) {
            try {
                await this.restoreOverwrites(guild, existing.overwriteSnapshot);
            } catch (err: unknown) {
                this.log.warn(
                    `Restore overwrites failed in ${guild.id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        if (existing.pauseInvites) {
            try {
                await guild.disableInvites(false);
            } catch (err: unknown) {
                this.log.warn(
                    `disableInvites(false) failed in ${guild.id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        const now = Date.now();
        await store.upsertFreezeState({
            ...existing,
            active: false,
            invitesPausedUntil: null,
            updatedAt: now,
        });

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.LOCKDOWN_END, {
            guildId: guild.id,
            actorId: actor.userId,
        });

        return { ok: true };
    }

    /**
     * Re-apply disableInvites for active freezes nearing the 24h API window.
     * Called by scheduler.
     */
    public async refreshInvitePauses(): Promise<number> {
        const store = this.store();
        if (!store) return 0;

        const active = await store.listActiveFreezes();
        let refreshed = 0;
        const now = Date.now();

        for (const state of active) {
            if (!state.pauseInvites) continue;
            const until = state.invitesPausedUntil ?? 0;
            if (until - now > INVITE_REFRESH_BEFORE_MS) continue;

            const guild = this.heart.client.guilds.cache.get(state.guildId);
            if (!guild) continue;

            try {
                await guild.disableInvites(true);
                const nextUntil = now + INVITE_PAUSE_MS;
                await store.upsertFreezeState({
                    ...state,
                    invitesPausedUntil: nextUntil,
                    updatedAt: now,
                });
                refreshed += 1;
                await emitSecurityEvent(this.heart, SECURITY_EVENTS.INVITE_PAUSE_REFRESH, {
                    guildId: state.guildId,
                    invitesPausedUntil: nextUntil,
                });
            } catch (err: unknown) {
                this.log.warn(
                    `Invite pause refresh failed for ${state.guildId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
        return refreshed;
    }

    private async lockAllTextChannels(guild: Guild): Promise<ChannelOverwriteSnapshot[]> {
        const snapshots: ChannelOverwriteSnapshot[] = [];
        const target = everyoneId(guild);

        for (const channel of guild.channels.cache.values()) {
            if (
                channel.type !== ChannelType.GuildText &&
                channel.type !== ChannelType.GuildAnnouncement &&
                channel.type !== ChannelType.GuildForum
            ) {
                continue;
            }
            const ch = channel as GuildChannel & TextChannel;
            if (!ch.manageable) continue;

            const existing = ch.permissionOverwrites.cache.get(target);
            snapshots.push({
                channelId: ch.id,
                allow: existing?.allow.bitfield.toString() ?? '0',
                deny: existing?.deny.bitfield.toString() ?? '0',
            });

            try {
                await ch.permissionOverwrites.edit(
                    target,
                    {
                        SendMessages: false,
                        AddReactions: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false,
                        SendMessagesInThreads: false,
                    },
                    { reason: 'Security lockdown' },
                );
            } catch (err: unknown) {
                this.log.debug(
                    `Lock channel ${ch.id} failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
        return snapshots;
    }

    private async restoreOverwrites(guild: Guild, snapshotJson: string): Promise<void> {
        let snapshots: ChannelOverwriteSnapshot[] = [];
        try {
            const parsed: unknown = JSON.parse(snapshotJson);
            if (Array.isArray(parsed)) snapshots = parsed as ChannelOverwriteSnapshot[];
        } catch {
            return;
        }

        const target = everyoneId(guild);
        for (const snap of snapshots) {
            const channel = guild.channels.cache.get(snap.channelId);
            if (!channel || !('permissionOverwrites' in channel)) continue;
            const ch = channel as GuildChannel;
            if (!ch.manageable) continue;

            try {
                // Only clear lockdown denies on @everyone — do not replace other role overwrites.
                await ch.permissionOverwrites.edit(
                    target,
                    {
                        SendMessages: null,
                        AddReactions: null,
                        CreatePublicThreads: null,
                        CreatePrivateThreads: null,
                        SendMessagesInThreads: null,
                    },
                    { reason: 'Security lockdown end' },
                );
            } catch (err: unknown) {
                this.log.debug(
                    `Restore overwrite ${snap.channelId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
    }

    /** Lock a single channel (@everyone cannot send). */
    public async lockChannel(
        channel: GuildChannel & { permissionOverwrites: GuildChannel['permissionOverwrites'] },
        reason?: string,
    ): Promise<boolean> {
        try {
            await channel.permissionOverwrites.edit(
                channel.guild.id,
                { SendMessages: false, AddReactions: false },
                { reason: reason ?? 'Security channel lock' },
            );
            return true;
        } catch {
            return false;
        }
    }

    public async unlockChannel(
        channel: GuildChannel & { permissionOverwrites: GuildChannel['permissionOverwrites'] },
        reason?: string,
    ): Promise<boolean> {
        try {
            await channel.permissionOverwrites.edit(
                channel.guild.id,
                { SendMessages: null, AddReactions: null },
                { reason: reason ?? 'Security channel unlock' },
            );
            return true;
        } catch {
            return false;
        }
    }
}
