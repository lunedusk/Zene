/**
 * Phase 1C / 2E — Plugin node-dependency install backends (npm / Bun).
 *
 * Install is a code-execution boundary:
 * - controlled environment (installEnvPolicy) — not a copy of process.env
 * - install scripts denied by default (installScriptPolicy)
 * - shell: false always
 */

import { spawn } from 'node:child_process';
import { getLogger } from '#core/utils/logger.js';
import { buildControlledInstallEnv } from './installEnvPolicy.js';
import { mustIgnoreInstallScripts } from './installScriptPolicy.js';
import { getAuthenticatedPluginContext } from '#core/helpers/integrity/authenticatedContext.js';
import { getDefaultRegistry } from './sourcePolicy.js';

const log = getLogger('DependencyBackend');

export type DependencyBackendId = 'npm' | 'bun';

export interface DependencyInstallRequest {
    readonly pluginDir: string;
    readonly pluginId: string;
    /** name → version range specs already merged/validated. */
    readonly deps: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
}

export interface DependencyInstallBackend {
    readonly id: DependencyBackendId;
    install(request: DependencyInstallRequest): Promise<void>;
}

function trustProfileFor(
    pluginId: string,
): 'v2-authenticated' | 'legacy-signed' | 'bypassed-unsigned' | 'unknown' {
    const ctx = getAuthenticatedPluginContext(pluginId);
    if (!ctx) return 'unknown';
    return ctx.profile;
}

function signerFingerprintFor(pluginId: string): string | undefined {
    return getAuthenticatedPluginContext(pluginId)?.signerFingerprint;
}

function spawnInstall(
    command: string,
    args: string[],
    request: DependencyInstallRequest,
    timeoutMs: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const env = buildControlledInstallEnv(
            {
                pluginId: request.pluginId,
                pluginDir: request.pluginDir,
                registry: getDefaultRegistry(),
            },
            process.env,
        );

        const child = spawn(command, args, {
            cwd: request.pluginDir,
            stdio: 'ignore',
            shell: false,
            detached: process.platform !== 'win32',
            env,
        });

        const killTree = () => {
            try {
                if (process.platform !== 'win32' && child.pid) {
                    process.kill(-child.pid, 'SIGTERM');
                } else {
                    child.kill('SIGTERM');
                }
            } catch {
                try {
                    child.kill('SIGKILL');
                } catch {
                    /* ignore */
                }
            }
        };

        const timeout = setTimeout(() => {
            killTree();
            reject(new Error(`${command} install timed out for plugin: ${request.pluginId}`));
        }, timeoutMs);

        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `${command} install failed with exit code ${code} for plugin: ${request.pluginId}`,
                    ),
                );
        });

        child.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to spawn ${command}: ${err.message}`));
        });
    });
}

export const npmBackend: DependencyInstallBackend = {
    id: 'npm',
    install(request) {
        const packages = Object.entries(request.deps).map(([name, range]) => ({
            name,
            // range is not exact version; script grants require exactVersion from lock
            exactVersion: range.startsWith('=') ? range.slice(1) : undefined,
        }));
        const ignoreScripts = mustIgnoreInstallScripts({
            pluginId: request.pluginId,
            packages,
            trustProfile: trustProfileFor(request.pluginId),
            signerFingerprint: signerFingerprintFor(request.pluginId),
        });
        const specs = Object.entries(request.deps).map(([name, range]) => `${name}@${range}`);
        const args = [
            'install',
            '--prefix',
            request.pluginDir,
            ...specs,
            '--no-save',
            '--package-lock=false',
            '--no-audit',
            '--no-fund',
            '--prefer-offline',
        ];
        if (ignoreScripts) {
            args.push('--ignore-scripts');
        }
        log.debug(
            `[${request.pluginId}] npm install ignoreScripts=${String(ignoreScripts)} packages=${specs.length}`,
        );
        return spawnInstall('npm', args, request, request.timeoutMs ?? 120_000);
    },
};

export const bunBackend: DependencyInstallBackend = {
    id: 'bun',
    install(request) {
        const packages = Object.entries(request.deps).map(([name, range]) => ({
            name,
            exactVersion: range.startsWith('=') ? range.slice(1) : undefined,
        }));
        const ignoreScripts = mustIgnoreInstallScripts({
            pluginId: request.pluginId,
            packages,
            trustProfile: trustProfileFor(request.pluginId),
            signerFingerprint: signerFingerprintFor(request.pluginId),
        });
        const specs = Object.entries(request.deps).map(([name, range]) => `${name}@${range}`);
        const args = ['add', '--cwd', request.pluginDir, ...specs];
        if (ignoreScripts) {
            args.push('--ignore-scripts');
        }
        log.debug(
            `[${request.pluginId}] bun add ignoreScripts=${String(ignoreScripts)} packages=${specs.length}`,
        );
        return spawnInstall('bun', args, request, request.timeoutMs ?? 120_000);
    },
};

export function selectDependencyBackend(
    env: NodeJS.ProcessEnv = process.env,
): DependencyInstallBackend {
    const explicit = (
        env.PluginDependencyBackend ||
        env.DependencyBackend ||
        ''
    )
        .trim()
        .toLowerCase();

    if (explicit === 'npm') return npmBackend;
    if (explicit === 'bun') return bunBackend;

    if (explicit === 'auto' && env.BUN_INSTALL) {
        log.debug('Dependency backend auto-selected: bun (BUN_INSTALL set)');
        return bunBackend;
    }

    return npmBackend;
}

export {
    buildControlledInstallEnv,
    sanitizeInstallEnv,
    isInstallEnvKeyAllowed,
    listInstallEnvAllowlist,
    resolveInstallControlRoot,
    materializeControlledNpmConfig,
} from './installEnvPolicy.js';
export {
    evaluateInstallScriptPolicy,
    mustIgnoreInstallScripts,
    allowInstallScriptsForPackage,
    clearInstallScriptAllows,
} from './installScriptPolicy.js';
export {
    getDefaultRegistry,
    assertSourceAuthorized,
    classifyResolvedSource,
    allowRegistryHost,
    clearAllowedRegistryHosts,
} from './sourcePolicy.js';
