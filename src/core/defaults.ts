/**
 * Single source of truth for framework env/secret defaults.
 * Required secrets (tokens, URIs, PATs) are listed as required with no value.
 * Call sites should prefer secrets.getOptional / getBoolean (auto-fallback)
 * or import constants from this module for boot-critical materialization.
 */

export const BUILTIN_PUBLIC_KEY =
    'MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=';

export type DefaultKind = 'string' | 'boolean' | 'number';

export interface DefaultEntry {
    readonly key: string;
    readonly kind: DefaultKind;
    /** Present for optional keys with a safe default. Absent when required. */
    readonly value?: string | boolean | number;
    readonly required?: boolean;
    /** When true, never materialize onto process.env at boot. */
    readonly sensitive?: boolean;
}

/** Keys materialized onto process.env when unset (boot parity with legacy index.ts). */
export const MATERIALIZE_KEYS = ['NODE_ENV', 'PublicKey'] as const;

const ENTRIES: readonly DefaultEntry[] = [
    // --- identity / boot ---
    { key: 'NODE_ENV', kind: 'string', value: 'production' },
    { key: 'PublicKey', kind: 'string', value: BUILTIN_PUBLIC_KEY },
    { key: 'DiscordToken', kind: 'string', required: true, sensitive: true },
    { key: 'BotOwnerIds', kind: 'string', value: '' },
    { key: 'DefaultLocale', kind: 'string', value: 'en' },
    { key: 'GuildID', kind: 'string' },

    // --- HTTP ---
    { key: 'APIPort', kind: 'string', value: '3000' },
    { key: 'APIHost', kind: 'string', value: '0.0.0.0' },

    // --- flags ---
    { key: 'hotReloadEnabled', kind: 'boolean', value: false },
    { key: 'isSharded', kind: 'boolean', value: false },
    { key: 'CROSS_HOST', kind: 'boolean', value: false },
    { key: 'EnableGlobalRatelimit', kind: 'boolean', value: true },
    { key: 'AuditFailClosed', kind: 'boolean', value: false },
    { key: 'allowUnCertifiedPlugins', kind: 'boolean', value: false },
    { key: 'DisableDefaultSqlite', kind: 'boolean', value: false },
    { key: 'DisableDefaultSurrealDB', kind: 'boolean', value: false },

    // --- updater ---
    { key: 'AutoUpdater', kind: 'boolean', value: true },
    { key: 'DevBuilds', kind: 'boolean', value: false },
    { key: 'SafeUpdate', kind: 'boolean', value: true },
    { key: 'UpdaterKeepExtra', kind: 'boolean', value: true },
    { key: 'UpdaterAllowForce', kind: 'boolean', value: false },
    { key: 'UpdaterDryRun', kind: 'boolean', value: false },
    { key: 'UpdaterBackgroundApply', kind: 'boolean', value: false },
    { key: 'UpdaterAutoRollback', kind: 'boolean', value: true },
    { key: 'UpdaterDefaultRepo', kind: 'string', value: 'lunedusk/Zene' },
    { key: 'UpdaterBranch', kind: 'string', value: 'main' },
    { key: 'UpdaterMaxBackups', kind: 'string', value: '3' },
    { key: 'UpdaterTimeoutMs', kind: 'string', value: '300000' },
    { key: 'UpdaterPluginManifest', kind: 'string', value: 'manifest.json' },
    { key: 'UpdaterMode', kind: 'string', value: 'standalone' },
    { key: 'UpdaterIntervalMs', kind: 'string', value: String(6 * 60 * 60 * 1000) },
    { key: 'UpdaterHealthGraceMs', kind: 'string', value: String(15 * 60 * 1000) },

    // --- errors ---
    { key: 'ErrorCoalesceWindowSec', kind: 'string', value: '60' },

    // --- token plugin ---
    { key: 'TokenMasterSecret', kind: 'string', required: true, sensitive: true },
    { key: 'TokenTTL', kind: 'string', value: '900' },
    { key: 'TokenMaxTTL', kind: 'string', value: '86400' },
    { key: 'TokenIssuer', kind: 'string', value: 'zene' },
    { key: 'TokenAudience', kind: 'string', value: 'dashboard' },

    // --- cross-host ---
    { key: 'CROSS_HOST_HTTP_HOST', kind: 'string', value: '0.0.0.0' },
    { key: 'CROSS_HOST_HTTP_PORT', kind: 'string', value: '8020' },
    { key: 'CROSS_HOST_MTLS_ENABLED', kind: 'boolean', value: false },
    { key: 'CROSS_HOST_INDEX_ENABLED', kind: 'boolean', value: false },
    { key: 'CROSS_HOST_API_GATEWAY_ENABLED', kind: 'boolean', value: true },
    { key: 'CROSS_HOST_LOAD_WEIGHT_GUILD', kind: 'string', value: '1' },
    { key: 'CROSS_HOST_LOAD_WEIGHT_MEMBER', kind: 'string', value: '0.001' },
    { key: 'CROSS_HOST_LOAD_WEIGHT_EVENT', kind: 'string', value: '10' },
    { key: 'CROSS_HOST_LOAD_WEIGHT_COMMAND', kind: 'string', value: '20' },
    { key: 'CROSS_HOST_LOAD_WEIGHT_SHARD', kind: 'string', value: '0.5' },
];

const byKey = new Map<string, DefaultEntry>(ENTRIES.map((e) => [e.key, e]));

export function getDefaultEntry(key: string): DefaultEntry | undefined {
    return byKey.get(key);
}

export function hasDefault(key: string): boolean {
    const e = byKey.get(key);
    return e !== undefined && e.value !== undefined;
}

export function defaultString(key: string): string | undefined {
    const e = byKey.get(key);
    if (!e || e.value === undefined) return undefined;
    if (e.kind === 'boolean') return e.value ? 'true' : 'false';
    return String(e.value);
}

export function defaultBoolean(key: string): boolean | undefined {
    const e = byKey.get(key);
    if (!e || e.value === undefined) return undefined;
    if (e.kind === 'boolean') return e.value as boolean;
    if (e.kind === 'string') {
        const n = String(e.value).trim().toLowerCase();
        return n === 'true' || n === '1' || n === 'yes';
    }
    return Boolean(e.value);
}

export function defaultNumber(key: string): number | undefined {
    const e = byKey.get(key);
    if (!e || e.value === undefined) return undefined;
    if (typeof e.value === 'number') return e.value;
    const n = Number(e.value);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Write NODE_ENV and PublicKey onto process.env when unset (legacy boot parity).
 * Does not materialize other registry keys.
 */
export function materializeBootEnv(): void {
    for (const key of MATERIALIZE_KEYS) {
        const current = process.env[key];
        if (current !== undefined && current.trim() !== '') continue;
        const value = defaultString(key);
        if (value !== undefined) {
            process.env[key] = value;
        }
    }
}

export const defaults = Object.freeze({
    BUILTIN_PUBLIC_KEY,
    entries: ENTRIES,
    get: getDefaultEntry,
    has: hasDefault,
    string: defaultString,
    boolean: defaultBoolean,
    number: defaultNumber,
    materializeBootEnv,
});
