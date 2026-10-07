/**
 * Phase 2C — Explicit configuration precedence.
 *
 * Does not replace common.json / ConfigManager / secrets.
 * Documents and centralizes how a single key should be resolved when
 * multiple sources may provide a value.
 *
 * Precedence (highest wins):
 *   1. explicit runtime override (in-memory)
 *   2. process.env (after boot pipeline / ENVSettings assimilation)
 *   3. common.json field (when ENVSettings=false would have pushed it to env;
 *      otherwise treated as documentation / non-env source via reader)
 *   4. framework defaults (defaults.ts MATERIALIZE / DefaultEntry)
 *
 * Secrets remain in SecretManager — never merge secret values into broadly
 * readable config objects. Trust decisions remain Phase 1 (artifact → canonical → trust).
 */

import { defaultString } from '#core/defaults.js';

export type ConfigSource =
    | 'runtime-override'
    | 'environment'
    | 'common-json'
    | 'framework-default'
    | 'absent';

export interface ConfigResolution {
    readonly key: string;
    readonly value: string | undefined;
    readonly source: ConfigSource;
}

const runtimeOverrides = new Map<string, string>();

/** Operator/runtime override (in-process). Highest precedence. */
export function setRuntimeConfigOverride(key: string, value: string): void {
    runtimeOverrides.set(key, value);
}

export function clearRuntimeConfigOverride(key: string): void {
    runtimeOverrides.delete(key);
}

export function clearAllRuntimeConfigOverrides(): void {
    runtimeOverrides.clear();
}

/**
 * Resolve a non-secret configuration key.
 * Does not read SecretManager; callers that need secrets must use secrets.* APIs.
 */
export function resolveConfigValue(
    key: string,
    options?: {
        readonly commonJsonValue?: string | undefined;
        readonly env?: NodeJS.ProcessEnv;
    },
): ConfigResolution {
    if (runtimeOverrides.has(key)) {
        return {
            key,
            value: runtimeOverrides.get(key),
            source: 'runtime-override',
        };
    }

    const env = options?.env ?? process.env;
    const envVal = env[key];
    if (envVal !== undefined && envVal !== '') {
        return { key, value: envVal, source: 'environment' };
    }

    if (options?.commonJsonValue !== undefined && options.commonJsonValue !== '') {
        return {
            key,
            value: options.commonJsonValue,
            source: 'common-json',
        };
    }

    const def = defaultString(key);
    if (def !== undefined && def !== '') {
        return {
            key,
            value: def,
            source: 'framework-default',
        };
    }

    return { key, value: undefined, source: 'absent' };
}

export const CONFIG_PRECEDENCE_ORDER: readonly ConfigSource[] = [
    'runtime-override',
    'environment',
    'common-json',
    'framework-default',
    'absent',
] as const;

/** Boot pipeline stages — mirrors runBootPipeline order (side-effect documentation). */
export const BOOT_PIPELINE_STAGES = [
    'materialize-boot-env',
    'secrets-assimilate-env',
    'expand-placeholders',
    'secrets-lock',
    'common777-bootstrap',
] as const;

export type BootPipelineStage = (typeof BOOT_PIPELINE_STAGES)[number];
