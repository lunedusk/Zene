import { secrets } from '#core/helpers/secretManager.js';
import { configManager } from '#core/manager/config.js';
import { sqliteDB } from '#core/database/sqlite.js';
import { pgDB } from '#core/database/postgres.js';
import { mongoDB } from '#core/database/mongo.js';
import { surrealDB } from '#core/database/surreal.js';
import { redisDB } from '#core/database/redis.js';

/** Engines usable by permissions/token and classic SQL/document subsystems. */
export type DataEngine = 'sqlite' | 'postgres' | 'mongo';

/** Engines usable by the Core data platform (Phase 4A). */
export type CoreDataEngine = DataEngine | 'surreal' | 'redis';

export interface BackendChoice {
    engine: DataEngine;
    alias: string;
}

export interface CoreDataBackendChoice {
    engine: CoreDataEngine;
    alias: string;
    /** True when CoreDataEngine / core.dataBackend / cfg.engine was set. */
    readonly explicit: boolean;
}

export interface ResolveBackendInput {
    configSection?: string;
    configEngine?: string | null;
    configAlias?: string | null;
    envEngineKey: string;
    envAliasKey: string;
    defaultAlias?: string;
}

function normalizeEngine(raw: string | null | undefined): DataEngine | null {
    if (!raw) return null;
    const v = raw.toString().trim().toLowerCase();
    if (v === 'sqlite' || v === 'native-sqlite') return 'sqlite';
    if (v === 'postgres' || v === 'postgresql' || v === 'pg' || v === 'native-pg') {
        return 'postgres';
    }
    if (v === 'mongo' || v === 'mongodb') return 'mongo';
    return null;
}

function normalizeCoreDataEngine(
    raw: string | null | undefined,
): CoreDataEngine | null {
    const base = normalizeEngine(raw);
    if (base) return base;
    if (!raw) return null;
    const v = raw.toString().trim().toLowerCase();
    if (v === 'surreal' || v === 'surrealdb') return 'surreal';
    if (v === 'redis') return 'redis';
    return null;
}

function readConfigEngineAlias(
    section: string | undefined,
): { engine?: string; alias?: string } {
    if (!section) return {};
    try {
        const cfg = configManager.get<Record<string, unknown>>(section);
        if (!cfg) return {};
        return {
            engine: cfg.engine != null ? String(cfg.engine) : undefined,
            alias: cfg.alias != null ? String(cfg.alias) : undefined,
        };
    } catch {
        return {};
    }
}

function isConnected(engine: DataEngine, alias: string): boolean {
    try {
        if (engine === 'sqlite') return sqliteDB.has(alias);
        if (engine === 'postgres') return pgDB.has(alias);
        if (engine === 'mongo') return mongoDB.has(alias);
    } catch {
        return false;
    }
    return false;
}

function isCoreDataConnected(engine: CoreDataEngine, alias: string): boolean {
    try {
        if (engine === 'sqlite' || engine === 'postgres' || engine === 'mongo') {
            return isConnected(engine, alias);
        }
        if (engine === 'surreal') return surrealDB.has(alias);
        if (engine === 'redis') return redisDB.has(alias);
    } catch {
        return false;
    }
    return false;
}

export function resolveBackend(input: ResolveBackendInput): BackendChoice {
    const fromConfig = readConfigEngineAlias(input.configSection);
    const engineRaw =
        input.configEngine ??
        fromConfig.engine ??
        secrets.getOptional(input.envEngineKey) ??
        null;
    const alias =
        (input.configAlias ??
            fromConfig.alias ??
            secrets.getOptional(input.envAliasKey) ??
            input.defaultAlias ??
            'main')
            .toString()
            .trim() || 'main';

    const forced = normalizeEngine(engineRaw);
    if (forced) {
        if (!isConnected(forced, alias)) {
            throw new Error(
                `Data backend ${forced} alias "${alias}" is not connected (requested via config/env).`,
            );
        }
        return { engine: forced, alias };
    }

    const preference: DataEngine[] = ['sqlite', 'postgres', 'mongo'];
    for (const engine of preference) {
        if (isConnected(engine, alias)) {
            return { engine, alias };
        }
    }

    throw new Error(
        `No data backend connected for alias "${alias}" (tried sqlite → postgres → mongo).`,
    );
}

export function resolvePermissionsBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'permissions',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'PermissionsEngine',
        envAliasKey: 'PermissionsDbAlias',
        defaultAlias: 'main',
    });
}

export function resolveTokenBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'token',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'TokenEngine',
        envAliasKey: 'TokenDbAlias',
        defaultAlias: 'main',
    });
}

export function resolveDashboardBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    return resolveBackend({
        configSection: 'dashboard',
        configEngine: cfg?.engine,
        configAlias: cfg?.alias,
        envEngineKey: 'DashboardEngine',
        envAliasKey: 'DashboardDbAlias',
        defaultAlias: 'main',
    });
}

/**
 * Canonical Core data-platform backend resolution.
 *
 * Explicit configuration sources (in order):
 * 1. cfg.engine / cfg.alias
 * 2. core.dataBackend in config
 * 3. CoreDataEngine / CoreDataAlias env
 *
 * When an engine is explicit and that engine/alias is not connected → fail closed.
 * When no engine is explicit → prefer connected sqlite → postgres → mongo → surreal → redis
 * (sqlite skipped under CROSS_HOST).
 */
export function resolveCoreDataBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): CoreDataBackendChoice {
    let fromCore: { engine?: string; alias?: string } = {};
    try {
        const core = configManager.get<{
            dataBackend?: { engine?: string; alias?: string };
        }>('core');
        if (core?.dataBackend) {
            fromCore = {
                engine:
                    core.dataBackend.engine != null
                        ? String(core.dataBackend.engine)
                        : undefined,
                alias:
                    core.dataBackend.alias != null
                        ? String(core.dataBackend.alias)
                        : undefined,
            };
        }
    } catch {
        fromCore = {};
    }

    const engineRaw =
        cfg?.engine ?? fromCore.engine ?? secrets.getOptional('CoreDataEngine') ?? null;
    const alias =
        (
            cfg?.alias ??
            fromCore.alias ??
            secrets.getOptional('CoreDataAlias') ??
            'main'
        )
            .toString()
            .trim() || 'main';

    const forced = normalizeCoreDataEngine(engineRaw);
    if (forced) {
        if (!isCoreDataConnected(forced, alias)) {
            throw new Error(
                `Core data backend ${forced} alias "${alias}" is not connected (explicit CoreDataEngine/core.dataBackend).`,
            );
        }
        return { engine: forced, alias, explicit: true };
    }

    const preference: CoreDataEngine[] = [
        'sqlite',
        'postgres',
        'mongo',
        'surreal',
        'redis',
    ];
    const crossHost = secrets.getBoolean('CROSS_HOST', false);
    for (const engine of preference) {
        if (crossHost && engine === 'sqlite') continue;
        if (isCoreDataConnected(engine, alias)) {
            return { engine, alias, explicit: false };
        }
    }

    for (const engine of preference) {
        if (crossHost && engine === 'sqlite') continue;
        if (isCoreDataConnected(engine, 'main')) {
            return { engine, alias: 'main', explicit: false };
        }
    }

    throw new Error(
        `No usable Core data backend connected (alias "${alias}"; no explicit engine; tried ${preference.join(' → ')}).`,
    );
}

export function resolveGuildGateBackend(cfg?: {
    engine?: string | null;
    alias?: string | null;
}): BackendChoice {
    try {
        const choice = resolveCoreDataBackend(cfg);
        if (
            choice.engine === 'sqlite' ||
            choice.engine === 'postgres' ||
            choice.engine === 'mongo'
        ) {
            return { engine: choice.engine, alias: choice.alias };
        }
        // Core data may resolve to surreal/redis; guild gate only supports DataEngine set
        return resolveBackend({
            configSection: undefined,
            configEngine: null,
            configAlias: choice.alias,
            envEngineKey: 'GuildGateEngine',
            envAliasKey: 'GuildGateDbAlias',
            defaultAlias: choice.alias,
        });
    } catch {
        return resolveBackend({
            configSection: undefined,
            configEngine: cfg?.engine,
            configAlias: cfg?.alias,
            envEngineKey: 'CoreDataEngine',
            envAliasKey: 'CoreDataAlias',
            defaultAlias: 'main',
        });
    }
}
