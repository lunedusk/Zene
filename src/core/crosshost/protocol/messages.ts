import { z } from 'zod';

export const pluginIdVersionSchema = z.object({
    id: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
});

export const registerRequestSchema = z.object({
    machineId: z.string().min(1).max(128),
    zeneVersion: z.string().min(1).max(64),
    plugins: z.array(pluginIdVersionSchema).max(512),
    nodeVersion: z.string().min(1).max(64),
    platform: z.string().min(1).max(64),
    arch: z.string().min(1).max(64),
    bootGeneration: z.string().min(1).max(128),
    labels: z.record(z.string(), z.string()).optional(),
    apiBaseUrl: z.string().url().max(512).nullable().optional(),
    challengeId: z.string().min(1).max(128),
    hmac: z.string().min(1).max(256),
});

export type RegisterRequestParsed = z.infer<typeof registerRequestSchema>;

export const challengeQuerySchema = z.object({
    machineId: z.string().min(1).max(128),
});

export type ChallengeQueryParsed = z.infer<typeof challengeQuerySchema>;

export const snapshotNotifySchema = z.object({
    version: z.number().int().nonnegative(),
    hash: z.string().min(1),
    mode: z.enum(['full', 'diff']),
    baseVersion: z.number().int().nonnegative().optional(),
    patch: z.unknown().optional(),
});

export const assignmentUpdateSchema = z.object({
    generation: z.number().int().positive(),
    machineId: z.string().min(1),
    shards: z.array(z.number().int().nonnegative()),
    totalShards: z.number().int().positive(),
    reason: z.enum(['join', 'leave', 'rebalance', 'drain', 'reshard', 'manual', 'recovery']),
});

export const identifyGrantSchema = z.object({
    machineId: z.string().min(1),
    shardId: z.number().int().nonnegative(),
    grantId: z.string().min(1),
    expiresAt: z.number().int().positive(),
    allowResume: z.boolean(),
});

export const heartbeatSchema = z.object({
    machineId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    shards: z.array(z.number().int().nonnegative()),
    snapshotVersionAck: z.number().int().nonnegative(),
    at: z.number().int().positive(),
    apiBaseUrl: z.string().url().max(512).nullable().optional(),
});

export const statsMessageSchema = z.object({
    machineId: z.string().min(1),
    guildCount: z.number().nonnegative(),
    memberCount: z.number().nonnegative().nullable(),
    eventRate: z.number().nonnegative(),
    commandRate: z.number().nonnegative(),
    shardCount: z.number().int().nonnegative(),
    customGauges: z.record(z.string(), z.number()),
    at: z.number().int().positive(),
});

export const updateInstructSchema = z.object({
    machineId: z.string().min(1),
    generation: z.number().int().positive(),
    desiredState: z.object({
        zeneVersion: z.string().min(1),
        plugins: z.array(pluginIdVersionSchema),
    }),
    instructId: z.string().min(1),
});

export const updateAckSchema = z.object({
    machineId: z.string().min(1),
    instructId: z.string().min(1),
    ok: z.boolean(),
    message: z.string(),
    at: z.number().int().positive(),
});

export const queryRequestSchema = z.object({
    requestId: z.string().min(1),
    targetMachineId: z.string().min(1),
    op: z.enum(['audit.list', 'audit.get', 'error.list', 'error.get']),
    payload: z.unknown(),
});

export const queryResponseSchema = z.object({
    requestId: z.string().min(1),
    machineId: z.string().min(1),
    ok: z.boolean(),
    partial: z.boolean().optional(),
    data: z.unknown().optional(),
    error: z.string().optional(),
});

export const PLUGIN_BUS_PROTOCOL_VERSION = 1 as const;

const pluginBusBaseFields = {
    kind: z.enum(['send', 'request', 'response']),
    channel: z.string().min(1).max(256),
    fromMachineId: z.string().min(1).max(128),
    toMachineId: z.string().min(1).max(128),
    payload: z.unknown(),
    requestId: z.string().min(1).max(128).optional(),
    sourcePluginId: z.string().min(1).max(128).optional(),
    runtimeId: z.string().min(1).max(128).optional(),
    generation: z.number().int().nonnegative().optional(),
} as const;

/** Legacy envelopes omit `v` and may omit messageId/trackingId. */
export const pluginBusLegacyMessageSchema = z.object({
    ...pluginBusBaseFields,
    v: z.undefined().optional(),
    messageId: z.string().min(1).max(128).optional(),
    trackingId: z.string().min(1).max(128).optional(),
});

/** Explicit v1 envelopes require messageId and trackingId. */
export const pluginBusV1MessageSchema = z.object({
    ...pluginBusBaseFields,
    v: z.literal(1),
    messageId: z.string().min(1).max(128),
    trackingId: z.string().min(1).max(128),
});

export type PluginBusMessageV1 = z.infer<typeof pluginBusV1MessageSchema>;

/**
 * Parse a plugin-bus envelope.
 * - no `v` → legacy schema
 * - `v === 1` → strict v1 schema
 * - other `v` → unsupported (success false, unsupportedVersion true)
 */
export function parsePluginBusMessage(raw: unknown): {
    success: boolean;
    data?: z.infer<typeof pluginBusLegacyMessageSchema> | PluginBusMessageV1;
    unsupportedVersion?: boolean;
    error?: z.ZodError;
} {
    if (raw && typeof raw === 'object' && 'v' in raw) {
        const v = (raw as { v: unknown }).v;
        if (v !== undefined && v !== 1) {
            return { success: false, unsupportedVersion: true };
        }
        if (v === 1) {
            const parsed = pluginBusV1MessageSchema.safeParse(raw);
            if (!parsed.success) {
                return { success: false, error: parsed.error };
            }
            return { success: true, data: parsed.data };
        }
    }
    const parsed = pluginBusLegacyMessageSchema.safeParse(raw);
    if (!parsed.success) {
        return { success: false, error: parsed.error };
    }
    return { success: true, data: parsed.data };
}

/** @deprecated Prefer parsePluginBusMessage — retained for loose legacy-only checks. */
export const pluginBusMessageSchema = pluginBusLegacyMessageSchema;

export const controlShutdownSchema = z.object({
    scope: z.enum(['fleet', 'machine', 'orchestrator']),
    machineId: z.string().min(1).optional(),
    reason: z.string(),
    fromMachineId: z.string().min(1),
});
