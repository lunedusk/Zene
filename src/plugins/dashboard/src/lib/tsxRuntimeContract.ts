




export interface TsxArtifactMeta {
    readonly artifactId: string;
    readonly authorUserId: string;
    readonly version: number;
    readonly source: string;
    readonly contentHash: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly zeneVersionCompat: string;
    readonly dashSdkCompat: string;
    readonly pluginVersions?: Record<string, string>;
    readonly runtimeCompat: string;
    readonly state: 'draft' | 'compiled' | 'validated' | 'published' | 'failed';
    readonly compileError?: string;
}

export interface TsxCompileResult {
    readonly ok: boolean;
    readonly meta: TsxArtifactMeta;
    readonly error?: string;
}

export function contentHash(source: string): string {

    let h = 0;
    for (let i = 0; i < source.length; i++) h = (Math.imul(31, h) + source.charCodeAt(i)) | 0;
    return `h${(h >>> 0).toString(16)}`;
}

export function checkTsxCompatibility(input: {
    zeneVersion: string;
    dashSdkCompat: string;
    requiredSdk: string;
    runtimeCompat: string;
    requiredRuntime: string;
}): { ok: true } | { ok: false; reason: string } {
    if (input.dashSdkCompat !== input.requiredSdk && !input.requiredSdk.startsWith(input.dashSdkCompat)) {

        if (!input.requiredSdk.startsWith(input.dashSdkCompat.split('.')[0] ?? '')) {
            return { ok: false, reason: 'SDK_INCOMPATIBLE' };
        }
    }
    if (input.runtimeCompat !== input.requiredRuntime) {
        return { ok: false, reason: 'RUNTIME_INCOMPATIBLE' };
    }
    if (!input.zeneVersion) {
        return { ok: false, reason: 'ZENE_VERSION_MISSING' };
    }
    return { ok: true };
}





export function compileTsxDraft(input: {
    artifactId: string;
    authorUserId: string;
    source: string;
    version: number;
    zeneVersionCompat: string;
    dashSdkCompat: string;
    runtimeCompat: string;
}): TsxCompileResult {
    const now = Date.now();
    const hash = contentHash(input.source);
    if (!input.source.trim()) {
        const meta: TsxArtifactMeta = {
            artifactId: input.artifactId,
            authorUserId: input.authorUserId,
            version: input.version,
            source: input.source,
            contentHash: hash,
            createdAt: now,
            updatedAt: now,
            zeneVersionCompat: input.zeneVersionCompat,
            dashSdkCompat: input.dashSdkCompat,
            runtimeCompat: input.runtimeCompat,
            state: 'failed',
            compileError: 'EMPTY_SOURCE',
        };
        return { ok: false, meta, error: 'EMPTY_SOURCE' };
    }

    const meta: TsxArtifactMeta = {
        artifactId: input.artifactId,
        authorUserId: input.authorUserId,
        version: input.version,
        source: input.source,
        contentHash: hash,
        createdAt: now,
        updatedAt: now,
        zeneVersionCompat: input.zeneVersionCompat,
        dashSdkCompat: input.dashSdkCompat,
        runtimeCompat: input.runtimeCompat,
        state: 'compiled',
    };
    return { ok: true, meta };
}

export function publishTsxIfValid(
    draft: TsxArtifactMeta,
    currentlyPublished: TsxArtifactMeta | null,
): { ok: true; published: TsxArtifactMeta } | { ok: false; reason: string; kept: TsxArtifactMeta | null } {
    if (draft.state !== 'compiled' && draft.state !== 'validated') {
        return { ok: false, reason: 'NOT_VALIDATED', kept: currentlyPublished };
    }
    const compat = checkTsxCompatibility({
        zeneVersion: draft.zeneVersionCompat,
        dashSdkCompat: draft.dashSdkCompat,
        requiredSdk: draft.dashSdkCompat,
        runtimeCompat: draft.runtimeCompat,
        requiredRuntime: draft.runtimeCompat,
    });
    if (!compat.ok) {
        return { ok: false, reason: compat.reason, kept: currentlyPublished };
    }
    const published: TsxArtifactMeta = {
        ...draft,
        state: 'published',
        updatedAt: Date.now(),
        version: (currentlyPublished?.version ?? draft.version) + 1,
    };
    return { ok: true, published };
}
