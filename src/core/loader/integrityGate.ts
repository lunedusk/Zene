import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { PackageManager } from '#core/helpers/integrity/manifest.js';
import { SemVer } from '#core/utils/semver.js';
import { NodeVersion } from '#core/utils/nodever.js';
import type { PluginManifest } from '#core/bases/Plugin.js';
import type { IntegrityGateOptions, IntegrityGateResult, IntegrityStatus } from './types.js';

const log = getLogger('IntegrityGate');

function parseManifestJson(raw: Record<string, unknown>): PluginManifest {
    const nodeDepsRaw = raw.node_dependencies ?? raw.nodeDependencies;
    let nodeDependencies: Record<string, string> | undefined;
    if (typeof nodeDepsRaw === 'object' && nodeDepsRaw !== null && !Array.isArray(nodeDepsRaw)) {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(nodeDepsRaw as Record<string, unknown>)) {
            if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
                map[k.trim()] = v.trim();
            }
        }
        if (Object.keys(map).length > 0) nodeDependencies = map;
    }
    return {
        id: typeof raw.id === 'string' ? raw.id : '',
        name: typeof raw.name === 'string' ? raw.name : '',
        version: typeof raw.version === 'string' ? raw.version : '',
        description: typeof raw.description === 'string' ? raw.description : undefined,
        author: typeof raw.author === 'string' ? raw.author : undefined,
        dependencies: Array.isArray(raw.dependencies)
            ? raw.dependencies.filter((d): d is string => typeof d === 'string')
            : undefined,
        zene_version:
            typeof raw.zene_version === 'string' || Array.isArray(raw.zene_version)
                ? (raw.zene_version as string | string[])
                : undefined,
        node_version: typeof raw.node_version === 'string' ? raw.node_version : undefined,
        priority: typeof raw.priority === 'number' ? raw.priority : undefined,
        nodeDependencies,
    };
}

/**
 * Resolve plugin manifest from signed .nvx or unsigned manifest.json bypass.
 * Version gates (zene / node) are applied here so discovery stays free of crypto.
 */
export async function resolvePluginIntegrity(
    pluginDir: string,
    folderName: string,
    options: IntegrityGateOptions,
): Promise<IntegrityGateResult> {
    const nvxPath = path.join(pluginDir, 'manifest.nvx');
    const jsonPath = path.join(pluginDir, 'manifest.json');

    let manifest: PluginManifest | null = null;
    let integrityPassed = false;
    let status: IntegrityStatus | null = null;

    const hasNvx = await fs
        .access(nvxPath)
        .then(() => true)
        .catch(() => false);

    if (hasNvx) {
        try {
            manifest = await PackageManager.unpackAndVerify(
                pluginDir,
                options.resolvePublicKey(folderName),
                'manifest.nvx',
            );
            integrityPassed = true;
            status = 'signed';
        } catch (verifyError: unknown) {
            const err = verifyError as Error;
            log.warn(`[${folderName}] INTEGRITY FAILURE: ${err.message}`);
            status = 'failed';
        }
    }

    if (!integrityPassed) {
        const isWhitelisted = options.whitelistedSet.has(folderName);
        if (!options.allowUncertified && !isWhitelisted) {
            log.error(
                `[${folderName}] Rejected: Integrity check failed/missing, and unsigned plugins are disabled.`,
            );
            return { manifest: null, status: status ?? 'failed', rejected: true };
        }

        log.warn(
            `[${folderName}] BYPASS ACTIVE: Loading plugin via manifest.json without cryptographic guarantees.`,
        );

        const jsonRaw = await fs.readFile(jsonPath, 'utf-8').catch(() => {
            throw new Error('Missing manifest.json fallback. Cannot load bypassed plugin.');
        });

        const parsed: unknown = JSON.parse(jsonRaw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Invalid manifest.json: Expected a JSON object.');
        }

        manifest = parseManifestJson(parsed as Record<string, unknown>);
        status = 'bypassed';

        if (!manifest.id || !manifest.name || !manifest.version) {
            throw new Error('Invalid manifest.json: Missing required fields (id, name, version).');
        }
    }

    if (!manifest) {
        return { manifest: null, status, rejected: true };
    }

    if (manifest.zene_version) {
        let zeneOk = false;
        try {
            zeneOk = SemVer.satisfies(options.coreVersion, manifest.zene_version as string | string[]);
        } catch {
            zeneOk = false;
        }
        if (!zeneOk) {
            log.warn(
                `[${manifest.id}] Incompatible Core Version. Plugin requires ${JSON.stringify(manifest.zene_version)}, but core is v${options.coreVersion}. Skipping.`,
            );
            return { manifest, status, rejected: true };
        }
    }

    if (manifest.node_version && !NodeVersion.satisfies(manifest.node_version)) {
        const currentNode = NodeVersion.current().toString();
        log.warn(
            `[${manifest.id}] Incompatible Node.js version. ` +
                `Plugin requires ${manifest.node_version}, but runtime is v${currentNode}. Skipping.`,
        );
        return { manifest, status, rejected: true };
    }

    return { manifest, status, rejected: false };
}
