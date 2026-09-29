/**
 * Phase 2B — Owner customization override layer (does not mutate plugin manifests).
 */

import { kvGet, kvSet, newId } from '../lib/store.js';

export type OverridePublicationState = 'draft' | 'preview' | 'published' | 'scheduled' | 'restored';

export interface OwnerOverrideRecord {
    overrideId: string;
    /** Logical target: page | widget | theme | layout | component | tsx */
    targetKind: string;
    targetKey: string;
    pluginId?: string;
    pluginVersion?: string;
    sdkCompat?: string;
    sourceFile?: string;
    exportName?: string;
    contentHash: string;
    /** Opaque payload (theme tokens, layout grid, page def, tsx source meta) */
    payload: unknown;
    authorUserId: string;
    createdAt: number;
    updatedAt: number;
    state: OverridePublicationState;
    version: number;
    changeSummary?: string;
    scheduledAt?: number;
    previewTokenHash?: string;
    previewExpiresAt?: number;
}

const NS = 'owner_override';
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
}): Promise<OwnerOverrideRecord> {
    const targetId = `${input.targetKind}:${input.targetKey}`;
    const existingId = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    const now = Date.now();
    if (typeof existingId === 'string') {
        const cur = (await kvGet(NS, existingId)) as OwnerOverrideRecord | null;
        if (cur) {
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
        changeSummary: input.changeSummary,
    };
    await kvSet(NS, overrideId, rec);
    await kvSet(NS_BY_TARGET, targetId, overrideId);
    return rec;
}

export async function publishOverride(overrideId: string): Promise<OwnerOverrideRecord | null> {
    const cur = (await kvGet(NS, overrideId)) as OwnerOverrideRecord | null;
    if (!cur) return null;
    const next: OwnerOverrideRecord = {
        ...cur,
        state: 'published',
        version: cur.version + 1,
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

/** Retain current history; purge versions four versions back (keep last 4 published snapshots). */
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

export async function restoreOverrideVersion(
    targetKind: string,
    targetKey: string,
    version: number,
): Promise<OwnerOverrideRecord | null> {
    const versions = await listOverrideVersions(targetKind, targetKey);
    const snap = versions.find((v) => v.version === version);
    if (!snap) return null;
    const targetId = `${targetKind}:${targetKey}`;
    const id = (await kvGet(NS_BY_TARGET, targetId)) as string | null;
    if (typeof id !== 'string') return null;
    const restored: OwnerOverrideRecord = {
        ...snap,
        overrideId: id,
        state: 'restored',
        updatedAt: Date.now(),
        version: snap.version + 1,
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
    const next = { ...cur, state: 'scheduled' as const, scheduledAt, updatedAt: Date.now() };
    await kvSet(NS, overrideId, next);
    return next;
}
