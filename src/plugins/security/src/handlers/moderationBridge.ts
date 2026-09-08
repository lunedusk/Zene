import { BaseHandler } from '#core/bases/Handler.js';
import type ModerationHandler from '../../../core/src/handlers/moderation.js';
import type {
    BanOptions,
    KickOptions,
    TimeoutOptions,
    UntimeoutOptions,
    ModerationBatchResult,
    ModerationActor,
} from '../../../core/src/handlers/moderation.js';
import { emitPunishEvent } from '../lib/events.js';
import type {
    ActionBatchResult,
    PerGuildActionResult,
    PunishOp,
    SecurityActor,
} from '../lib/types.js';
import type SecurityStoreHandler from './store.js';

function toSecurityResults(batch: ModerationBatchResult): PerGuildActionResult[] {
    return batch.results.map((r) => ({
        guildId: r.guildId,
        ok: r.ok,
        code: r.code,
        detail: r.detail,
        vars: r.vars,
    }));
}

function actorOf(a: SecurityActor): ModerationActor {
    return { userId: a.userId, tag: a.tag };
}

export default class ModerationBridgeHandler extends BaseHandler {
    public readonly name = 'moderationBridge';
    public readonly version = '1.0.0';
    public readonly description =
        'Security-facing moderation bridge over core moderation (ban/kick/timeout/softban/tempban/hackban).';

    private core(): ModerationHandler | undefined {
        return this.heart.system.handler.$get<ModerationHandler>('core', 'moderation');
    }

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    private requireCore(): ModerationHandler {
        const h = this.core();
        if (!h) {
            throw new Error('Core moderation handler is not available.');
        }
        return h;
    }

    private async afterAction(
        op: PunishOp,
        opts: {
            guildIds: readonly string[];
            actor: SecurityActor;
            targetUserId: string;
            reason?: string;
            durationMs?: number;
            deleteMessageSeconds?: number;
            batch: ModerationBatchResult;
            denied?: ActionBatchResult['denied'];
            proof?: {
                proofUrl: string;
                proofName: string;
                proofContentType: string | null;
                proofSize: number;
            } | null;
        },
    ): Promise<ActionBatchResult> {
        const results = toSecurityResults(opts.batch);
        const denied = opts.denied ?? [];
        const okCount = results.filter((r) => r.ok).length;
        const result: ActionBatchResult = {
            ok: opts.batch.ok && denied.length === 0,
            results,
            code: opts.batch.code,
            vars: opts.batch.vars,
            denied,
        };

        const store = this.store();
        if (store && okCount > 0) {
            for (const r of results) {
                if (!r.ok) continue;
                try {
                    await store.recordInfraction({
                        guildId: r.guildId,
                        userId: opts.targetUserId,
                        actorId: opts.actor.userId,
                        type: op,
                        reason: opts.reason ?? null,
                        metadata: {
                            durationMs: opts.durationMs ?? null,
                            deleteMessageSeconds: opts.deleteMessageSeconds ?? null,
                            ...(opts.proof
                                ? {
                                      proofUrl: opts.proof.proofUrl,
                                      proofName: opts.proof.proofName,
                                      proofContentType: opts.proof.proofContentType,
                                      proofSize: opts.proof.proofSize,
                                  }
                                : {}),
                        },
                    });
                } catch (err: unknown) {
                    this.log.warn(
                        `Failed to record infraction for ${op} in ${r.guildId}: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
            }
        }

        await emitPunishEvent(this.heart, op, {
            guildIds: opts.guildIds,
            actor: opts.actor,
            targetUserId: opts.targetUserId,
            reason: opts.reason,
            durationMs: opts.durationMs,
            deleteMessageSeconds: opts.deleteMessageSeconds,
            source: 'command',
            result,
        });

        return result;
    }

    public async ban(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        reason?: string;
        deleteMessageSeconds?: number;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const opts: BanOptions = {
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason,
            deleteMessageSeconds: input.deleteMessageSeconds,
        };
        const batch = await core.ban(opts);
        return this.afterAction('ban', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            deleteMessageSeconds: input.deleteMessageSeconds,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    public async unban(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        reason?: string;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const opts: BanOptions = {
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason,
        };
        const batch = await core.unban(opts);
        return this.afterAction('unban', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    public async kick(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        reason?: string;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const opts: KickOptions = {
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason,
        };
        const batch = await core.kick(opts);
        return this.afterAction('kick', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    public async timeout(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        durationMs: number;
        reason?: string;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const opts: TimeoutOptions = {
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            durationMs: input.durationMs,
            reason: input.reason,
        };
        const batch = await core.timeout(opts);
        return this.afterAction('timeout', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            durationMs: input.durationMs,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    public async untimeout(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        reason?: string;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const opts: UntimeoutOptions = {
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason,
        };
        const batch = await core.untimeout(opts);
        return this.afterAction('untimeout', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    /** Ban then immediately unban, optionally deleting recent messages. */
    public async softban(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        reason?: string;
        deleteMessageSeconds?: number;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const banBatch = await core.ban({
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason,
            deleteMessageSeconds: input.deleteMessageSeconds ?? 86400,
        });

        const succeeded = banBatch.results.filter((r) => r.ok).map((r) => r.guildId);
        let unbanBatch: ModerationBatchResult = { ok: true, results: [] };
        if (succeeded.length > 0) {
            unbanBatch = await core.unban({
                guilds: succeeded,
                userId: input.userId,
                actor: actorOf(input.actor),
                reason: input.reason ? `Softban: ${input.reason}` : 'Softban',
            });
        }

        const merged: ModerationBatchResult = {
            ok: banBatch.ok && unbanBatch.ok,
            results: banBatch.results.map((br) => {
                if (!br.ok) return br;
                const ur = unbanBatch.results.find((x) => x.guildId === br.guildId);
                if (!ur || !ur.ok) {
                    return {
                        guildId: br.guildId,
                        ok: false,
                        code: ur?.code ?? 'action_failed',
                        vars: ur?.vars,
                        detail: ur?.detail ?? 'Unban after softban failed',
                    };
                }
                return { guildId: br.guildId, ok: true };
            }),
            code: banBatch.ok ? unbanBatch.code : banBatch.code,
            vars: banBatch.ok ? unbanBatch.vars : banBatch.vars,
        };

        return this.afterAction('softban', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            deleteMessageSeconds: input.deleteMessageSeconds,
            batch: merged,
            denied: input.denied,
            proof: input.proof,
        });
    }

    /** Ban by user ID (member need not be present). Emits as hackban. */
    public async hackban(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        reason?: string;
        deleteMessageSeconds?: number;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const batch = await core.ban({
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason,
            deleteMessageSeconds: input.deleteMessageSeconds ?? 0,
        });
        return this.afterAction('hackban', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            deleteMessageSeconds: input.deleteMessageSeconds,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    /**
     * Ban and schedule an automatic unban. Pending rows are polled by the
     * security plugin scheduler task registered in onEnable.
     */
    public async tempban(input: {
        guildIds: readonly string[];
        userId: string;
        actor: SecurityActor;
        durationMs: number;
        reason?: string;
        deleteMessageSeconds?: number;
        denied?: ActionBatchResult['denied'];
        proof?: {
            proofUrl: string;
            proofName: string;
            proofContentType: string | null;
            proofSize: number;
        } | null;
    }): Promise<ActionBatchResult> {
        const core = this.requireCore();
        const batch = await core.ban({
            guilds: [...input.guildIds],
            userId: input.userId,
            actor: actorOf(input.actor),
            reason: input.reason
                ? `Tempban (${input.durationMs}ms): ${input.reason}`
                : `Tempban (${input.durationMs}ms)`,
            deleteMessageSeconds: input.deleteMessageSeconds,
        });

        const store = this.store();
        const expiresAt = Date.now() + input.durationMs;
        if (store) {
            for (const r of batch.results) {
                if (!r.ok) continue;
                try {
                    await store.addTempban({
                        guildId: r.guildId,
                        userId: input.userId,
                        actorId: input.actor.userId,
                        reason: input.reason ?? null,
                        expiresAt,
                    });
                } catch (err: unknown) {
                    this.log.warn(
                        `Failed to persist tempban for ${input.userId} in ${r.guildId}: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
            }
        }

        return this.afterAction('tempban', {
            guildIds: input.guildIds,
            actor: input.actor,
            targetUserId: input.userId,
            reason: input.reason,
            durationMs: input.durationMs,
            deleteMessageSeconds: input.deleteMessageSeconds,
            batch,
            denied: input.denied,
            proof: input.proof,
        });
    }

    /** Process due tempbans (called by scheduler). */
    public async processDueTempbans(): Promise<number> {
        const store = this.store();
        const core = this.core();
        if (!store || !core) return 0;

        const due = await store.listDueTempbans();
        let processed = 0;
        for (const row of due) {
            try {
                await core.unban({
                    guilds: [row.guildId],
                    userId: row.userId,
                    actor: { userId: row.actorId, tag: 'security:tempban-expiry' },
                    reason: 'Temporary ban expired',
                });
            } catch (err: unknown) {
                this.log.warn(
                    `Tempban unban failed for ${row.userId} in ${row.guildId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
            try {
                await store.removeTempban(row.id);
            } catch (err: unknown) {
                this.log.warn(
                    `Failed to remove tempban row ${row.id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
            processed += 1;
        }
        return processed;
    }
}
