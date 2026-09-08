import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpamSignatureEntry, SpamSignaturesFile } from './types.js';

let blake3Hash: ((data: Uint8Array | string) => string) | null = null;

async function ensureBlake3(): Promise<((data: Uint8Array | string) => string) | null> {
    if (blake3Hash) return blake3Hash;
    try {
        const { createBLAKE3 } = await import('hash-wasm');
        const hasher = await createBLAKE3();
        blake3Hash = (data: Uint8Array | string): string => {
            hasher.init();
            hasher.update(data);
            return hasher.digest('hex');
        };
        return blake3Hash;
    } catch {
        blake3Hash = null;
        return null;
    }
}

function hexSlice(buf: Buffer, start: number, end: number): string {
    return buf.subarray(start, end).toString('hex');
}

/**
 * Staged match: size → header/footer → partial bytes → blake3.
 * Returns matching entry id or null. Early-exit on mismatch at each stage.
 */
export async function matchImageBuffer(
    buffer: Buffer,
    entries: readonly SpamSignatureEntry[],
): Promise<SpamSignatureEntry | null> {
    const size = buffer.length;
    if (size === 0) return null;

    const candidates = entries.filter((e) => e.kind === 'image' && (e.size == null || e.size === size));
    if (candidates.length === 0) return null;

    const header4 = size >= 4 ? hexSlice(buffer, 0, 4) : '';
    const header16 = size >= 16 ? hexSlice(buffer, 0, 16) : header4;
    const footer4 = size >= 4 ? hexSlice(buffer, size - 4, size) : '';
    const footer16 = size >= 16 ? hexSlice(buffer, size - 16, size) : footer4;

    let stage = candidates.filter((e) => {
        if (e.header4 && e.header4 !== header4) return false;
        if (e.footer4 && e.footer4 !== footer4) return false;
        return true;
    });
    if (stage.length === 0) return null;

    stage = stage.filter((e) => {
        if (e.header16 && e.header16 !== header16) return false;
        if (e.footer16 && e.footer16 !== footer16) return false;
        if (e.first4 && e.first4 !== header4) return false;
        if (e.first16 && e.first16 !== header16) return false;
        if (e.last4 && e.last4 !== footer4) return false;
        if (e.last16 && e.last16 !== footer16) return false;
        return true;
    });
    if (stage.length === 0) return null;

    const hasher = await ensureBlake3();
    if (!hasher) {
        // Without blake3, accept strongest non-hash match if only one candidate remains with size+headers.
        return stage.length === 1 ? stage[0]! : null;
    }

    const fullHash = hasher(buffer);
    for (const e of stage) {
        const expected = e.blake3Full ?? e.blake3;
        if (expected && expected === fullHash) return e;
    }
    return null;
}

export async function matchTextContent(
    text: string,
    entries: readonly SpamSignatureEntry[],
): Promise<SpamSignatureEntry | null> {
    const normalized = text.trim();
    if (!normalized) return null;

    const textEntries = entries.filter((e) => e.kind === 'text');
    for (const e of textEntries) {
        if (e.text && e.text === normalized) return e;
    }

    const buf = Buffer.from(normalized, 'utf8');
    const size = buf.length;
    let stage = textEntries.filter((e) => e.size == null || e.size === size);
    if (stage.length === 0) return null;

    const first4 = size >= 4 ? hexSlice(buf, 0, 4) : '';
    const first16 = size >= 16 ? hexSlice(buf, 0, 16) : first4;
    const last4 = size >= 4 ? hexSlice(buf, size - 4, size) : '';
    const last16 = size >= 16 ? hexSlice(buf, size - 16, size) : last4;

    stage = stage.filter((e) => {
        if (e.first4 && e.first4 !== first4) return false;
        if (e.first16 && e.first16 !== first16) return false;
        if (e.last4 && e.last4 !== last4) return false;
        if (e.last16 && e.last16 !== last16) return false;
        if (e.header4 && e.header4 !== first4) return false;
        if (e.footer4 && e.footer4 !== last4) return false;
        return true;
    });
    if (stage.length === 0) return null;

    const hasher = await ensureBlake3();
    if (!hasher) return stage.length === 1 ? stage[0]! : null;

    const fullHash = hasher(buf);
    for (const e of stage) {
        const expected = e.blake3Full ?? e.blake3;
        if (expected && expected === fullHash) return e;
    }
    return null;
}

export async function loadSpamSignatures(pluginRoot: string): Promise<SpamSignaturesFile> {
    const filePath = path.join(pluginRoot, 'data', 'spam-signatures.json');
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as SpamSignaturesFile).entries)
        ) {
            return parsed as SpamSignaturesFile;
        }
    } catch {
        /* missing or invalid */
    }
    return { version: 1, entries: [] };
}

export function resolvePluginRootFromMeta(importMetaUrl: string): string {
    const here = path.dirname(fileURLToPath(importMetaUrl));
    // .../src/lib → plugin root is ../..
    return path.resolve(here, '../..');
}
