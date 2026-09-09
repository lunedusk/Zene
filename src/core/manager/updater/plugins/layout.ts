import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { SemVer, SemVerRange } from '#core/utils/semver.js';
import {
    copyDirRecursive,
    runtimePluginPath,
    sourcePluginPath,
} from '../paths.js';

const log = getLogger('Updater');

export function readPackageVersion(): SemVer | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as {
            version?: string;
        };
        return SemVer.parse(pkg.version ?? '0.0.0');
    } catch {
        return null;
    }
}

export function readLocalManifestId(pluginRel: string, manifestName: string): string | undefined {
    const p = path.join(process.cwd(), pluginRel, manifestName);
    if (!fs.existsSync(p)) return undefined;
    try {
        const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as { id?: string; name?: string };
        return j.id || j.name;
    } catch {
        return undefined;
    }
}

export function manifestCompatible(
    manifestJson: string,
    coreVersion: SemVer,
): { ok: boolean; req: string } {
    try {
        const manifest = JSON.parse(manifestJson) as { zene_version?: string | string[] };
        const req: string | string[] = manifest.zene_version ?? '*';
        let ok = false;
        try {
            ok = SemVerRange.satisfies(coreVersion.toString(), req);
        } catch {
            ok = false;
        }
        return { ok, req: Array.isArray(req) ? req.join(' ') : String(req) };
    } catch {
        return { ok: false, req: '?' };
    }
}

export function detectLayout(
    stagingRoot: string,
    pluginId: string,
): { layout: 'L1' | 'L2' | 'L3'; contentRoot: string } | null {
    const l1 = path.join(stagingRoot, 'src', 'plugins', pluginId);
    const l3 = path.join(stagingRoot, 'plugins', pluginId);
    const l2 = stagingRoot;
    const has = (dir: string) =>
        fs.existsSync(path.join(dir, 'manifest.nvx')) || fs.existsSync(path.join(dir, 'manifest.json'));
    if (has(l1)) return { layout: 'L1', contentRoot: l1 };
    if (has(l3)) return { layout: 'L3', contentRoot: l3 };
    if (has(l2)) return { layout: 'L2', contentRoot: l2 };
    return null;
}

export async function mirrorPluginToRuntime(pluginId: string): Promise<void> {
    const src = path.join(process.cwd(), sourcePluginPath(pluginId));
    const dest = path.join(process.cwd(), runtimePluginPath(pluginId));
    if (!fs.existsSync(src)) {
        log.warn(`Cannot mirror plugin ${pluginId}: missing ${sourcePluginPath(pluginId)}`);
        return;
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    await copyDirRecursive(src, dest);
    log.info(`Mirrored ${sourcePluginPath(pluginId)} → ${runtimePluginPath(pluginId)}`);
}
