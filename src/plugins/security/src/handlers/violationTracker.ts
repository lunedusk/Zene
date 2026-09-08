import { BaseHandler } from '#core/bases/Handler.js';
import { emitSecurityEvent, SECURITY_EVENTS } from '../lib/events.js';
import type { ViolationRow } from '../lib/types.js';
import type SecurityStoreHandler from './store.js';

const DEFAULT_CLEAN_DAYS = 7;
const DEFAULT_DECAY_POINTS = 1;

export default class ViolationTrackerHandler extends BaseHandler {
    public readonly name = 'violationTracker';
    public readonly version = '1.0.0';
    public readonly description = 'Violation points, manual edit, and strike expiry decay.';

    private store(): SecurityStoreHandler | undefined {
        return this.heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    }

    public async get(guildId: string, userId: string): Promise<ViolationRow | null> {
        return (await this.store()?.getViolation(guildId, userId)) ?? null;
    }

    public async set(
        guildId: string,
        userId: string,
        points: number,
        actorId: string,
    ): Promise<ViolationRow> {
        const store = this.store();
        if (!store) throw new Error('Security store unavailable');
        const row = await store.setViolation({ guildId, userId, points, touchActivity: true });
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.VIOLATION_UPDATE, {
            guildId,
            userId,
            actorId,
            points: row.points,
            mode: 'set',
        });
        return row;
    }

    public async add(
        guildId: string,
        userId: string,
        delta: number,
        actorId: string,
    ): Promise<ViolationRow> {
        const store = this.store();
        if (!store) throw new Error('Security store unavailable');
        const existing = await store.getViolation(guildId, userId);
        const next = Math.max(0, (existing?.points ?? 0) + delta);
        const row = await store.setViolation({
            guildId,
            userId,
            points: next,
            touchActivity: delta > 0,
        });
        await emitSecurityEvent(this.heart, SECURITY_EVENTS.VIOLATION_UPDATE, {
            guildId,
            userId,
            actorId,
            points: row.points,
            delta,
            mode: 'add',
        });
        return row;
    }

    public async reset(guildId: string, userId: string, actorId: string): Promise<ViolationRow> {
        return this.set(guildId, userId, 0, actorId);
    }

    /**
     * Decay points for users with no activity for `cleanDays`.
     * Returns number of users decayed.
     */
    public async processStrikeExpiry(
        cleanDays: number = DEFAULT_CLEAN_DAYS,
        decayPoints: number = DEFAULT_DECAY_POINTS,
    ): Promise<number> {
        const store = this.store();
        if (!store) return 0;

        const stale = await store.listStaleViolations(cleanDays);
        let count = 0;
        for (const row of stale) {
            const next = Math.max(0, row.points - decayPoints);
            if (next === row.points) continue;
            await store.setViolation({
                guildId: row.guildId,
                userId: row.userId,
                points: next,
                touchActivity: false,
            });
            await emitSecurityEvent(this.heart, SECURITY_EVENTS.VIOLATION_UPDATE, {
                guildId: row.guildId,
                userId: row.userId,
                actorId: 'system:strike-expiry',
                points: next,
                mode: 'decay',
            });
            count += 1;
        }
        return count;
    }
}
