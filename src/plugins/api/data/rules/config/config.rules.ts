import type { RulesValidateFn } from '#core/validation/types.js';

const PLACEHOLDER_KEY = /replace.?me|changeme|your.?secret|todo|xxx/i;

export const validate: RulesValidateFn = (data, _ctx) => {
    if (!data || typeof data !== 'object') return true;

    const cfg = data as {
        publicBaseUrl?: string;
        cors?: {
            allowedOrigins?: string[];
            credentials?: boolean;
            allowedMethods?: string[];
        };
        auth?: {
            enabled?: boolean;
            masterKeySource?: 'env' | 'config';
            masterKeyEnvVar?: string;
            publicPaths?: string[];
            keys?: Array<{ key?: string; label?: string; enabled?: boolean; bits?: string[] }>;
        };
    };

    const issues: string[] = [];

    const cors = cfg.cors;
    if (cors) {
        if (cors.credentials === true && cors.allowedOrigins?.includes('*')) {
            issues.push(
                'cors: credentials=true is incompatible with allowedOrigins containing "*"'
            );
        }

        for (const origin of cors.allowedOrigins ?? []) {
            if (origin === '*' || origin.startsWith('/')) continue;
            try {
                 
                new URL(origin);
            } catch {
                issues.push(`cors.allowedOrigins: invalid origin "${origin}" (use URL, *, or /regex/flags)`);
            }
        }
    }

    const auth = cfg.auth;
    if (auth?.enabled) {
        if (auth.masterKeySource === 'env') {
            const envName = (auth.masterKeyEnvVar || '').trim();
            if (!envName) {
                issues.push('auth.masterKeyEnvVar is required when masterKeySource is "env"');
            }
        }

        if (auth.masterKeySource === 'config') {
            const enabledKeys = (auth.keys ?? []).filter(k => k.enabled !== false);
            if (enabledKeys.length === 0) {
                issues.push(
                    'auth.masterKeySource is "config" but no enabled keys are defined in auth.keys'
                );
            }
        }

        for (const entry of auth.keys ?? []) {
            const key = entry.key ?? '';
            if (entry.enabled !== false && PLACEHOLDER_KEY.test(key)) {
                issues.push(
                    `auth.keys["${entry.label ?? 'unknown'}"]: placeholder/weak key — replace before production`
                );
            }
            if (entry.enabled !== false && key.length > 0 && key.length < 16) {
                issues.push(
                    `auth.keys["${entry.label ?? 'unknown'}"]: key length < 16 — use a stronger secret`
                );
            }
            if (entry.bits) {
                for (const bit of entry.bits) {
                    if (!/^[a-z][a-z0-9._-]*$/i.test(bit)) {
                        issues.push(`auth.keys bits: invalid bit id "${bit}"`);
                    }
                }
            }
        }

        for (const p of auth.publicPaths ?? []) {
            if (!p.startsWith('/')) {
                issues.push(`auth.publicPaths: path must start with "/": "${p}"`);
            }
        }
    }

    if (cfg.publicBaseUrl) {
        try {
            const u = new URL(cfg.publicBaseUrl);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                issues.push('publicBaseUrl must be http(s)');
            }
        } catch {
            issues.push(`publicBaseUrl is not a valid URL: ${cfg.publicBaseUrl}`);
        }
    }

    if (issues.length === 0) return true;
    return issues;
};

export default validate;