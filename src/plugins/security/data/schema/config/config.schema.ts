import { z } from 'zod';

export const configSchema = z
    .object({
        enabled: z.boolean().default(true),
        dataBackend: z
            .object({
                engine: z.string().optional(),
                alias: z.string().optional(),
            })
            .optional()
            .default({}),
        cooldowns: z
            .object({
                ban: z.number().nonnegative().optional(),
                kick: z.number().nonnegative().optional(),
                timeout: z.number().nonnegative().optional(),
                warn: z.number().nonnegative().optional(),
                purge: z.number().nonnegative().optional(),
                lockdown: z.number().nonnegative().optional(),
            })
            .optional(),
        snipe: z
            .object({
                ttlMinutes: z.number().positive().optional(),
                maxPerChannel: z.number().int().positive().optional(),
            })
            .optional(),
        violations: z
            .object({
                cleanDays: z.number().positive().optional(),
                decayPoints: z.number().nonnegative().optional(),
                pointsOnWarn: z.number().nonnegative().optional(),
            })
            .optional(),
        lockdown: z
            .object({
                defaultPauseInvites: z.boolean().optional(),
                defaultLockChannels: z.boolean().optional(),
                defaultQuarantineJoins: z.boolean().optional(),
            })
            .optional(),
    })
    .catchall(z.unknown());

export default configSchema;
