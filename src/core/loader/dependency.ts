import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DependencyLoader');

export class DependencyLoader {
    public static async installFromPackageJson(
        pluginDir: string,
        pluginId: string,
        nodeDependencies?: Record<string, string>,
    ): Promise<void> {
        const merged = await this.buildMergedDependencies(pluginDir, pluginId, nodeDependencies);
        const names = Object.keys(merged);

        if (names.length === 0) {
            log.debug(`[${pluginId}] No external npm dependencies to install.`);
            return;
        }

        log.info(`[${pluginId}] Installing ${names.length} npm dependencies in sandbox...`);
        const packagePath = path.join(pluginDir, 'package.json');
        const hasPackageJson = await fs.access(packagePath).then(() => true).catch(() => false);
        if (!hasPackageJson) await fs.writeFile(packagePath, JSON.stringify({ private: true }, null, 2));
        try {
            await this.runNpmInstall(pluginDir, pluginId, merged);
        } finally {
            if (!hasPackageJson) await fs.rm(packagePath, { force: true });
        }
        log.info(`[${pluginId}] Dependencies successfully sandboxed.`);
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

    private static runNpmInstall(
        targetDir: string,
        pluginId: string,
        deps: Record<string, string>,
    ): Promise<void> {
        const specs = Object.entries(deps).map(([name, range]) => `${name}@${range}`);
        const args = [
            'install',
            '--prefix',
            targetDir,
            ...specs,
            '--no-save',
            '--package-lock=false',
            '--no-audit',
            '--no-fund',
            '--prefer-offline',
        ];

        return new Promise((resolve, reject) => {
            const child = spawn('npm', args, {
                cwd: process.cwd(),
                stdio: 'ignore',
                shell: process.platform === 'win32',
                detached: process.platform !== 'win32',
            });

            const killTree = () => {
                try {
                    if (process.platform !== 'win32' && child.pid) {
                        process.kill(-child.pid, 'SIGTERM');
                    } else {
                        child.kill('SIGTERM');
                    }
                } catch {
                    try { child.kill('SIGKILL'); } catch { }
                }
            };

            const timeout = setTimeout(() => {
                killTree();
                reject(new Error(`NPM Install timed out for plugin: ${pluginId}`));
            }, 120000);

            child.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`NPM Install failed with exit code ${code} for plugin: ${pluginId}`));
                }
            });

            child.on('error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to spawn NPM process: ${err.message}`));
            });
        });
    }
}
