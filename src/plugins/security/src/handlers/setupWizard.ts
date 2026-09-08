import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { buildComponentsV2, replyCv2Text } from '#core/builders/index.js';
import type { AntiNukeEventKey } from '../lib/types.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import { resolveQuarantineRoleId } from '../lib/quarantineRole.js';
import { buildSetupLayout, type SetupPanelState } from '../lib/setupLayouts.js';
import type AntiNukeHandler from './antiNuke.js';
import type AutoModHandler from './autoMod.js';
import type RaidGuardHandler from './raidGuard.js';
import type VerifyHandler from './verify.js';

/** Safe anti-nuke preset: only high-signal destructive events, conservative thresholds. */
const SAFE_ANTINUKE_EVENTS: readonly AntiNukeEventKey[] = [
    'channelDelete',
    'roleDelete',
    'emojiDelete',
    'webhookUpdate',
    'memberBan',
    'memberKick',
    'memberPrune',
    'messageBulkDelete',
];

export default class SetupWizardHandler extends BaseHandler {
    public readonly name = 'setupWizard';
    public readonly version = '1.0.0';
    public readonly description = 'Interactive CV2 security setup wizard and status snapshot.';

    public async collectState(guildId: string): Promise<SetupPanelState> {
        const autoMod = this.heart.system.handler.$get<AutoModHandler>('security', 'autoMod');
        const raid = this.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        const verify = this.heart.system.handler.$get<VerifyHandler>('security', 'verify');
        const anti = this.heart.system.handler.$get<AntiNukeHandler>('security', 'antiNuke');

        const automodOn = autoMod ? (await autoMod.getSettings(guildId)).enabled : false;
        const raidOn = raid ? (await raid.getSettings(guildId)).enabled : false;
        const verifyOn = verify ? (await verify.getSettings(guildId)).enabled : false;

        let antinukeSafeOn = false;
        if (anti) {
            const rules = await anti.listRules(guildId);
            antinukeSafeOn = SAFE_ANTINUKE_EVENTS.every((key) => {
                const r = rules.find((x) => x.eventKey === key);
                return r?.enabled === true;
            });
        }

        const quarantineRoleId = await resolveQuarantineRoleId(this.heart, guildId);

        return {
            automodOn,
            raidOn,
            verifyOn,
            antinukeSafeOn,
            quarantineRoleId,
        };
    }

    public async openSetup(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const state = await this.collectState(guildId);
        const payload = buildComponentsV2(buildSetupLayout(state));
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply({ ...payload, ephemeral: true });
        }
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.SETUP_OPEN, {
            guildId,
            actorId: interaction.user.id,
        });
    }

    public async refreshPanel(interaction: ButtonInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const state = await this.collectState(guildId);
        await interaction.update(buildComponentsV2(buildSetupLayout(state)));
    }

    public async toggleAutomod(interaction: ButtonInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const autoMod = this.heart.system.handler.$get<AutoModHandler>('security', 'autoMod');
        if (!autoMod) {
            await replyCv2Text(interaction, {
                content: 'AutoMod handler unavailable.',
                emoji: '⚠️',
                ephemeral: true,
            });
            return;
        }
        const current = await autoMod.getSettings(guildId);
        if (current.enabled) {
            await autoMod.setEnabled(guildId, false);
        } else {
            await autoMod.patchSettings(guildId, {
                enabled: true,
                invites: true,
                massMention: true,
                everyoneHere: true,
                rolePing: true,
                actionDelete: true,
                actionStrike: true,
                actionWarn: false,
                actionTimeout: false,
                updatedAt: Date.now(),
            });
        }
        await this.refreshPanel(interaction);
    }

    public async toggleRaid(interaction: ButtonInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const raid = this.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        if (!raid) {
            await replyCv2Text(interaction, {
                content: 'Raid handler unavailable.',
                emoji: '⚠️',
                ephemeral: true,
            });
            return;
        }
        const current = await raid.getSettings(guildId);
        await raid.setEnabled(guildId, !current.enabled);
        await this.refreshPanel(interaction);
    }

    public async toggleVerify(interaction: ButtonInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const verify = this.heart.system.handler.$get<VerifyHandler>('security', 'verify');
        if (!verify) {
            await replyCv2Text(interaction, {
                content: 'Verify handler unavailable.',
                emoji: '⚠️',
                ephemeral: true,
            });
            return;
        }
        const current = await verify.getSettings(guildId);
        await verify.saveSettings({
            ...current,
            enabled: !current.enabled,
            updatedAt: Date.now(),
        });
        await this.refreshPanel(interaction);
    }

    public async toggleAntinukeSafe(interaction: ButtonInteraction): Promise<void> {
        const guildId = interaction.guildId as string;
        const anti = this.heart.system.handler.$get<AntiNukeHandler>('security', 'antiNuke');
        if (!anti) {
            await replyCv2Text(interaction, {
                content: 'Anti-nuke handler unavailable.',
                emoji: '⚠️',
                ephemeral: true,
            });
            return;
        }
        const state = await this.collectState(guildId);
        const enable = !state.antinukeSafeOn;
        for (const eventKey of SAFE_ANTINUKE_EVENTS) {
            const base = await anti.getRule(guildId, eventKey);
            await anti.upsertRule({
                ...base,
                enabled: enable,
                windowMs: base.windowMs || 10_000,
                maxActions: Math.max(base.maxActions, 3),
                punishment: base.punishment || 'stripRoles',
                updatedAt: Date.now(),
            });
        }
        // Explicitly do not enable guildUpdate / roleCreate / etc.
        await this.refreshPanel(interaction);
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.SETUP_ANTINUKE_SAFE, {
            guildId,
            actorId: interaction.user.id,
            enabled: enable,
        });
    }

    public async buildStatusText(guildId: string): Promise<string> {
        const autoMod = this.heart.system.handler.$get<AutoModHandler>('security', 'autoMod');
        const raid = this.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        const verify = this.heart.system.handler.$get<VerifyHandler>('security', 'verify');
        const anti = this.heart.system.handler.$get<AntiNukeHandler>('security', 'antiNuke');
        const freeze = this.heart.system.handler.$get<
            import('./freezeController.js').default
        >('security', 'freezeController');

        const lines: string[] = ['**Security status**'];

        if (freeze) {
            const f = await freeze.getStatus(guildId);
            lines.push(
                f?.active
                    ? `• Lockdown: **on** (invites=${f.pauseInvites ? 'paused' : 'ok'}, channels=${f.lockChannels ? 'locked' : 'ok'})`
                    : '• Lockdown: **off**',
            );
        }

        if (autoMod) {
            const s = await autoMod.getSettings(guildId);
            const onFilters = (
                [
                    'invites',
                    'links',
                    'caps',
                    'massMention',
                    'everyoneHere',
                    'rolePing',
                    'knownSpam',
                    'duplicates',
                ] as const
            ).filter((k) => s[k]);
            lines.push(
                s.enabled
                    ? `• AutoMod: **on** (${onFilters.join(', ') || 'no filters'})`
                    : '• AutoMod: **off**',
            );
        }

        if (raid) {
            const s = await raid.getSettings(guildId);
            const active = await raid.isRaidActive(guildId);
            lines.push(
                `• Raid: **${s.enabled ? 'on' : 'off'}** (active=${active ? 'yes' : 'no'}, ${s.maxJoins}/${Math.round(s.windowMs / 1000)}s, action=${s.action})`,
            );
        }

        if (verify) {
            const s = await verify.getSettings(guildId);
            lines.push(
                `• Verify: **${s.enabled ? 'on' : 'off'}** (verified=${s.verifiedRoleId ?? '—'}, quarantine=${s.quarantineRoleId ?? '—'})`,
            );
        }

        if (anti) {
            const rules = await anti.listRules(guildId);
            const enabled = rules.filter((r) => r.enabled);
            lines.push(
                enabled.length
                    ? `• Anti-nuke: **${enabled.length}** rule(s) enabled (${enabled.map((r) => r.eventKey).join(', ')})`
                    : '• Anti-nuke: **no rules enabled**',
            );
        }

        const q = await resolveQuarantineRoleId(this.heart, guildId);
        lines.push(`• Shared quarantine role: \`${q ?? 'not set'}\``);

        return lines.join('\n');
    }
}
