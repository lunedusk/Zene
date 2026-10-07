/**
 * Phase 2E — Controlled dependency-install environment.
 *
 * This is NOT a sanitized copy of process.env.
 * Core constructs a fresh environment for the install child process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDefaultRegistry } from './sourcePolicy.js';

export interface ControlledInstallEnvOptions {
    readonly pluginDir: string;
    readonly pluginId: string;
    readonly registry?: string;
    readonly controlRoot?: string;
}

const HOST_OPERATIONAL_KEYS = new Set([
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'windir',
    'ComSpec',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LANGUAGE',
]);

export function resolveInstallControlRoot(pluginId: string, explicit?: string): string {
    if (explicit) return path.resolve(explicit);
    return path.resolve(process.cwd(), '.data', 'dependency-install', pluginId);
}

export function materializeControlledNpmConfig(input: {
    controlRoot: string;
    registry: string;
    cacheDir: string;
    prefixDir: string;
}): { userconfig: string; globalconfig: string; npmrcBody: string } {
    fs.mkdirSync(input.controlRoot, { recursive: true });
    fs.mkdirSync(input.cacheDir, { recursive: true });
    fs.mkdirSync(input.prefixDir, { recursive: true });

    const userconfig = path.join(input.controlRoot, 'user.npmrc');
    const globalconfig = path.join(input.controlRoot, 'global.npmrc');

    const npmrcBody =
        [
            `registry=${input.registry}`,
            `cache=${input.cacheDir}`,
            `prefix=${input.prefixDir}`,
            'ignore-scripts=true',
            'audit=false',
            'fund=false',
            'update-notifier=false',
            'package-lock=false',
            'always-auth=false',
        ].join('\n') + '\n';

    fs.writeFileSync(userconfig, npmrcBody, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(globalconfig, '# zene controlled empty globalconfig\n', {
        encoding: 'utf8',
        mode: 0o600,
    });

    return { userconfig, globalconfig, npmrcBody };
}

/**
 * Build a fresh controlled environment for dependency installation.
 * Does not mutate process.env / hostEnv.
 */
export function buildControlledInstallEnv(
    options: ControlledInstallEnvOptions,
    hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const controlRoot = resolveInstallControlRoot(options.pluginId, options.controlRoot);
    const cacheDir = path.join(controlRoot, 'cache');
    const prefixDir = path.join(controlRoot, 'prefix');
    const fakeHome = path.join(controlRoot, 'home');
    fs.mkdirSync(fakeHome, { recursive: true });

    const registry = options.registry ?? getDefaultRegistry();
    const { userconfig, globalconfig } = materializeControlledNpmConfig({
        controlRoot,
        registry,
        cacheDir,
        prefixDir,
    });

    const out: NodeJS.ProcessEnv = {};

    for (const key of HOST_OPERATIONAL_KEYS) {
        const v = hostEnv[key];
        if (typeof v === 'string' && v.length > 0) {
            out[key] = v;
        }
    }
    if (!out.PATH) {
        out.PATH = '/usr/local/bin:/usr/bin:/bin';
    }

    const hostTmp = hostEnv.TMPDIR || hostEnv.TMP || hostEnv.TEMP;
    if (typeof hostTmp === 'string' && hostTmp.length > 0) {
        out.TMPDIR = hostTmp;
        out.TMP = hostTmp;
        out.TEMP = hostTmp;
    } else {
        const tmp = path.join(controlRoot, 'tmp');
        fs.mkdirSync(tmp, { recursive: true });
        out.TMPDIR = tmp;
        out.TMP = tmp;
        out.TEMP = tmp;
    }

    // Controlled home — blocks operator $HOME/.npmrc
    out.HOME = fakeHome;
    out.USERPROFILE = fakeHome;

    out.npm_config_userconfig = userconfig;
    out.npm_config_globalconfig = globalconfig;
    out.NPM_CONFIG_USERCONFIG = userconfig;
    out.NPM_CONFIG_GLOBALCONFIG = globalconfig;
    out.npm_config_cache = cacheDir;
    out.npm_config_prefix = prefixDir;
    out.npm_config_registry = registry;
    out.npm_config_ignore_scripts = 'true';
    out.npm_config_audit = 'false';
    out.npm_config_fund = 'false';
    out.npm_config_update_notifier = 'false';
    out.npm_config_package_lock = 'false';

    if (typeof hostEnv.NODE_ENV === 'string' && hostEnv.NODE_ENV.length > 0) {
        out.NODE_ENV = hostEnv.NODE_ENV;
    }

    // Never: NODE_PATH, host npm_config_*, DiscordToken, AWS_*, etc.

    return out;
}

/** Alias kept for backends during transition. */
export function sanitizeInstallEnv(
    source: NodeJS.ProcessEnv = process.env,
    options?: ControlledInstallEnvOptions,
): NodeJS.ProcessEnv {
    if (options) {
        return buildControlledInstallEnv(options, source);
    }
    return buildControlledInstallEnv(
        {
            pluginId: '_anonymous',
            pluginDir: path.resolve(process.cwd(), '.data', 'dependency-install', '_anonymous'),
        },
        source,
    );
}

export function isInstallEnvKeyAllowed(key: string): boolean {
    return HOST_OPERATIONAL_KEYS.has(key);
}

export function listInstallEnvAllowlist(): readonly string[] {
    return [...HOST_OPERATIONAL_KEYS].sort();
}
