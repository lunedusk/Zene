import type { IHeart } from '#core/heart/index.js';
import type SecurityStoreHandler from '../handlers/store.js';

/**
 * Resolve the shared quarantine role for a guild.
 * Preference: verify settings → raid settings → null.
 */
export async function resolveQuarantineRoleId(
    heart: IHeart,
    guildId: string,
): Promise<string | null> {
    const store = heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    if (!store) return null;

    const verify = await store.getVerifySettings(guildId);
    if (verify?.quarantineRoleId) return verify.quarantineRoleId;

    const raid = await store.getRaidSettings(guildId);
    if (raid?.quarantineRoleId) return raid.quarantineRoleId;

    return null;
}

/**
 * Keep raid + verify quarantine role IDs in sync when one side is set.
 */
export async function syncQuarantineRoleId(
    heart: IHeart,
    guildId: string,
    roleId: string | null,
): Promise<void> {
    const store = heart.system.handler.$get<SecurityStoreHandler>('security', 'store');
    if (!store) return;
    const now = Date.now();

    const raid = await store.getRaidSettings(guildId);
    if (raid) {
        await store.upsertRaidSettings({
            ...raid,
            quarantineRoleId: roleId,
            updatedAt: now,
        });
    } else if (roleId) {
        await store.upsertRaidSettings({
            guildId,
            enabled: false,
            maxJoins: 8,
            windowMs: 15_000,
            action: 'quarantine',
            quarantineRoleId: roleId,
            pauseVerifyMs: 300_000,
            joinRoleId: null,
            updatedAt: now,
        });
    }

    const verify = await store.getVerifySettings(guildId);
    if (verify) {
        await store.upsertVerifySettings({
            ...verify,
            quarantineRoleId: roleId,
            updatedAt: now,
        });
    } else if (roleId) {
        await store.upsertVerifySettings({
            guildId,
            enabled: false,
            verifiedRoleId: null,
            quarantineRoleId: roleId,
            maxAttempts: 3,
            challengeTtlMs: 120_000,
            updatedAt: now,
        });
    }
}
