import type { ChatInputCommandInteraction, User } from 'discord.js';
import type { IHeart } from '#core/heart/index.js';
import type { CooldownOp } from '../lib/cooldowns.js';
import type { ActionBatchResult, GuildAuthzDecision, PunishOp } from '../lib/types.js';
import type { ProofMeta } from '../lib/proof.js';

/** Shared surface for security subcommand modules (bound to SecurityCommand instance). */
export interface SecurityCmdHost {
    readonly heart: IHeart;
    t(key: string, vars?: Record<string, string | number>, locale?: string): string;
    replyText(interaction: ChatInputCommandInteraction, content: string): Promise<void>;
    replyLines(
        interaction: ChatInputCommandInteraction,
        header: string,
        lines: string[],
    ): Promise<void>;
    replyDeniedOnly(
        interaction: ChatInputCommandInteraction,
        denied: readonly GuildAuthzDecision[],
    ): Promise<void>;
    replyActionResult(
        interaction: ChatInputCommandInteraction,
        op: PunishOp,
        target: User,
        result: ActionBatchResult,
        durationMs?: number,
        proof?: ProofMeta | null,
    ): Promise<void>;
    requireBit(
        interaction: ChatInputCommandInteraction,
        bit: string,
        guildId: string,
    ): Promise<boolean>;
    denyIfCooldown(
        interaction: ChatInputCommandInteraction,
        guildId: string,
        op: CooldownOp,
    ): Promise<boolean>;
}
