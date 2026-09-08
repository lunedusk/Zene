import {
    AttachmentBuilder,
    ButtonStyle,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
    type GuildMember,
    type TextChannel,
} from 'discord.js';
import { BaseHandler } from '#core/bases/Handler.js';
import { buildComponentsV2, replyCv2Text, type Cv2LayoutSpec } from '#core/builders/index.js';
import {
    hashChallengeCode,
    randomCaptchaCode,
    renderCaptchaPng,
} from '../lib/captchaCanvas.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import type { VerifySettings } from '../lib/types.js';
import type RaidGuardHandler from './raidGuard.js';
import type SecurityStoreHandler from './store.js';

const DEFAULT_VERIFY = (guildId: string): VerifySettings => ({
    guildId,
    enabled: false,
    verifiedRoleId: null,
    quarantineRoleId: null,
    maxAttempts: 3,
    challengeTtlMs: 120_000,
    updatedAt: Date.now(),
});

export const VERIFY_BUTTON_ID = 'security:verify:start';
export const VERIFY_MODAL_PREFIX = 'security:verify:modal:';
export const VERIFY_SUBMIT_PREFIX = 'security:verify:submit:';

export default class VerifyHandler extends BaseHandler {
    public readonly name = 'verify';
    public readonly version = '1.0.0';
    public readonly description = 'Canvas captcha verification panel and challenges.';

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async getSettings(guildId: string): Promise<VerifySettings> {
        const store = this.store();
        if (!store) return DEFAULT_VERIFY(guildId);
        return (await store.getVerifySettings(guildId)) ?? DEFAULT_VERIFY(guildId);
    }

    public async saveSettings(settings: VerifySettings): Promise<VerifySettings> {
        const store = this.store();
        if (!store) throw new Error('Security store unavailable');
        await store.upsertVerifySettings(settings);
        return settings;
    }

    public async postPanel(
        interaction: ChatInputCommandInteraction,
        channel: TextChannel,
    ): Promise<void> {
        const settings = await this.getSettings(interaction.guildId as string);
        if (!settings.enabled) {
            throw new Error('verify_disabled');
        }

        const layout: Cv2LayoutSpec = {
            version: 1,
            components: [
                {
                    type: 'container',
                    accentColor: 0x5865f2,
                    children: [
                        {
                            type: 'text',
                            content: this.heart.assets.lang.get(
                                'security',
                                'verify.panelTitle',
                                {},
                                interaction.locale,
                            ) || '**Server verification**',
                        },
                        {
                            type: 'text',
                            content:
                                this.heart.assets.lang.get(
                                    'security',
                                    'verify.panelBody',
                                    {},
                                    interaction.locale,
                                ) ||
                                'Click the button below and solve the captcha to get access.',
                        },
                        {
                            type: 'actionRow',
                            components: [
                                {
                                    type: 'button',
                                    style: 'primary',
                                    customId: VERIFY_BUTTON_ID,
                                    label:
                                        this.heart.assets.lang.get(
                                            'security',
                                            'verify.panelButton',
                                            {},
                                            interaction.locale,
                                        ) || 'Verify',
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        await channel.send(buildComponentsV2(layout));
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.VERIFY_PANEL, {
            guildId: interaction.guildId,
            channelId: channel.id,
            actorId: interaction.user.id,
        });
    }

    public async startChallenge(interaction: ButtonInteraction): Promise<void> {
        if (!interaction.guildId || !interaction.guild) return;
        const settings = await this.getSettings(interaction.guildId);
        if (!settings.enabled) {
            await interaction.reply({
                content: 'Verification is disabled on this server.',
                ephemeral: true,
            });
            return;
        }

        const raid = this.heart.system.handler.$get<RaidGuardHandler>('security', 'raidGuard');
        if (raid && (await raid.isVerifyPaused(interaction.guildId))) {
            await interaction.reply({
                content: 'Verification is temporarily paused due to raid protection. Try again later.',
                ephemeral: true,
            });
            return;
        }

        const code = randomCaptchaCode(6);
        let png: Buffer;
        try {
            const rendered = await renderCaptchaPng(code);
            png = rendered.png;
        } catch (err: unknown) {
            await interaction.reply({
                content: `Captcha unavailable: ${err instanceof Error ? err.message : String(err)}`,
                ephemeral: true,
            });
            return;
        }

        const cache = this.heart.cache.ns('security');
        const key = `verify:${interaction.guildId}:${interaction.user.id}`;
        await cache.set(
            key,
            JSON.stringify({
                hash: hashChallengeCode(code),
                attempts: 0,
                expiresAt: Date.now() + settings.challengeTtlMs,
            }),
            settings.challengeTtlMs,
        );

        const file = new AttachmentBuilder(png, { name: 'captcha.png' });
        const customId = `${VERIFY_SUBMIT_PREFIX}${interaction.user.id}`;

        await interaction.reply({
            content:
                'Solve the captcha: type the characters you see. Reply with the code using the button (opens a modal).',
            files: [file],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: ButtonStyle.Primary,
                            custom_id: customId,
                            label: 'Enter code',
                        },
                    ],
                },
            ],
            ephemeral: true,
        });
    }

    public async submitCode(
        interaction: ButtonInteraction | import('discord.js').ModalSubmitInteraction,
        code: string,
    ): Promise<void> {
        if (!interaction.guildId || !interaction.guild || !interaction.member) return;
        const settings = await this.getSettings(interaction.guildId);
        const cache = this.heart.cache.ns('security');
        const key = `verify:${interaction.guildId}:${interaction.user.id}`;
        const raw = await cache.get(key);
        if (!raw) {
            await this.safeReply(interaction, 'Challenge expired. Click Verify again.');
            return;
        }

        let state: { hash: string; attempts: number; expiresAt: number };
        try {
            state = JSON.parse(raw) as typeof state;
        } catch {
            await this.safeReply(interaction, 'Challenge corrupted. Click Verify again.');
            return;
        }

        if (Date.now() > state.expiresAt) {
            await cache.delete(key);
            await this.safeReply(interaction, 'Challenge expired. Click Verify again.');
            return;
        }

        const ok = hashChallengeCode(code.trim()) === state.hash;
        if (!ok) {
            state.attempts += 1;
            if (state.attempts >= settings.maxAttempts) {
                await cache.delete(key);
                await emitSecurityEvent(this.heart, SECURITY_EVENTS.VERIFY_FAIL, {
                    guildId: interaction.guildId,
                    userId: interaction.user.id,
                    reason: 'max_attempts',
                });
                await this.safeReply(interaction, 'Too many failed attempts. Start over from the panel.');
                return;
            }
            await cache.set(
                key,
                JSON.stringify(state),
                Math.max(5_000, state.expiresAt - Date.now()),
            );
            await emitSecurityEvent(this.heart, SECURITY_EVENTS.VERIFY_FAIL, {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                reason: 'mismatch',
                attempts: state.attempts,
            });
            await this.safeReply(
                interaction,
                `Incorrect code. Attempts left: ${settings.maxAttempts - state.attempts}.`,
            );
            return;
        }

        await cache.delete(key);
        const member = interaction.member as GuildMember;
        if (settings.quarantineRoleId) {
            await member.roles
                .remove(settings.quarantineRoleId, 'Security: verified')
                .catch(() => undefined);
        }
        if (settings.verifiedRoleId) {
            await member.roles
                .add(settings.verifiedRoleId, 'Security: verified')
                .catch(() => undefined);
        }

        await emitSecurityEvent(this.heart, SECURITY_EVENTS.VERIFY_SUCCESS, {
            guildId: interaction.guildId,
            userId: interaction.user.id,
        });
        await this.safeReply(interaction, 'Verified successfully.');
    }

    private async safeReply(
        interaction: ButtonInteraction | import('discord.js').ModalSubmitInteraction,
        content: string,
    ): Promise<void> {
        await replyCv2Text(interaction, {
            content,
            emoji: '🛡️',
            ephemeral: true,
            preferFollowUp: interaction.replied && !interaction.deferred,
        });
    }
}
