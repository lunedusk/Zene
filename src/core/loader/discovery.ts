import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { resolvePluginPublicKey } from '#core/helpers/integrity/publicKey.js';
import { resolvePluginIntegrity } from './integrityGate.js';
import type { DiscoveredPlugin, IntegrityStatus, PluginBootStatus } from './types.js';
import { PluginBootStatus as BootStatus } from './types.js';

const log = getLogger('PluginDiscovery');

export interface DiscoveryResult {
    readonly discovered: Map<string, DiscoveredPlugin>;
    readonly integrityById: Map<string, IntegrityStatus>;
    readonly pluginDirs: Map<string, string>;
    readonly bootStatuses: Map<string, PluginBootStatus>;
}

/**
 * Scan pluginsDir for plugin folders and resolve each through the integrity gate.
 */
export async function discoverPlugins(
    pluginsDir: string,
    coreVersion: string,
): Promise<DiscoveryResult> {
    const discovered = new Map<string, DiscoveredPlugin>();
    const integrityById = new Map<string, IntegrityStatus>();
    const pluginDirs = new Map<string, string>();
    const bootStatuses = new Map<string, PluginBootStatus>();

    const allowUncertified = secrets.getBoolean('allowUnCertifiedPlugins', false);
    const whitelistedStr = secrets.getOptional('whitelistedPlugins');
    const whitelistedSet = new Set(
        whitelistedStr ? whitelistedStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    );

    try {
        const entries = await fs.readdir(pluginsDir, { withFileTypes: true });

        await Promise.all(
            entries.map(async (entry: Dirent) => {
                if (!entry.isDirectory()) return;

                const pluginDir = path.join(pluginsDir, entry.name);

                try {
                    const result = await resolvePluginIntegrity(pluginDir, entry.name, {
                        allowUncertified,
                        whitelistedSet,
                        coreVersion,
                        resolvePublicKey: resolvePluginPublicKey,
                    });

                    if (result.rejected || !result.manifest) return;

                    if (result.status) {
                        integrityById.set(result.manifest.id, result.status);
                    }

                    discovered.set(result.manifest.id, {
                        dir: pluginDir,
                        manifest: result.manifest,
                    });
                    pluginDirs.set(result.manifest.id, pluginDir);
                    bootStatuses.set(result.manifest.id, BootStatus.Pending);
                } catch (error: unknown) {
                    const err = error as Error;
                    log.error(`[${entry.name}] CRITICAL LOAD ERROR: ${err.message}`);
                }
            }),
        );
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') log.info('No plugins directory found. Skipping load.');
        else throw error;
    }

    return { discovered, integrityById, pluginDirs, bootStatuses };
}

/**
 * Topological sort by dependencies, then priority.
 * Mutates `plugins` by deleting entries that fail dependency resolution.
 */
export function sortDependencies(
    plugins: Map<string, DiscoveredPlugin>,
): DiscoveredPlugin[] {
    const sorted: DiscoveredPlugin[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (pluginId: string, requiredBy?: string): void => {
        if (visiting.has(pluginId)) {
            throw new Error(`Circular dependency detected: '${pluginId}' -> '${requiredBy}'`);
        }
        if (visited.has(pluginId)) return;

        visiting.add(pluginId);

        const plugin = plugins.get(pluginId);
        if (!plugin) {
            throw new Error(
                `Missing required dependency: '${pluginId}' (Required by '${requiredBy}')`,
            );
        }

        if (plugin.manifest.dependencies) {
            for (const depId of plugin.manifest.dependencies) {
                visit(depId, pluginId);
            }
        }

        visiting.delete(pluginId);
        visited.add(pluginId);
        sorted.push(plugin);
    };

    const orderedKeys = [...plugins.keys()].sort((a, b) => {
        const pa = plugins.get(a)!.manifest.priority ?? 0;
        const pb = plugins.get(b)!.manifest.priority ?? 0;
        return pa - pb;
    });

    for (const pluginId of orderedKeys) {
        try {
            visit(pluginId);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                `Dependency resolution failed for '${pluginId}': ${err.message}. Plugin will not load.`,
            );
            plugins.delete(pluginId);
        }
    }

    return sorted;
}
