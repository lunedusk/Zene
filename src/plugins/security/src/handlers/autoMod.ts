import {
    PermissionFlagsBits,
    type GuildMember,
    type Message,
    type PartialMessage,
} from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { runSyncFilters } from '../lib/autoModFilters.js';
import {
    matchLinkBlacklist,
    matchRegexBlacklist,
    matchWordBlacklist,
} from '../lib/blacklists.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import {
    loadSpamSignatures,
    matchImageBuffer,
    matchTextContent,
    resolvePluginRootFromMeta,
} from '../lib/fingerprints.js';
import type {
    AutoModFilterName,
    AutoModHit,
    AutoModSettings,
    SpamSignatureEntry,
} from '../lib/types.js';
import type ModerationBridgeHandler from './moderationBridge.js';
import type SecurityStoreHandler from './store.js';
import type ViolationTrackerHandler from './violationTracker.js';

const DEFAULT_SETTINGS = (guildId: string): AutoModSettings => ({
    guildId,
    enabled: false,
    invites: false,
    links: false,
    spoilers: false,
    caps: false,
    zalgo: false,
    duplicates: false,
    massMention: false,
    everyoneHere: false,
    rolePing: false,
    knownSpam: false,
    emojiSpam: false,
    newlines: false,
    attachments: false,
    wordBlacklist: false,
    linkBlacklist: false,
    regexBlacklist: false,
    massMentionLimit: 5,
    capsPercent: 70,
    capsMinLength: 12,
    duplicateWindowMs: 15_000,
    duplicateCount: 3,
    emojiMax: 12,
    newlineMax: 15,
    attachmentMax: 6,
    attachmentWindowMs: 15_000,
    actionDelete: true,
    actionWarn: false,
    actionTimeout: false,
    actionStrike: true,
    actionTempRole: false,
    timeoutSeconds: 300,
    tempRoleId: null,
    tempRoleDurationMs: 600_000,
    exemptRoleIds: [],
    exemptChannelIds: [],
    exemptUserIds: [],
    updatedAt: Date.now(),
});

export default class AutoModHandler extends BaseHandler {
    public readonly name = 'autoMod';
    public readonly version = '1.0.0';
    public readonly description = 'Guild AutoMod filters, known-spam fingerprints, and actions.';

    private signatures: readonly SpamSignatureEntry[] = [];

    public async onInitialize(): Promise<void> {
        await this.reloadSignatures();
    }

    public async reloadSignatures(): Promise<number> {
        const root = resolvePluginRootFromMeta(import.meta.url);
        const file = await loadSpamSignatures(root);
        this.signatures = file.entries;
        this.log.info(`Loaded ${this.signatures.length} spam signature(s).`);
        return this.signatures.length;
    }

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async getSettings(guildId: string): Promise<AutoModSettings> {
        const store = this.store();
        if (!store) return DEFAULT_SETTINGS(guildId);
        const row = await store.getAutoModSettings(guildId);
        return row ?? DEFAULT_SETTINGS(guildId);
    }

    public async setEnabled(guildId: string, enabled: boolean): Promise<AutoModSettings> {
        const current = await this.getSettings(guildId);
        return this.saveSettings({ ...current, enabled, updatedAt: Date.now() });
    }

    public async setFilter(
        guildId: string,
        filter: AutoModFilterName,
        on: boolean,
    ): Promise<AutoModSettings> {
        const current = await this.getSettings(guildId);
        const next: AutoModSettings = { ...current, [filter]: on, updatedAt: Date.now() };
        return this.saveSettings(next);
    }

    public async patchSettings(
        guildId: string,
        patch: Partial<AutoModSettings>,
    ): Promise<AutoModSettings> {
        const current = await this.getSettings(guildId);
        return this.saveSettings({ ...current, ...patch, guildId, updatedAt: Date.now() });
    }

    private async saveSettings(settings: AutoModSettings): Promise<AutoModSettings> {
        const store = this.store();
        if (!store) throw new Error('Security store unavailable');
        await store.upsertAutoModSettings(settings);
        return settings;
    }

    public async processMessage(message: Message | PartialMessage): Promise<void> {
        if (!message.guildId || !message.author || message.author.bot) return;
        if (!message.guild || !message.channel) return;

        const settings = await this.getSettings(message.guildId);
        if (!settings.enabled) return;

        if (this.isExempt(message, settings)) return;

        let hit: AutoModHit | null = runSyncFilters(message as Message, settings);

        // Attachment rate uses a rolling window (overrides pure per-message sync hit).
        if (settings.attachments) {
            const rateHit = await this.checkAttachmentRate(message as Message, settings);
            if (rateHit) hit = rateHit;
            else if (hit?.filter === 'attachments') hit = null;
        }

        if (!hit && settings.duplicates && message.content) {
            hit = await this.checkDuplicates(message as Message, settings);
        }

        if (!hit && settings.knownSpam) {
            hit = await this.checkKnownSpam(message as Message);
        }

        if (!hit && (settings.wordBlacklist || settings.linkBlacklist || settings.regexBlacklist)) {
            hit = await this.checkBlacklists(message as Message, settings);
        }

        if (!hit) return;

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.AUTOMOD_HIT, {
            guildId: message.guildId,
            channelId: message.channelId,
            userId: message.author.id,
            messageId: message.id,
            filter: hit.filter,
            detail: hit.detail ?? null,
        });

        await this.applyActions(message as Message, settings, hit);
    }


    private async checkBlacklists(
        message: Message,
        settings: AutoModSettings,
    ): Promise<AutoModHit | null> {
        const store = this.store();
        if (!store) return null;
        const content = message.content ?? '';
        const entries = await store.listBlacklist(message.guildId as string);
        if (entries.length === 0) return null;
        if (settings.wordBlacklist) {
            const m = matchWordBlacklist(content, entries);
            if (m) return { filter: 'wordBlacklist', detail: m };
        }
        if (settings.linkBlacklist) {
            const m = matchLinkBlacklist(content, entries);
            if (m) return { filter: 'linkBlacklist', detail: m };
        }
        if (settings.regexBlacklist) {
            const m = matchRegexBlacklist(content, entries);
            if (m) return { filter: 'regexBlacklist', detail: m };
        }
        return null;
    }

    private isExempt(message: Message | PartialMessage, settings: AutoModSettings): boolean {
        if (!message.author || !message.guildId) return true;
        if (settings.exemptUserIds.includes(message.author.id)) return true;
        if (message.channelId && settings.exemptChannelIds.includes(message.channelId)) return true;

        const member = message.member as GuildMember | null | undefined;
        if (member) {
            if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
            for (const roleId of settings.exemptRoleIds) {
                if (member.roles.cache.has(roleId)) return true;
            }
        }
        return false;
    }

    private async checkDuplicates(
        message: Message,
        settings: AutoModSettings,
    ): Promise<AutoModHit | null> {
        const content = (message.content ?? '').trim().toLowerCase();
        if (!content) return null;
        const cache = this.heart.cache.ns('security');
        const key = `dup:${message.guildId}:${message.author.id}:${content.slice(0, 120)}`;
        const raw = await cache.get(key);
        const count = raw ? Number(raw) + 1 : 1;
        await cache.set(key, String(count), settings.duplicateWindowMs);
        if (count >= settings.duplicateCount) {
            return { filter: 'duplicates', detail: `count=${count}` };
        }
        return null;
    }

    private async checkKnownSpam(message: Message): Promise<AutoModHit | null> {
        if (this.signatures.length === 0) return null;

        if (message.content) {
            const textHit = await matchTextContent(message.content, this.signatures);
            if (textHit) {
                return { filter: 'knownSpam', detail: `text:${textHit.id}` };
            }
        }

        const image = message.attachments.find((a) =>
            (a.contentType ?? '').startsWith('image/'),
        );
        if (!image) return null;

        try {
            const res = await fetch(image.url, { signal: AbortSignal.timeout(8_000) });
            if (!res.ok) return null;
            const ab = await res.arrayBuffer();
            const buf = Buffer.from(ab);
            const imgHit = await matchImageBuffer(buf, this.signatures);
            if (imgHit) {
                return { filter: 'knownSpam', detail: `image:${imgHit.id}` };
            }
        } catch (err: unknown) {
            this.log.debug(
                `Known-spam image fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        return null;
    }

    private async applyActions(
        message: Message,
        settings: AutoModSettings,
        hit: AutoModHit,
    ): Promise<void> {
        const guildId = message.guildId as string;
        const userId = message.author.id;
        const reason = `AutoMod:${hit.filter}${hit.detail ? ` (${hit.detail})` : ''}`;

        if (settings.actionDelete && message.deletable) {
            try {
                await message.delete();
            } catch (err: unknown) {
                this.log.debug(
                    `AutoMod delete failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        if (settings.actionStrike || settings.actionWarn) {
            const store = this.store();
            if (store) {
                try {
                    await store.recordInfraction({
                        guildId,
                        userId,
                        actorId: this.heart.client.user?.id ?? '0',
                        type: settings.actionWarn ? 'warn' : 'automod',
                        reason,
                        metadata: { filter: hit.filter, detail: hit.detail ?? null },
                    });
                } catch {
                    /* ignore */
                }
            }
            if (settings.actionStrike) {
                const tracker = this.heart.system.handler.$get<ViolationTrackerHandler>(
                    'security',
                    'violationTracker',
                );
                if (tracker) {
                    await tracker
                        .add(guildId, userId, 1, this.heart.client.user?.id ?? '0')
                        .catch(() => undefined);
                }
            }
        }

        if (settings.actionTimeout && settings.timeoutSeconds > 0) {
            const bridge = this.heart.system.handler.$get<ModerationBridgeHandler>(
                'security',
                'moderationBridge',
            );
            if (bridge) {
                await bridge
                    .timeout({
                        guildIds: [guildId],
                        userId,
                        actor: {
                            userId: this.heart.client.user?.id ?? '0',
                            tag: 'security:automod',
                        },
                        durationMs: settings.timeoutSeconds * 1000,
                        reason,
                        denied: [],
                    })
                    .catch(() => undefined);
            }
        }

        if (settings.actionTempRole && settings.tempRoleId) {
            const temp = this.heart.system.handler.$get<
                import('./tempRole.js').default
            >('security', 'tempRole');
            if (temp && message.guild) {
                await temp
                    .apply({
                        guild: message.guild,
                        userId,
                        roleId: settings.tempRoleId,
                        durationMs: Math.max(5_000, settings.tempRoleDurationMs),
                        reason,
                        actorId: this.heart.client.user?.id ?? '0',
                    })
                    .catch(() => undefined);
            }
        }

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.AUTOMOD_ACTION, {
            guildId,
            userId,
            filter: hit.filter,
            detail: hit.detail ?? null,
            delete: settings.actionDelete,
            warn: settings.actionWarn,
            strike: settings.actionStrike,
            timeout: settings.actionTimeout,
            tempRole: settings.actionTempRole,
        });
    }

    private async checkAttachmentRate(
        message: Message,
        settings: AutoModSettings,
    ): Promise<AutoModHit | null> {
        const count = message.attachments.size;
        if (count <= 0) return null;
        const guildId = message.guildId as string;
        const userId = message.author.id;
        const cache = this.heart.cache.ns('security');
        const key = `att:${guildId}:${userId}`;
        const windowMs = Math.max(1000, settings.attachmentWindowMs);
        const prevRaw = await cache.get(key);
        const prev = prevRaw ? Number(prevRaw) : 0;
        const next = (Number.isFinite(prev) ? prev : 0) + count;
        await cache.set(key, String(next), windowMs);
        if (next >= settings.attachmentMax) {
            return { filter: 'attachments', detail: `rate=${next}/${windowMs}ms` };
        }
        return null;
    }
}
