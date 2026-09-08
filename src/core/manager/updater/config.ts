import { secrets } from '#core/helpers/secretManager.js';
import { BUILTIN_PUBLIC_KEY, defaultString } from '#core/defaults.js';
import { getLogger } from '#core/utils/logger.js';
import type { UpdaterConfig } from './types.js';

const log = getLogger('Updater');

export const HARD_EXCLUDES = new Set([
    'node_modules',
    '.git',
    '.github',
    '.data',
    'logs',
    'configuration',
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.DS_Store',
    '.idea',
    '.vscode',
    'coverage',
    '.turbo',
    '.nx',
    'common.json',
]);

function parsePluginPublicKeys(): Record<string, string> {
    const raw = secrets.getOptional('PluginPublicKeys');
    if (!raw) return {};
    try {
        const obj = JSON.parse(raw) as Record<string, string>;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && v.trim()) out[k.trim()] = v.trim();
        }
        return out;
    } catch {
        log.warn('PluginPublicKeys is not valid JSON – ignoring');
        return {};
    }
}

export function loadUpdaterConfig(): UpdaterConfig {
    return {
        autoUpdater: secrets.getBoolean('AutoUpdater', true),
        repositoryUrl: secrets.getOptional('RepositoryUrl') || null,
        githubPat: secrets.getOptional('GithubPat') || secrets.getOptional('GH_TOKEN') || null,
        defaultRepo:
            secrets.getOptional('UpdaterDefaultRepo') ||
            defaultString('UpdaterDefaultRepo') ||
            'lunedusk/Zene',
        branch: secrets.getOptional('UpdaterBranch') || defaultString('UpdaterBranch') || 'main',
        devBuilds: secrets.getBoolean('DevBuilds', false),
        safeUpdate: secrets.getBoolean('SafeUpdate', true),
        keepExtra: secrets.getBoolean('UpdaterKeepExtra', true),
        allowForce: secrets.getBoolean('UpdaterAllowForce', false),
        dryRun: secrets.getBoolean('UpdaterDryRun', false),
        maxBackups: parseInt(
            secrets.getOptional('UpdaterMaxBackups') || defaultString('UpdaterMaxBackups') || '3',
            10,
        ),
        timeoutMs: parseInt(
            secrets.getOptional('UpdaterTimeoutMs') || defaultString('UpdaterTimeoutMs') || '300000',
            10,
        ),
        postUpdateCmd: secrets.getOptional('UpdaterPostUpdateCmd') || null,
        notifyChannel: secrets.getOptional('UpdaterNotifyChannel') || null,
        pluginManifest:
            secrets.getOptional('UpdaterPluginManifest') ||
            defaultString('UpdaterPluginManifest') ||
            'manifest.json',
        mode: (secrets.getOptional('UpdaterMode') as 'standalone' | 'background') || 'standalone',
        pluginPublicKeys: parsePluginPublicKeys(),
        publicKey: secrets.getOptional('PublicKey') || process.env.PublicKey || BUILTIN_PUBLIC_KEY,
        intervalMs: parseInt(
            secrets.getOptional('UpdaterIntervalMs') ||
                defaultString('UpdaterIntervalMs') ||
                String(6 * 60 * 60 * 1000),
            10,
        ),
        backgroundApply: secrets.getBoolean('UpdaterBackgroundApply', false),
        autoRollback: secrets.getBoolean('UpdaterAutoRollback', true),
        healthGraceMs: parseInt(
            secrets.getOptional('UpdaterHealthGraceMs') ||
                defaultString('UpdaterHealthGraceMs') ||
                String(15 * 60 * 1000),
            10,
        ),
    };
}
