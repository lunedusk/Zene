import path from 'node:path';
import fs from 'node:fs/promises';
import { getLogger } from '#core/utils/logger.js';
import type { DependencyInstallBackend } from '#core/helpers/dependency/backends.js';
import { selectDependencyInstallProvider } from '#core/provider/dependencyInstall.js';
import { getAuthenticatedPluginContext } from '#core/helpers/integrity/authenticatedContext.js';
import { verifyDependencyClosure } from '#core/helpers/integrity/dependencyClosure.js';

const log = getLogger('DependencyLoader');

export class DependencyLoader {
    /**
     * Install plugin nodeDependencies + package.json dependencies into a sandbox.
     * Backend via Phase 2A provider registry (`dependency.install`);
     * env PluginDependencyBackend / DependencyBackend still overrides.
     * Does not claim signed lockfile reproducibility — that is a later metadata expansion.
     */
    public static async installFromPackageJson(
        pluginDir: string,
        pluginId: string,
        nodeDependencies?: Record<string, string>,
        backend: DependencyInstallBackend = selectDependencyInstallProvider(),
    ): Promise<void> {
        // Phase 2E: authenticated closure must pass before any install attempt
        await verifyDependencyClosure(pluginId, pluginDir);

        const ctx = getAuthenticatedPluginContext(pluginId);
        if (ctx?.profile === 'v2-authenticated' && ctx.dependencyLock?.lockfileDigest) {
            // Trusted artifact with authenticated lock: do not perform network install at boot
            log.info(
                `[${pluginId}] Authenticated lock present; skipping network dependency install (closure verified).`,
            );
            return;
        }

        const merged = await this.buildMergedDependencies(pluginDir, pluginId, nodeDependencies);
        const names = Object.keys(merged);

        if (names.length === 0) {
            log.debug(`[${pluginId}] No external package dependencies to install.`);
            return;
        }

        log.info(
            `[${pluginId}] Installing ${names.length} dependencies via backend=${backend.id}...`,
        );
        const packagePath = path.join(pluginDir, 'package.json');
        const hasPackageJson = await fs.access(packagePath).then(() => true).catch(() => false);
        if (!hasPackageJson) await fs.writeFile(packagePath, JSON.stringify({ private: true }, null, 2));
        try {
            await backend.install({
                pluginDir,
                pluginId,
                deps: merged,
            });
        } finally {
            if (!hasPackageJson) await fs.rm(packagePath, { force: true });
        }
        log.info(`[${pluginId}] Dependencies successfully sandboxed (backend=${backend.id}).`);
    }

    private static async buildMergedDependencies(
        pluginDir: string,
        pluginId: string,
        nodeDependencies?: Record<string, string>,
    ): Promise<Record<string, string>> {
        const merged: Record<string, string> = {};

        const pkgPath = path.join(pluginDir, 'package.json');
        try {
            const rawPkg = await fs.readFile(pkgPath, 'utf-8');
            const pkg: unknown = JSON.parse(rawPkg);
            if (
                typeof pkg === 'object' &&
                pkg !== null &&
                !Array.isArray(pkg) &&
                'dependencies' in pkg
            ) {
                const deps = (pkg as { dependencies?: unknown }).dependencies;
                if (typeof deps === 'object' && deps !== null && !Array.isArray(deps)) {
                    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
                        if (typeof name === 'string' && name.trim() && typeof range === 'string' && range.trim()) {
                            merged[name.trim()] = range.trim();
                        }
                    }
                }
            }
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') {
                log.debug(`[${pluginId}] No package.json found.`);
            } else if (error instanceof SyntaxError) {
                log.error(`[${pluginId}] package.json is malformed or invalid JSON.`);
                throw error;
            } else {
                log.error(`[${pluginId}] Failed to read package.json: ${err.message}`);
                throw error;
            }
        }

        if (nodeDependencies) {
            for (const [name, range] of Object.entries(nodeDependencies)) {
                if (typeof name === 'string' && name.trim() && typeof range === 'string' && range.trim()) {
                    merged[name.trim()] = range.trim();
                }
            }
        }

        return merged;
    }
}
