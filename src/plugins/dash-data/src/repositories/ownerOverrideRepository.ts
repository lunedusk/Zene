



import { createHash } from 'node:crypto';
import { kvGet, kvSet, newId } from '../lib/store.js';

export type OverridePublicationState = 'draft' | 'preview' | 'published' | 'scheduled' | 'restored';

export interface OwnerOverrideRecord {
    overrideId: string;

    targetKind: string;
    targetKey: string;
    pluginId?: string;
    pluginVersion?: string;
    sdkCompat?: string;
    sourceFile?: string;
    exportName?: string;
    contentHash: string;

    payload: unknown;
    authorUserId: string;
    createdAt: number;
    updatedAt: number;
    state: OverridePublicationState;
    version: number;
    /** Bumped on every write; used for optimistic draft concurrency. */
    revision: number;
    changeSummary?: string;
    scheduledAt?: number;
    previewTokenHash?: string;
    previewExpiresAt?: number;
}

const NS = 'owner_override';

/** Thrown when a draft save is based on a stale revision. */
export class OwnerOverrideConflictError extends Error {
    constructor(public readonly currentRevision: number) {
        super(`Draft revision conflict (current ${currentRevision})`);
        this.name = 'OwnerOverrideConflictError';
    }
}

/**
 * Stored contentHash does not match the canonical hash of the payload.
 * Not an authentication signal — integrity / concurrency only.
 */
export class OwnerOverrideIntegrityError extends Error {
    constructor(message = 'Override payload does not match stored contentHash') {
        super(message);
        this.name = 'OwnerOverrideIntegrityError';
    }
}

/** Canonical content hash for owner-override payloads (SHA-256 over JSON.stringify). */
export function hashOwnerOverridePayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

/**
 * Refuse to promote a record whose stored hash does not match its payload.
 * Does not mutate the record. Throws OwnerOverrideIntegrityError on mismatch.
 */
export function assertOwnerOverridePayloadIntegrity(rec: Pick<OwnerOverrideRecord, 'payload' | 'contentHash'>): void {
    const actual = hashOwnerOverridePayload(rec.payload);
    if (actual !== rec.contentHash) {
        throw new OwnerOverrideIntegrityError(
            'Stored contentHash does not match payload; refusing promotion',
        );
    }
}
const NS_BY_TARGET = 'owner_override_target';
const NS_VERSIONS = 'owner_override_versions';

export async function putOverrideDraft(input: {
    targetKind: string;
    targetKey: string;
    payload: unknown;
    contentHash: string;
    authorUserId: string;
    pluginId?: string;
    pluginVersion?: string;
    sdkCompat?: string;
    sourceFile?: string;
    exportName?: string;
    changeSummary?: string;
    expectedRevision?: number;
}): Promise<OwnerOverrideRecord> {
    const targetId = `${input.targetKind}:${input.targetKey}`;
    const existingId = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    const now = Date.now();
    if (typeof existingId === 'string') {
        const cur = (await kvGet(NS, existingId)) as OwnerOverrideRecord | null;
        if (cur) {
            const currentRevision = cur.revision ?? cur.version;
            if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
                throw new OwnerOverrideConflictError(currentRevision);
            }
            const next: OwnerOverrideRecord = {
                ...cur,
                payload: input.payload,
                contentHash: input.contentHash,
                authorUserId: input.authorUserId,
                updatedAt: now,
                state: 'draft',
                changeSummary: input.changeSummary,
                pluginId: input.pluginId ?? cur.pluginId,
                pluginVersion: input.pluginVersion ?? cur.pluginVersion,
                sdkCompat: input.sdkCompat ?? cur.sdkCompat,
                sourceFile: input.sourceFile ?? cur.sourceFile,
                exportName: input.exportName ?? cur.exportName,
                revision: currentRevision + 1,
            };
            await kvSet(NS, cur.overrideId, next);
            return next;
        }
    }
    const overrideId = newId('ovr');
    const rec: OwnerOverrideRecord = {
        overrideId,
        targetKind: input.targetKind,
        targetKey: input.targetKey,
        pluginId: input.pluginId,
        pluginVersion: input.pluginVersion,
        sdkCompat: input.sdkCompat,
        sourceFile: input.sourceFile,
        exportName: input.exportName,
        contentHash: input.contentHash,
        payload: input.payload,
        authorUserId: input.authorUserId,
        createdAt: now,
        updatedAt: now,
        state: 'draft',
        version: 1,
        revision: 1,
        changeSummary: input.changeSummary,
    };
    await kvSet(NS, overrideId, rec);
    await kvSet(NS_BY_TARGET, targetId, overrideId);
    return rec;
}

export async function publishOverride(
    overrideId: string,
    expectedContentHash?: string,
): Promise<OwnerOverrideRecord | null> {
    const cur = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    if (!cur) return null;
    // When the caller validated a specific payload, refuse to publish if the
    // stored record changed in the meantime (best-effort concurrency guard).
    // NOTE: kvGet+kvSet is NOT an atomic CAS across processes; see module docs.
    if (expectedContentHash !== undefined && cur.contentHash !== expectedContentHash) {
        return null;
    }
    // Integrity: stored hash must match the payload about to be published.
    assertOwnerOverridePayloadIntegrity(cur);
    const next: OwnerOverrideRecord = {
        ...cur,
        state: 'published',
        version: cur.version + 1,
        revision: (cur.revision ?? cur.version) + 1,
        updatedAt: Date.now(),
    };
    await kvSet(NS, overrideId, next);
    await pushVersion(next);
    await purgeOldVersions(`${cur.targetKind}:${cur.targetKey}`, 4);
    return next;
}

async function pushVersion(rec: OwnerOverrideRecord): Promise<void> {
    const key = `${rec.targetKind}:${rec.targetKey}`;
    const raw = await kvGet(NS_VERSIONS, key);
    const list = Array.isArray(raw) ? (raw as OwnerOverrideRecord[]) : [];
    list.push({ ...rec });
    await kvSet(NS_VERSIONS, key, list);
}


async function purgeOldVersions(targetId: string, keep: number): Promise<void> {
    const raw = await kvGet(NS_VERSIONS, targetId);
    const list = Array.isArray(raw) ? (raw as OwnerOverrideRecord[]) : [];
    if (list.length <= keep) return;
    await kvSet(NS_VERSIONS, targetId, list.slice(list.length - keep));
}

export async function listOverrideVersions(targetKind: string, targetKey: string): Promise<OwnerOverrideRecord[]> {
    const raw = await kvGet(NS_VERSIONS, `${targetKind}:${targetKey}`);
    return Array.isArray(raw) ? (raw as OwnerOverrideRecord[]) : [];
}

/**
 * Options for historical promotion (restore / rollback).
 *
 * - expectedSnapshotContentHash: binds to the historical version the caller validated.
 * - expectedActiveRevision / expectedActiveContentHash: best-effort guard that the
 *   *current active* record has not changed since the service read it.
 *
 * These checks are sequential kvGet + compare + kvSet — NOT atomic CAS.
 */
export interface PromoteHistoricalOptions {
    expectedSnapshotContentHash?: string;
    expectedActiveRevision?: number;
    expectedActiveContentHash?: string;
}

export async function restoreOverrideVersion(
    targetKind: string,
    targetKey: string,
    version: number,
    options?: PromoteHistoricalOptions | string,
): Promise<OwnerOverrideRecord | null> {
    // Backward-compatible: string argument was previously expectedSnapshotContentHash only.
    const opts: PromoteHistoricalOptions =
        typeof options === 'string' ? { expectedSnapshotContentHash: options } : (options ?? {});

    const versions = await listOverrideVersions(targetKind, targetKey);
    const snap = versions.find((v) => v.version === version);
    if (!snap) return null;
    if (
        opts.expectedSnapshotContentHash !== undefined &&
        snap.contentHash !== opts.expectedSnapshotContentHash
    ) {
        return null;
    }
    // Integrity: historical payload must still match its stored hash.
    assertOwnerOverridePayloadIntegrity(snap);

    const targetId = `${targetKind}:${targetKey}`;
    const id = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    if (typeof id !== 'string') return null;

    // Re-read the *active* record and reject if it moved since the service captured it.
    const active = (await kvGet(NS, id)) as OwnerOverrideRecord | null;
    if (!active) return null;
    if (
        opts.expectedActiveRevision !== undefined &&
        (active.revision ?? active.version) !== opts.expectedActiveRevision
    ) {
        return null;
    }
    if (
        opts.expectedActiveContentHash !== undefined &&
        active.contentHash !== opts.expectedActiveContentHash
    ) {
        return null;
    }

    // New active record — does not rewrite the original history entry in place.
    const restored: OwnerOverrideRecord = {
        ...snap,
        overrideId: id,
        state: 'restored',
        updatedAt: Date.now(),
        version: snap.version + 1,
        revision: (snap.revision ?? snap.version) + 1,
        scheduledAt: undefined,
        previewTokenHash: undefined,
        previewExpiresAt: undefined,
    };
    await kvSet(NS, id, restored);
    await pushVersion(restored);
    await purgeOldVersions(targetId, 4);
    return restored;
}

export async function getPublishedOverride(
    targetKind: string,
    targetKey: string,
): Promise<OwnerOverrideRecord | null> {
    const targetId = `${targetKind}:${targetKey}`;
    const id = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    if (typeof id !== 'string') return null;
    const rec = (await kvGet(NS, id)) as OwnerOverrideRecord | null;
    if (!rec) return null;
    if (rec.state !== 'published' && rec.state !== 'restored') return null;
    return rec;
}

export async function schedulePublish(overrideId: string, scheduledAt: number): Promise<OwnerOverrideRecord | null> {
    const cur = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    if (!cur) return null;
    if (scheduledAt <= Date.now()) return null;
    // Bump revision so prior scheduled jobs bound to the old revision are invalidated.
    // scheduledAt identity is also checked by the job handler.
    const next: OwnerOverrideRecord = {
        ...cur,
        state: 'scheduled' as const,
        scheduledAt,
        revision: (cur.revision ?? cur.version) + 1,
        updatedAt: Date.now(),
    };
    await kvSet(NS, overrideId, next);
    return next;
}

export async function cancelScheduledPublish(overrideId: string): Promise<OwnerOverrideRecord | null> {
    const cur = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    if (!cur) return null;
    if (cur.state !== 'scheduled') return cur;
    const next: OwnerOverrideRecord = {
        ...cur,
        state: 'draft',
        scheduledAt: undefined,
        updatedAt: Date.now(),
    };
    await kvSet(NS, overrideId, next);
    return next;
}

export async function getOverride(overrideId: string): Promise<OwnerOverrideRecord | null> {
    const rec = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    return rec ?? null;
}

export async function getOverrideByTarget(
    targetKind: string,
    targetKey: string,
): Promise<OwnerOverrideRecord | null> {
    const targetId = `${targetKind}:${targetKey}`;
    const id = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    if (typeof id !== 'string') return null;
    return getOverride(id);
}




export async function attachPreviewSession(
    overrideId: string,
    previewTokenHash: string,
    previewExpiresAt: number,
): Promise<OwnerOverrideRecord | null> {
    const cur = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    if (!cur) return null;
    const next: OwnerOverrideRecord = {
        ...cur,
        state: cur.state === 'published' ? cur.state : 'preview',
        previewTokenHash,
        previewExpiresAt,
        updatedAt: Date.now(),
    };
    await kvSet(NS, overrideId, next);
    return next;
}

export async function clearPreviewSession(overrideId: string): Promise<OwnerOverrideRecord | null> {
    const cur = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    if (!cur) return null;
    const next: OwnerOverrideRecord = {
        ...cur,
        previewTokenHash: undefined,
        previewExpiresAt: undefined,
        state: cur.state === 'preview' ? 'draft' : cur.state,
        updatedAt: Date.now(),
    };
    await kvSet(NS, overrideId, next);
    return next;
}





export async function rollbackOverrideVersion(
    targetKind: string,
    targetKey: string,
    version: number,
    options?: PromoteHistoricalOptions | string,
): Promise<OwnerOverrideRecord | null> {
    const opts: PromoteHistoricalOptions =
        typeof options === 'string' ? { expectedSnapshotContentHash: options } : (options ?? {});

    const versions = await listOverrideVersions(targetKind, targetKey);
    const snap = versions.find((v) => v.version === version);
    if (!snap) return null;
    if (
        opts.expectedSnapshotContentHash !== undefined &&
        snap.contentHash !== opts.expectedSnapshotContentHash
    ) {
        return null;
    }
    // Integrity: historical payload must still match its stored hash.
    assertOwnerOverridePayloadIntegrity(snap);

    const targetId = `${targetKind}:${targetKey}`;
    const id = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    if (typeof id !== 'string') return null;

    // Re-read the *active* record and reject if it moved since the service captured it.
    const active = (await kvGet(NS, id)) as OwnerOverrideRecord | null;
    if (!active) return null;
    if (
        opts.expectedActiveRevision !== undefined &&
        (active.revision ?? active.version) !== opts.expectedActiveRevision
    ) {
        return null;
    }
    if (
        opts.expectedActiveContentHash !== undefined &&
        active.contentHash !== opts.expectedActiveContentHash
    ) {
        return null;
    }

    // New published record — original history snapshot is left unchanged in the list.
    const published: OwnerOverrideRecord = {
        ...snap,
        overrideId: id,
        state: 'published',
        updatedAt: Date.now(),
        version: snap.version + 1,
        revision: (snap.revision ?? snap.version) + 1,
        changeSummary: `rollback_to_v${version}`,
        scheduledAt: undefined,
        previewTokenHash: undefined,
        previewExpiresAt: undefined,
    };
    await kvSet(NS, id, published);
    await pushVersion(published);
    await purgeOldVersions(targetId, 4);
    return published;
}


export async function listDueScheduled(nowMs: number = Date.now()): Promise<OwnerOverrideRecord[]> {


    void nowMs;
    return [];
}

