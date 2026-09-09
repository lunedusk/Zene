import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from '#core/helpers/hash/index.js';
import type { BaselineFileEntry } from './types.js';
import { HARD_EXCLUDES } from './config.js';

export const STATE_DIR = path.join(process.cwd(), '.data', 'updater');
export const BASELINE = path.join(STATE_DIR, 'baseline.json');
export const BACKUP_DIR = path.join(STATE_DIR, 'backups');
export const STAGING_DIR = path.join(STATE_DIR, 'staging');
export const PENDING_HEALTH = path.join(STATE_DIR, 'pending-health.json');
export const APPLY_STATE = path.join(STATE_DIR, 'apply-state.json');
export const RECEIPTS_DIR = path.join(STATE_DIR, 'receipts');

export function ensureDirs(): void {
    for (const d of [STATE_DIR, BACKUP_DIR, STAGING_DIR, RECEIPTS_DIR]) {
        fs.mkdirSync(d, { recursive: true });
    }
}

export function isPluginPath(rel: string): boolean {
    const n = rel.replace(/\\/g, '/');
    return n.startsWith('src/plugins/') || n.startsWith('plugins/');
}

export function pluginRoot(rel: string): string | null {
    const n = rel.replace(/\\/g, '/');
    const m = n.match(/^(src\/plugins\/[^/]+|plugins\/[^/]+)/);
    return m ? m[1]! : null;
}

export function shouldHardExclude(rel: string): boolean {
    const parts = rel.replace(/\\/g, '/').split('/');
    return parts.some((p) => HARD_EXCLUDES.has(p)) || rel.startsWith('.');
}

export function sourcePluginPath(pluginId: string): string {
    return path.join('src', 'plugins', pluginId).replace(/\\/g, '/');
}

export function runtimePluginPath(pluginId: string): string {
    return path.join('plugins', pluginId).replace(/\\/g, '/');
}

export function localPluginDir(pluginName: string): string | null {
    const candidates = [
        path.join('src', 'plugins', pluginName),
        path.join('plugins', pluginName),
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(process.cwd(), c))) return c.replace(/\\/g, '/');
    }
    return null;
}

export function walkLocal(root = process.cwd()): string[] {
    const results: string[] = [];
    const skip = new Set([
        'node_modules',
        '.git',
        '.github',
        '.data',
        'logs',
        'configuration',
        'coverage',
        '.turbo',
        '.nx',
    ]);

    function recurse(dir: string, relBase: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (skip.has(ent.name) || ent.name.startsWith('.')) continue;
            const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) recurse(full, rel);
            else if (ent.isFile()) results.push(rel.replace(/\\/g, '/'));
        }
    }
    recurse(root, '');
    return results;
}

export async function computeLocalHashes(
    files: string[],
): Promise<Record<string, BaselineFileEntry>> {
    const out: Record<string, BaselineFileEntry> = {};
    for (const rel of files) {
        const full = path.join(process.cwd(), rel);
        try {
            const { hash, size } = await hashFile(full);
            out[rel] = { hash, size };
        } catch {
            /* skip unreadable */
        }
    }
    return out;
}

export async function copyDirRecursive(src: string, dest: string): Promise<void> {
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (
            ent.name === 'node_modules' ||
            ent.name === '.git' ||
            ent.name === '.github' ||
            ent.name === 'coverage' ||
            ent.name === '.turbo' ||
            ent.name === '.nx'
        ) {
            continue;
        }
        const s = path.join(src, ent.name);
        const d = path.join(dest, ent.name);
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) await copyDirRecursive(s, d);
        else if (ent.isFile()) fs.copyFileSync(s, d);
    }
}
