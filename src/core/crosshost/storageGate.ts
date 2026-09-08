import { secrets } from '#core/helpers/secretManager.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('CrossHost:StorageGate');

const FORBIDDEN_ENGINES = new Set([
    'sqlite',
    'native-sqlite',
    'better-sqlite3',
    'native-novadb',
    'novadb',
]);

const EMBEDDED_SURREAL_PREFIXES = [
    'mem://',
    'rocksdb://',
    'surrealkv://',
    'surrealkv+versioned://',
] as const;

function isFileUri(uri: string): boolean {
    const lower = uri.trim().toLowerCase();
    if (lower.startsWith('file:')) return true;
    if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return true;
    if (EMBEDDED_SURREAL_PREFIXES.some((p) => lower.startsWith(p))) return true;
    if (lower.startsWith('/') || /^[a-z]:[\\/]/i.test(lower)) {
        if (!lower.startsWith('postgres') && !lower.startsWith('mysql') && !lower.startsWith('mongodb') && !lower.startsWith('redis')) {
            return true;
        }
    }
    return false;
}

export function assertCrossHostStorageAllowed(): void {
    const raw = secrets.getOptional('Database') ?? '{}';
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Cross-Host storage gate: Database env is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Cross-Host storage gate: Database env must be a JSON object');
    }

    const map = parsed as Record<string, unknown>;
    for (const [alias, entry] of Object.entries(map)) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        const uri = typeof rec.uri === 'string' ? rec.uri : '';
        const engine = typeof rec.engine === 'string' ? rec.engine.toLowerCase() : '';

        if (engine && FORBIDDEN_ENGINES.has(engine)) {
            throw new Error(
                `Cross-Host forbids sqlite/local-file engines. Database[${alias}] engine=${engine}. Use networked Redis/Postgres/MySQL/Mongo or remote SurrealDB (ws/wss/http/https).`,
            );
        }
        if (
            uri &&
            isFileUri(uri) &&
            (engine === '' ||
                FORBIDDEN_ENGINES.has(engine) ||
                engine.includes('sqlite') ||
                engine === 'surrealdb')
        ) {
            throw new Error(
                `Cross-Host forbids file-path / embedded database URIs for multi-host. Database[${alias}] uri looks local (${uri.slice(0, 80)}).`,
            );
        }
    }

    assertCrossHostRemoteSurrealConfigured(map);

    log.info('Cross-Host storage gate passed (no sqlite/file/embedded-Surreal primary engines)');
    void import('#core/manager/event.js')
        .then(({ eventBus }) => eventBus.emitConcurrent('crosshost.storage.gate.passed', { at: Date.now() }))
        .catch(() => undefined);
}

const REMOTE_SURREAL_PREFIXES = ['ws://', 'wss://', 'http://', 'https://'] as const;

function isRemoteSurrealUri(uri: string, engine: string): boolean {
    const lower = uri.trim().toLowerCase();
    const remote = REMOTE_SURREAL_PREFIXES.some((p) => lower.startsWith(p));
    if (!remote) return false;
    if (engine === 'surrealdb' || engine === '') return true;
    return false;
}

/**
 * Under CROSS_HOST, document data (audit/error/dash) requires a shared remote SurrealDB.
 * Prefer Database.main if it is remote Surreal; else Database.surreal; else fail boot.
 */
export function assertCrossHostRemoteSurrealConfigured(
    map?: Record<string, unknown>,
): void {
    let parsed = map;
    if (!parsed) {
        const raw = secrets.getOptional('Database') ?? '{}';
        try {
            const p: unknown = JSON.parse(raw);
            if (typeof p === 'object' && p !== null && !Array.isArray(p)) {
                parsed = p as Record<string, unknown>;
            }
        } catch {
            parsed = {};
        }
    }
    const entries = parsed ?? {};

    const candidates = ['main', 'surreal'] as const;
    for (const alias of candidates) {
        const entry = entries[alias];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        const uri = typeof rec.uri === 'string' ? rec.uri : '';
        const engine = typeof rec.engine === 'string' ? rec.engine.toLowerCase() : '';
        if (uri && isRemoteSurrealUri(uri, engine)) {
            log.info(`Cross-Host remote Surreal resolved via Database.${alias}`);
            return;
        }
    }

    throw new Error(
        'CROSS_HOST requires a remote SurrealDB endpoint for shared document data (audit/error/dash). ' +
            'Set Database.main or Database.surreal to a ws://, wss://, http://, or https:// Surreal URI ' +
            '(engine=surrealdb). Embedded mem/rocksdb/surrealkv are not allowed under Cross-Host.',
    );
}
