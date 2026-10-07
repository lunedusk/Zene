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

                    const pluginId = result.manifest.id;
                    // Phase 2E: reject-all on duplicate plugin IDs (not keep-first/keep-last).
                    if (discovered.has(pluginId) || bootStatuses.get(pluginId) === BootStatus.Failed) {
                        const prev = discovered.get(pluginId);
                        log.error(
                            `[${entry.name}] Duplicate plugin id '${pluginId}'` +
                                (prev ? ` (also in '${prev.dir}')` : '') +
                                `. REJECT-ALL: neither conflicting artifact will execute.`,
                        );
                        discovered.delete(pluginId);
                        integrityById.delete(pluginId);
                        pluginDirs.delete(pluginId);
                        bootStatuses.set(pluginId, BootStatus.Failed);
                        return;
                    }

                    if (result.status) {
                        integrityById.set(pluginId, result.status);
                    }

                    discovered.set(pluginId, {
                        dir: pluginDir,
                        manifest: result.manifest,
                        trust: result.trust,
                    });
                    pluginDirs.set(pluginId, pluginDir);
                    bootStatuses.set(pluginId, BootStatus.Pending);
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
/**
 * Topological sort: dependencies first, then ascending priority among roots.
 * Mutates `plugins` by removing entries that fail graph resolution.
 * Dependency edges dominate priority: a dependent never loads before its deps.
 */
export function sortDependencies(
    plugins: Map<string, DiscoveredPlugin>,
): DiscoveredPlugin[] {
    const sorted: DiscoveredPlugin[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const failed = new Set<string>();

    const visit = (pluginId: string, requiredBy?: string): void => {
        if (failed.has(pluginId)) {
            throw new Error(
                `Dependency '${pluginId}' previously failed resolution` +
                    (requiredBy ? ` (required by '${requiredBy}')` : ''),
            );
        }
        if (visiting.has(pluginId)) {
            throw new Error(
                `Circular dependency detected involving '${pluginId}'` +
                    (requiredBy ? ` (via '${requiredBy}')` : ''),
            );
        }
        if (visited.has(pluginId)) return;

        visiting.add(pluginId);

        const plugin = plugins.get(pluginId);
        if (!plugin) {
            throw new Error(
                `Missing required dependency: '${pluginId}'` +
                    (requiredBy ? ` (required by '${requiredBy}')` : ''),
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
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
    });

    for (const pluginId of orderedKeys) {
        if (visited.has(pluginId) || failed.has(pluginId)) continue;
        try {
            visit(pluginId);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(
                `Dependency resolution failed for '${pluginId}': ${err.message}. Plugin will not load.`,
            );
            failed.add(pluginId);
            plugins.delete(pluginId);
            // Clear partial visit state so other roots can still resolve.
            visiting.clear();
        }
    }

    // Drop any sorted entries that were later marked failed (should not happen, defensive).
    return sorted.filter((p) => !failed.has(p.manifest.id));
}
