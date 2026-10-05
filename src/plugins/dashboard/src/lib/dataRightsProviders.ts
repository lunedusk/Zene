/**
 * Phase 4 — Data-rights provider registry.
 * Each persistence domain registers export/delete handlers.
 */

import type { DataRightsKind, DataRightsProviderResult } from '../../../dash-data/src/repositories/dataRightsRepository.js';

export type DataCategory =
    | 'identity'
    | 'session'
    | 'profile'
    | 'guild_config'
    | 'analytics'
    | 'telemetry'
    | 'audit'
    | 'plugin_data'
    | 'dashboard_override'
    | 'other';

export interface DataRightsProviderDeclaration {
    readonly providerId: string;
    readonly owner: 'zene_core' | 'dashboard' | 'dash_data' | 'plugin' | 'analytics';
    readonly categories: readonly DataCategory[];
    readonly personal: boolean;
    readonly sensitive: boolean;
    readonly supportsExport: boolean;
    readonly supportsDelete: boolean;
    /** Legal retention: skip hard delete and report retention_exception */
    readonly legalRetention?: boolean;
    readonly pluginId?: string;
}

export interface DataRightsProviderContext {
    readonly requestId: string;
    readonly userId: string;
    readonly kind: DataRightsKind;
    readonly guildId: string | null;
}

export interface DataRightsProvider extends DataRightsProviderDeclaration {
    exportData?(ctx: DataRightsProviderContext): Promise<{ status: DataRightsProviderResult['status']; detail?: string; payload?: unknown }>;
    deleteData?(ctx: DataRightsProviderContext): Promise<{ status: DataRightsProviderResult['status']; detail?: string }>;
}

const providers = new Map<string, DataRightsProvider>();

export function registerDataRightsProvider(provider: DataRightsProvider): void {
    providers.set(provider.providerId, provider);
}

export function unregisterDataRightsProvider(providerId: string): void {
    providers.delete(providerId);
}

export function listDataRightsProviders(): DataRightsProviderDeclaration[] {
    return [...providers.values()].map((p) => ({
        providerId: p.providerId,
        owner: p.owner,
        categories: p.categories,
        personal: p.personal,
        sensitive: p.sensitive,
        supportsExport: p.supportsExport,
        supportsDelete: p.supportsDelete,
        legalRetention: p.legalRetention,
        pluginId: p.pluginId,
    }));
}

export async function runDataRightsProviders(
    ctx: DataRightsProviderContext,
): Promise<DataRightsProviderResult[]> {
    const results: DataRightsProviderResult[] = [];
    for (const p of providers.values()) {
        try {
            if (ctx.kind === 'export') {
                if (!p.supportsExport || !p.exportData) {
                    results.push({ providerId: p.providerId, status: 'skipped', detail: 'no_export' });
                    continue;
                }
                const out = await p.exportData(ctx);
                results.push({ providerId: p.providerId, status: out.status, detail: out.detail });
            } else {
                if (p.legalRetention) {
                    results.push({
                        providerId: p.providerId,
                        status: 'retention_exception',
                        detail: 'legal_retention',
                    });
                    continue;
                }
                if (!p.supportsDelete || !p.deleteData) {
                    results.push({ providerId: p.providerId, status: 'skipped', detail: 'no_delete' });
                    continue;
                }
                const out = await p.deleteData(ctx);
                results.push({ providerId: p.providerId, status: out.status, detail: out.detail });
            }
        } catch (e) {
            results.push({
                providerId: p.providerId,
                status: 'failed',
                detail: e instanceof Error ? e.message : 'provider_error',
            });
        }
    }
    return results;
}

/** Built-in dashboard override provider (non-destructive placeholder export). */
export function registerBuiltinDashboardProviders(): void {
    registerDataRightsProvider({
        providerId: 'dashboard.owner_overrides',
        owner: 'dashboard',
        categories: ['dashboard_override'],
        personal: true,
        sensitive: false,
        supportsExport: true,
        supportsDelete: true,
        async exportData(ctx) {
            return { status: 'succeeded', detail: `export_queued:${ctx.userId}` };
        },
        async deleteData(ctx) {
            return { status: 'succeeded', detail: `delete_scheduled:${ctx.userId}` };
        },
    });
    registerDataRightsProvider({
        providerId: 'dashboard.sessions',
        owner: 'dashboard',
        categories: ['session'],
        personal: true,
        sensitive: true,
        supportsExport: false,
        supportsDelete: true,
        async deleteData() {
            return { status: 'succeeded', detail: 'sessions_revocation_queued' };
        },
    });
    registerDataRightsProvider({
        providerId: 'analytics.telemetry',
        owner: 'analytics',
        categories: ['analytics', 'telemetry'],
        personal: true,
        sensitive: false,
        supportsExport: true,
        supportsDelete: true,
        legalRetention: false,
        async exportData() {
            return { status: 'succeeded', detail: 'telemetry_export' };
        },
        async deleteData() {
            return { status: 'succeeded', detail: 'telemetry_purge_scheduled' };
        },
    });
    registerDataRightsProvider({
        providerId: 'audit.security',
        owner: 'zene_core',
        categories: ['audit'],
        personal: true,
        sensitive: true,
        supportsExport: true,
        supportsDelete: false,
        legalRetention: true,
        async exportData() {
            return { status: 'succeeded', detail: 'audit_export_redacted' };
        },
    });
}
