import { secrets } from '#core/helpers/secretManager.js';
import { SemVer } from '#core/utils/semver.js';
import type { IHeart } from '#core/heart/index.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('Requirements');

export type DeployMode = 'standalone' | 'sharded' | 'crosshost';

export interface RequirementContext {
    readonly heart: IHeart;
    readonly pluginId: string;
    readonly mode: DeployMode;
    readonly crossHostRole: 'orchestrator' | 'worker' | null;
    readonly env: {
        get(key: string): string | undefined;
        getBoolean(key: string, fallback?: boolean): boolean;
    };
    readonly plugins: {
        isLoaded(id: string): boolean;
        listLoaded(): readonly string[];
    };
    readonly nodeVersion: string;
}

export type RequirementFn = (
    ctx: RequirementContext,
) => boolean | Promise<boolean>;

export interface RegisterRequirements {
    mode?: 'soft' | 'strict';
    crossHost?: boolean;
    crossHostRole?: 'worker' | 'orchestrator';
    isSharded?: boolean;
    standalone?: boolean;
    modes?: ReadonlyArray<DeployMode>;
    env?: Record<string, string | number | boolean | null>;
    envTruthy?: readonly string[];
    nodeVersion?: string;
    plugins?: readonly string[];
    /**
     * Phase 2C — required provider categories (Phase 2A registry).
     * Component does not activate if category has no eligible provider.
     * Not signed metadata; runtime requirement only.
     */
    providers?: readonly string[];
    all?: readonly RequirementFn[];
    any?: readonly RequirementFn[];
    when?: RequirementFn;
}

export interface RequirementResult {
    readonly ok: boolean;
    readonly reasons: readonly string[];
}

export function detectDeployMode(): DeployMode {
    if (secrets.getBoolean('CROSS_HOST', false)) return 'crosshost';
    if (secrets.getBoolean('isSharded', false)) return 'sharded';
    return 'standalone';
}

export function detectCrossHostRole(): 'orchestrator' | 'worker' | null {
    if (!secrets.getBoolean('CROSS_HOST', false)) return null;
    const role = (secrets.getOptional('CROSS_HOST_ROLE', '') ?? '').trim().toLowerCase();
    if (role === 'orchestrator' || role === 'worker') return role;
    return null;
}

export function buildRequirementContext(heart: IHeart, pluginId: string): RequirementContext {
    let loaded: string[] = [];
    try {
        const g = globalThis as {
            __zenePluginManager?: { registry: Map<string, unknown> };
        };
        if (g.__zenePluginManager?.registry) {
            loaded = [...g.__zenePluginManager.registry.keys()];
        }
    } catch {
        loaded = [];
    }

    return {
        heart,
        pluginId,
        mode: detectDeployMode(),
        crossHostRole: detectCrossHostRole(),
        env: {
            get: (key) => secrets.getOptional(key) ?? undefined,
            getBoolean: (key, fallback = false) => secrets.getBoolean(key, fallback),
        },
        plugins: {
            isLoaded: (id) => loaded.includes(id),
            listLoaded: () => loaded,
        },
        nodeVersion: process.versions.node,
    };
}

async function runFn(
    fn: RequirementFn,
    ctx: RequirementContext,
    label: string,
    reasons: string[],
): Promise<boolean> {
    try {
        const result = await fn(ctx);
        if (!result) reasons.push(`${label} returned false`);
        return result;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        reasons.push(`${label} threw: ${message}`);
        return false;
    }
}

export async function evaluateRequirements(
    requirements: RegisterRequirements | undefined,
    ctx: RequirementContext,
): Promise<RequirementResult> {
    if (!requirements) return { ok: true, reasons: [] };

    const reasons: string[] = [];

    if (requirements.modes && requirements.modes.length > 0) {
        if (!requirements.modes.includes(ctx.mode)) {
            reasons.push(`mode ${ctx.mode} not in [${requirements.modes.join(', ')}]`);
        }
    }

    if (requirements.crossHost !== undefined) {
        const isCh = ctx.mode === 'crosshost';
        if (requirements.crossHost !== isCh) {
            reasons.push(`crossHost required=${requirements.crossHost} actual=${isCh}`);
        }
    }

    if (requirements.crossHostRole !== undefined) {
        if (ctx.crossHostRole !== requirements.crossHostRole) {
            reasons.push(
                `crossHostRole required=${requirements.crossHostRole} actual=${ctx.crossHostRole ?? 'null'}`,
            );
        }
    }

    if (requirements.isSharded !== undefined) {
        const isSh = ctx.mode === 'sharded';
        if (requirements.isSharded !== isSh) {
            reasons.push(`isSharded required=${requirements.isSharded} actual=${isSh}`);
        }
    }

    if (requirements.standalone !== undefined) {
        const isStandalone = ctx.mode === 'standalone';
        if (requirements.standalone !== isStandalone) {
            reasons.push(`standalone required=${requirements.standalone} actual=${isStandalone}`);
        }
    }

    if (requirements.env) {
        for (const [key, expected] of Object.entries(requirements.env)) {
            const raw = ctx.env.get(key);
            if (expected === null) {
                if (raw !== undefined && raw !== '') {
                    reasons.push(`env ${key} must be unset`);
                }
                continue;
            }
            if (typeof expected === 'boolean') {
                if (ctx.env.getBoolean(key, false) !== expected) {
                    reasons.push(`env ${key} boolean mismatch`);
                }
                continue;
            }
            if (String(raw ?? '') !== String(expected)) {
                reasons.push(`env ${key} expected=${String(expected)} actual=${raw ?? ''}`);
            }
        }
    }

    if (requirements.envTruthy) {
        for (const key of requirements.envTruthy) {
            const raw = ctx.env.get(key);
            if (raw === undefined || raw === '' || raw === '0' || raw.toLowerCase() === 'false') {
                reasons.push(`env ${key} must be truthy`);
            }
        }
    }

    if (requirements.nodeVersion) {
        try {
            if (!SemVer.satisfies(ctx.nodeVersion, requirements.nodeVersion)) {
                reasons.push(
                    `node ${ctx.nodeVersion} does not satisfy ${requirements.nodeVersion}`,
                );
            }
        } catch (err: unknown) {
            reasons.push(
                `nodeVersion check failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    if (requirements.plugins) {
        for (const id of requirements.plugins) {
            if (!ctx.plugins.isLoaded(id)) {
                reasons.push(`plugin ${id} not loaded`);
            }
        }
    }

    if (requirements.providers && requirements.providers.length > 0) {
        try {
            const { providerRegistry } = await import('#core/provider/registry.js');
            for (const category of requirements.providers) {
                const selected = providerRegistry.select(category);
                if (!selected.ok) {
                    reasons.push(
                        `provider category '${category}' not available: ${selected.message}`,
                    );
                }
            }
        } catch (err: unknown) {
            reasons.push(
                `provider requirement check failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    if (requirements.when) {
        await runFn(requirements.when, ctx, 'when', reasons);
    }

    if (requirements.all) {
        for (let i = 0; i < requirements.all.length; i++) {
            await runFn(requirements.all[i]!, ctx, `all[${i}]`, reasons);
        }
    }

    if (requirements.any && requirements.any.length > 0) {
        let anyOk = false;
        const anyReasons: string[] = [];
        for (let i = 0; i < requirements.any.length; i++) {
            const ok = await runFn(requirements.any[i]!, ctx, `any[${i}]`, anyReasons);
            if (ok) {
                anyOk = true;
                break;
            }
        }
        if (!anyOk) {
            reasons.push(`any[] all failed: ${anyReasons.join('; ')}`);
        }
    }

    const ok = reasons.length === 0;
    if (!ok) {
        log.debug('Requirements not met', {
            pluginId: ctx.pluginId,
            mode: ctx.mode,
            reasons,
        });
    }
    return { ok, reasons };
}

export function requirementsMode(
    requirements: RegisterRequirements | undefined,
    fallback: 'soft' | 'strict' = 'soft',
): 'soft' | 'strict' {
    return requirements?.mode ?? fallback;
}
