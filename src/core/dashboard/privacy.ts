/**
 * Dashboard privacy surface — delegates to Core Data Registry only.
 */

import { dataRegistry } from '#core/data/index.js';
import type { DashboardPrincipal } from './authContext.js';
import { DashboardAuthError } from './authContext.js';
import { principalHasBits } from './authContext.js';

export function listPrivacyCategories(principal: DashboardPrincipal): readonly {
    typeId: string;
    privacyClass: string;
    personalData: boolean;
    ownerPluginId: string;
}[] {
    void principal;
    return dataRegistry.listTypes().map((t) => ({
        typeId: t.id,
        privacyClass: t.privacyClass,
        personalData: t.personalData,
        ownerPluginId: t.ownerPluginId,
    }));
}

export async function requestDataExport(
    principal: DashboardPrincipal,
    typeId: string,
    subject: { userId?: string; guildId?: string },
): Promise<unknown> {
    const sub = {
        userId: subject.userId ?? principal.userId,
        guildId: subject.guildId,
    };
    if (sub.userId !== principal.userId && !principal.isEnvOwner) {
        throw new DashboardAuthError('forbidden', 'Cannot export another user data');
    }
    return dataRegistry.export(typeId, sub, 'dashboard');
}

export async function requestDataDeletion(
    principal: DashboardPrincipal,
    typeId: string,
    subject: { userId?: string; guildId?: string },
    requiredBits: readonly string[] = ['privacy.delete'],
): Promise<number> {
    if (!principalHasBits(principal, requiredBits, 'all')) {
        throw new DashboardAuthError('forbidden', 'Deletion not authorized');
    }
    const sub = {
        userId: subject.userId ?? principal.userId,
        guildId: subject.guildId,
    };
    if (sub.userId !== principal.userId && !principal.isEnvOwner) {
        throw new DashboardAuthError('forbidden', 'Cannot delete another user data');
    }
    const res = await dataRegistry.delete(typeId, sub, 'dashboard');
    return res.deleted;
}
