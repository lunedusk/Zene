




import {
    checkTsxCompatibility,
    compileTsxDraft,
    contentHash,
    type TsxArtifactMeta,
} from '../tsxRuntimeContract.js';
import { requirePluginContribution } from '../pluginContributionGate.js';

export interface TsxPublishGateInput {
    readonly source: string;
    readonly authorUserId: string;
    readonly version: number;
    readonly zeneVersion: string;
    readonly dashSdkCompat: string;
    readonly requiredSdk: string;
    readonly runtimeCompat: string;
    readonly requiredRuntime: string;
    readonly pluginId?: string;
}

export interface TsxPublishGateResult {
    readonly ok: boolean;
    readonly meta?: TsxArtifactMeta;
    readonly error?: string;
    readonly artifactId?: string;
}

const published = new Map<string, TsxArtifactMeta>();
const disabled = new Set<string>();

export function gateTsxPublish(input: TsxPublishGateInput): TsxPublishGateResult {
    if (input.pluginId) {
        try {
            requirePluginContribution(input.pluginId, 'tsx');
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : 'PLUGIN_INTEGRITY_DENIED',
            };
        }
    }
    const compat = checkTsxCompatibility({
        zeneVersion: input.zeneVersion,
        dashSdkCompat: input.dashSdkCompat,
        requiredSdk: input.requiredSdk,
        runtimeCompat: input.runtimeCompat,
        requiredRuntime: input.requiredRuntime,
    });
    if (!compat.ok) {
        return { ok: false, error: compat.reason };
    }
    if (!input.source || input.source.trim().length === 0) {
        return { ok: false, error: 'EMPTY_SOURCE' };
    }
    if (input.source.length > 500_000) {
        return { ok: false, error: 'SOURCE_TOO_LARGE' };
    }

    const hash = contentHash(input.source);
    const artifactId = `tsx_${hash}_${input.version}`;
    const compiled = compileTsxDraft({
        artifactId,
        source: input.source,
        authorUserId: input.authorUserId,
        version: input.version,
        zeneVersionCompat: input.zeneVersion,
        dashSdkCompat: input.dashSdkCompat,
        runtimeCompat: input.runtimeCompat,
    });
    if (!compiled.ok) {
        return { ok: false, error: compiled.error ?? 'COMPILE_FAILED', meta: compiled.meta };
    }

    const meta: TsxArtifactMeta = {
        ...compiled.meta,
        artifactId,
        state: 'published',
        contentHash: hash,
    };
    published.set(artifactId, meta);
    disabled.delete(artifactId);
    return { ok: true, meta, artifactId };
}

export function loadTsxArtifact(artifactId: string): {
    ok: boolean;
    meta?: TsxArtifactMeta;
    error?: string;
} {
    if (disabled.has(artifactId)) {
        return { ok: false, error: 'ARTIFACT_DISABLED' };
    }
    const meta = published.get(artifactId);
    if (!meta) return { ok: false, error: 'NOT_FOUND' };
    if (meta.state === 'failed') return { ok: false, error: 'ARTIFACT_FAILED' };
    return { ok: true, meta };
}

export function disableTsxArtifact(artifactId: string): void {
    disabled.add(artifactId);
}

export function rollbackTsxArtifact(artifactId: string, previous: TsxArtifactMeta): void {
    published.set(artifactId, { ...previous, state: 'published' });
    disabled.delete(artifactId);
}





export function runTsxIsolated<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: string } {
    try {
        return { ok: true, value: fn() };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'tsx_runtime_error' };
    }
}
