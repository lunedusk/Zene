



import { kvGet, kvSet, newId } from '../lib/store.js';

export type DataRightsStatus =
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'scheduled'
    | 'processing'
    | 'partially_completed'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type DataRightsKind = 'export' | 'deletion';

export interface DataRightsProviderResult {
    providerId: string;
    status: 'succeeded' | 'failed' | 'skipped' | 'retention_exception';
    detail?: string;
}

export interface DataRightsRequest {
    requestId: string;
    userId: string;
    kind: DataRightsKind;

    guildId: string | null;
    status: DataRightsStatus;
    requestedAt: number;
    reviewerId?: string;
    reviewedAt?: number;
    scheduledAt?: number;
    startedAt?: number;
    completedAt?: number;
    failure?: string;
    providerResults?: DataRightsProviderResult[];

    recoverabilityUntil?: number;

    restrictedUntil?: number;
}

const NS = 'data_rights';
const NS_BY_USER = 'data_rights_by_user';

export async function createDataRightsRequest(input: {
    userId: string;
    kind: DataRightsKind;
    guildId?: string | null;
}): Promise<DataRightsRequest> {
    const requestId = newId('dr');
    const rec: DataRightsRequest = {
        requestId,
        userId: input.userId,
        kind: input.kind,
        guildId: input.guildId ?? null,
        status: 'pending',
        requestedAt: Date.now(),
    };
    await kvSet(NS, requestId, rec);
    const listRaw = await kvGet(NS_BY_USER, input.userId);
    const list = Array.isArray(listRaw) ? (listRaw as string[]) : [];
    list.push(requestId);
    await kvSet(NS_BY_USER, input.userId, list.slice(-100));
    return rec;
}

export async function getDataRightsRequest(requestId: string): Promise<DataRightsRequest | null> {
    const raw = await kvGet(NS, requestId);
    return raw && typeof raw === 'object' ? (raw as DataRightsRequest) : null;
}

export async function updateDataRightsRequest(
    requestId: string,
    patch: Partial<DataRightsRequest>,
): Promise<DataRightsRequest | null> {
    const cur = await getDataRightsRequest(requestId);
    if (!cur) return null;
    const next = { ...cur, ...patch, requestId: cur.requestId };
    await kvSet(NS, requestId, next);
    return next;
}

export type DataRightsProvider = {
    providerId: string;

    supports: (req: DataRightsRequest) => boolean;
    deleteEligible: (req: DataRightsRequest) => Promise<DataRightsProviderResult>;
    exportEligible?: (req: DataRightsRequest) => Promise<DataRightsProviderResult>;
};

const providers: DataRightsProvider[] = [];

export function registerDataRightsProvider(p: DataRightsProvider): void {
    providers.push(p);
}

export function listDataRightsProviders(): readonly DataRightsProvider[] {
    return providers;
}


export function ensureBuiltinDataRightsProviders(): void {
    if (providers.some((p) => p.providerId === 'dashboard.kv_marker')) return;
    registerDataRightsProvider({
        providerId: 'dashboard.kv_marker',
        supports: () => true,
        deleteEligible: async () => ({
            providerId: 'dashboard.kv_marker',
            status: 'succeeded',
            detail: 'marker_only_foundation',
        }),
        exportEligible: async () => ({
            providerId: 'dashboard.kv_marker',
            status: 'succeeded',
            detail: 'marker_only_foundation',
        }),
    });
}
