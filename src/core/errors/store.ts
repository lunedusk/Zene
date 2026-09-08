import { randomBytes } from 'node:crypto';
import type { Surreal } from 'surrealdb';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { surrealDB } from '#core/database/index.js';
import type {
    ErrorContext,
    ErrorContextValue,
    ErrorOccurrence,
    ErrorOccurrenceInput,
    ErrorSeverity,
} from './types.js';

const log = getLogger('ErrorStore');
const TABLE = 'error_occurrences';

const ALLOWED_CONTEXT_KEYS = new Set([
    'count',
    'name',
    'guildId',
    'userId',
    'pluginId',
    'roleId',
    'deviceId',
    'path',
    'method',
    'code',
    'status',
    'route',
    'bit',
    'target',
    'actorId',
    'actorType',
]);

function coalesceWindowSec(): number {
    const raw = secrets.getOptional('ErrorCoalesceWindowSec', '60');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 60;
    return Math.min(Math.floor(n), 3600);
}

function sanitizeContext(ctx: Record<string, unknown> | undefined): ErrorContext {
    const out: ErrorContext = {};
    if (!ctx) return out;
    for (const [key, value] of Object.entries(ctx)) {
        if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
        if (value === null) {
            out[key] = null;
            continue;
        }
        const t = typeof value;
        if (t === 'number' || t === 'boolean') {
            out[key] = value as ErrorContextValue;
            continue;
        }
        if (t === 'string') {
            const s = value as string;
            out[key] = s.length > 256 ? s.slice(0, 256) : s;
        }
    }
    return out;
}

function newId(): string {
    return randomBytes(16).toString('hex');
}

function getDb(): Surreal {
    return surrealDB.get('main');
}

function unwrapList(result: unknown): Record<string, unknown>[] {
    if (!Array.isArray(result) || result.length === 0) return [];
    const first = result[0];
    if (Array.isArray(first)) {
        return first.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
    }
    if (first && typeof first === 'object') return [first as Record<string, unknown>];
    return [];
}

function unwrapOne(result: unknown): Record<string, unknown> | null {
    const list = unwrapList(result);
    return list[0] ?? null;
}

function rowToOccurrence(row: Record<string, unknown>): ErrorOccurrence {
    let context: ErrorContext = {};
    const raw = row.context;
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                context = sanitizeContext(parsed as Record<string, unknown>);
            }
        } catch {
            context = {};
        }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        context = sanitizeContext(raw as Record<string, unknown>);
    }
    const severityRaw = String(row.severity ?? 'error');
    const severity: ErrorSeverity =
        severityRaw === 'debug' ||
        severityRaw === 'info' ||
        severityRaw === 'warn' ||
        severityRaw === 'error' ||
        severityRaw === 'fatal'
            ? severityRaw
            : 'error';
    return {
        id: String(row.id ?? row.key ?? ''),
        code: String(row.code ?? ''),
        category: String(row.category ?? 'unknown'),
        severity,
        message: String(row.message ?? ''),
        context,
        count: Number(row.count ?? 1),
        firstSeen: Number(row.firstSeen ?? row.first_seen ?? 0),
        lastSeen: Number(row.lastSeen ?? row.last_seen ?? 0),
    };
}

export async function upsertErrorOccurrence(input: ErrorOccurrenceInput): Promise<ErrorOccurrence | null> {
    try {
        const db = getDb();
        const now = Math.floor(Date.now() / 1000);
        const windowSec = coalesceWindowSec();
        const windowStart = now - windowSec;
        const context = sanitizeContext(input.context);
        const code = input.code.slice(0, 128);
        const category = String(input.category).slice(0, 64);
        const severity = input.severity;
        const message = input.message.slice(0, 512);

        const existingResult = await db.query(
            `SELECT * FROM type::table($table)
             WHERE code = $code AND lastSeen >= $windowStart
             ORDER BY lastSeen DESC
             LIMIT 1`,
            { table: TABLE, code, windowStart },
        );
        const hit = unwrapOne(existingResult);

        if (hit) {
            const id = String(hit.id ?? hit.key ?? '');
            const count = Number(hit.count ?? 1) + 1;
            const firstSeen = Number(hit.firstSeen ?? now);
            await db.query(
                `UPDATE type::thing($table, $key) SET
                    count = $count,
                    lastSeen = $now,
                    message = $message,
                    context = $context,
                    severity = $severity,
                    category = $category
                 RETURN NONE`,
                {
                    table: TABLE,
                    key: id,
                    count,
                    now,
                    message,
                    context,
                    severity,
                    category,
                },
            );
            return {
                id,
                code,
                category,
                severity,
                message,
                context,
                count,
                firstSeen,
                lastSeen: now,
            };
        }

        const id = newId();
        const record: ErrorOccurrence = {
            id,
            code,
            category,
            severity,
            message,
            context,
            count: 1,
            firstSeen: now,
            lastSeen: now,
        };
        await db.query('UPSERT type::thing($table, $key) CONTENT $data RETURN NONE', {
            table: TABLE,
            key: id,
            data: {
                key: id,
                id: record.id,
                code: record.code,
                category: record.category,
                severity: record.severity,
                message: record.message,
                context: record.context,
                count: record.count,
                firstSeen: record.firstSeen,
                lastSeen: record.lastSeen,
            },
        });
        return record;
    } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error(`ErrorStore write failed (terminal, not re-entrant): ${e.message}`);
        return null;
    }
}

export interface ErrorListFilter {
    code?: string;
    category?: string;
    severity?: string;
    from?: number;
    to?: number;
    limit?: number;
}

function clampLimit(limit: number | undefined): number {
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 50;
    if (n < 1) return 1;
    if (n > 100_000) return 100_000;
    return n;
}

export async function listErrorOccurrences(filter: ErrorListFilter = {}): Promise<ErrorOccurrence[]> {
    const db = getDb();
    const limit = clampLimit(filter.limit);
    const clauses: string[] = [];
    const vars: Record<string, unknown> = { table: TABLE, limit };

    if (filter.code) {
        clauses.push('code = $code');
        vars.code = filter.code;
    }
    if (filter.category) {
        clauses.push('category = $category');
        vars.category = filter.category;
    }
    if (filter.severity) {
        clauses.push('severity = $severity');
        vars.severity = filter.severity;
    }
    if (filter.from != null) {
        clauses.push('lastSeen >= $from');
        vars.from = filter.from;
    }
    if (filter.to != null) {
        clauses.push('lastSeen <= $to');
        vars.to = filter.to;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
        `SELECT * FROM type::table($table) ${where} ORDER BY lastSeen DESC LIMIT $limit`,
        vars,
    );
    return unwrapList(result).map(rowToOccurrence);
}

export async function getErrorOccurrenceById(id: string): Promise<ErrorOccurrence | null> {
    const db = getDb();
    const result = await db.query('SELECT * FROM ONLY type::thing($table, $key)', {
        table: TABLE,
        key: id,
    });
    const row = unwrapOne(result);
    if (!row) return null;
    return rowToOccurrence(row);
}

export function resetErrorAdapterCache(): void {
    // Surreal client is process-scoped via surrealDB registry.
}
