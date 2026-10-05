



import {
    runDataRightsProviders,
    registerDataRightsProvider,
    type DataRightsProvider,
    type DataRightsProviderContext,
} from '../dataRightsProviders.js';
import type { DataRightsProviderResult } from '../../../../dash-data/src/repositories/dataRightsRepository.js';
import { publishCrossHost, subscribeCrossHostChannel } from '../crossHost/transportBus.js';

const CHANNEL = 'dash.data_rights.execute';

export type AggregateStatus = 'completed' | 'partial' | 'failed';

export function aggregateProviderResults(results: readonly DataRightsProviderResult[]): {
    status: AggregateStatus;
    results: readonly DataRightsProviderResult[];
} {
    if (results.length === 0) return { status: 'completed', results };
    const failed = results.filter((r) => r.status === 'failed');
    const succeeded = results.filter((r) => r.status === 'succeeded' || r.status === 'retention_exception');
    if (failed.length === 0) return { status: 'completed', results };
    if (succeeded.length === 0) return { status: 'failed', results };
    return { status: 'partial', results };
}




export function registerRemoteDataRightsProvider(input: {
    providerId: string;
    remoteWorkerId: string;
    timeoutMs?: number;
}): void {
    const timeoutMs = input.timeoutMs ?? 5_000;
    const provider: DataRightsProvider = {
        providerId: input.providerId,
        owner: 'plugin',
        categories: ['plugin_data'],
        personal: true,
        sensitive: true,
        supportsExport: true,
        supportsDelete: true,
        async exportData(ctx) {
            return remoteCall(input.remoteWorkerId, 'export', ctx, timeoutMs);
        },
        async deleteData(ctx) {
            return remoteCall(input.remoteWorkerId, 'delete', ctx, timeoutMs);
        },
    };
    registerDataRightsProvider(provider);
}

async function remoteCall(
    remoteWorkerId: string,
    op: 'export' | 'delete',
    ctx: DataRightsProviderContext,
    timeoutMs: number,
): Promise<{ status: DataRightsProviderResult['status']; detail?: string }> {
    return new Promise((resolve) => {
        const replyChannel = `${CHANNEL}.reply.${ctx.requestId}`;
        const timer = setTimeout(() => {
            unsub();
            resolve({ status: 'failed', detail: 'timeout' });
        }, timeoutMs);
        const unsub = subscribeCrossHostChannel(replyChannel, (env) => {
            if (env.sourceWorkerId !== remoteWorkerId) return;
            clearTimeout(timer);
            unsub();
            const p = env.payload as { status?: DataRightsProviderResult['status']; detail?: string };
            resolve({
                status: p.status ?? 'failed',
                detail: p.detail,
            });
        });
        void publishCrossHost(CHANNEL, 'orchestrator', 'data_rights.remote', {
            op,
            remoteWorkerId,
            ctx,
            replyChannel,
        });
    });
}




export function startDataRightsRemoteWorker(
    workerId: string,
    handlers: {
        exportData?: (ctx: DataRightsProviderContext) => Promise<{ status: DataRightsProviderResult['status']; detail?: string }>;
        deleteData?: (ctx: DataRightsProviderContext) => Promise<{ status: DataRightsProviderResult['status']; detail?: string }>;
    },
): () => void {
    return subscribeCrossHostChannel(CHANNEL, async (env) => {
        const p = env.payload as {
            op?: string;
            remoteWorkerId?: string;
            ctx?: DataRightsProviderContext;
            replyChannel?: string;
        };
        if (p.remoteWorkerId !== workerId || !p.ctx || !p.replyChannel) return;
        let result: { status: DataRightsProviderResult['status']; detail?: string };
        try {
            if (p.op === 'export' && handlers.exportData) {
                result = await handlers.exportData(p.ctx);
            } else if (p.op === 'delete' && handlers.deleteData) {
                result = await handlers.deleteData(p.ctx);
            } else {
                result = { status: 'skipped', detail: 'no_handler' };
            }
        } catch (e) {
            result = { status: 'failed', detail: e instanceof Error ? e.message : 'error' };
        }
        await publishCrossHost(p.replyChannel, workerId, 'data_rights.reply', result);
    });
}

export async function executeDataRightsRequest(
    ctx: DataRightsProviderContext,
): Promise<{ status: AggregateStatus; results: readonly DataRightsProviderResult[] }> {
    const results = await runDataRightsProviders(ctx);
    return aggregateProviderResults(results);
}
