import { randomBytes } from 'node:crypto';
import type { Surreal } from 'surrealdb';
import { surrealDB } from '#core/database/index.js';
import { sanitizeAuditFields, sanitizeAuditMeta } from './redact.js';
import type {
    AuditMeta,
    AuditRecord,
    AuditRecordInput,
    AuditSurface,
    AuditTargetRef,
} from './types.js';

const TABLE = 'audit_entries';

function newId(): string {
    return randomBytes(16).toString('hex');
}

function getDb(): Surreal {
    return surrealDB.get('main');
}

function parseTargetRef(raw: unknown): AuditTargetRef | null {
    if (raw == null) return null;
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const r = obj as Record<string, unknown>;
    const type = String(r.type ?? '');
    const id = String(r.id ?? '');
    if (!id) return null;
    const allowed: AuditTargetRef['type'][] = [
        'user',
        'guild',
        'plugin',
        'role',
        'token_device',
        'config',
        'other',
    ];
    const t = (allowed.includes(type as AuditTargetRef['type'])
        ? type
        : 'other') as AuditTargetRef['type'];
    const label = typeof r.label === 'string' ? r.label.slice(0, 256) : undefined;
    return label !== undefined ? { type: t, id, label } : { type: t, id };
}

function parseSurface(raw: unknown): AuditSurface | null {
    if (raw == null) return null;
    const s = String(raw);
    if (s === 'discord' || s === 'http' || s === 'cli' || s === 'system' || s === 'dashboard') {
        return s;
    }
    return null;
}

function parseFieldMap(raw: unknown): AuditMeta | null {
    if (raw == null) return null;
    if (typeof raw === 'string') {
        if (raw === '' || raw === 'null') return null;
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const cleaned = sanitizeAuditFields(parsed as Record<string, unknown>);
                return Object.keys(cleaned).length ? cleaned : null;
            }
        } catch {
            return null;
        }
        return null;
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        const cleaned = sanitizeAuditFields(raw as Record<string, unknown>);
        return Object.keys(cleaned).length ? cleaned : null;
    }
    return null;
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

function rowToRecord(row: Record<string, unknown>): AuditRecord {
    let meta: AuditMeta = {};
    const rawMeta = row.meta;
    if (typeof rawMeta === 'string') {
        try {
            const parsed: unknown = JSON.parse(rawMeta);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                meta = sanitizeAuditMeta(parsed as Record<string, unknown>);
            }
        } catch {
            meta = {};
        }
    } else if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
        meta = sanitizeAuditMeta(rawMeta as Record<string, unknown>);
    }
    const actorType = String(row.actorType ?? row.actor_type ?? 'system');
    const outcome = String(row.outcome ?? 'success');
    return {
        id: String(row.id ?? row.key ?? ''),
        actorType: (actorType === 'user' || actorType === 'api_key' || actorType === 'system'
            ? actorType
            : 'system') as AuditRecord['actorType'],
        actorId: String(row.actorId ?? row.actor_id ?? ''),
        action: String(row.action ?? ''),
        target: String(row.target ?? ''),
        outcome: (outcome === 'fail' ? 'fail' : 'success') as AuditRecord['outcome'],
        reason: row.reason == null ? null : String(row.reason),
        meta,
        createdAt: Number(row.createdAt ?? row.created_at ?? 0),
        surface: parseSurface(row.surface),
        requestId:
            row.requestId != null || row.request_id != null
                ? String(row.requestId ?? row.request_id)
                : null,
        targetRef: parseTargetRef(row.targetRef ?? row.target_ref),
        before: parseFieldMap(row.before ?? row.before_json),
        after: parseFieldMap(row.after ?? row.after_json),
    };
}

export async function insertAuditRecord(input: AuditRecordInput): Promise<AuditRecord> {
    const db = getDb();
    const before = input.before ? sanitizeAuditFields(input.before) : null;
    const after = input.after ? sanitizeAuditFields(input.after) : null;
    const targetRef = input.targetRef
        ? parseTargetRef({
              type: input.targetRef.type,
              id: String(input.targetRef.id).slice(0, 256),
              label:
                  typeof input.targetRef.label === 'string'
                      ? input.targetRef.label.slice(0, 256)
                      : undefined,
          })
        : null;
    const surface = input.surface ? parseSurface(input.surface) : null;
    const requestId =
        typeof input.requestId === 'string' && input.requestId.length > 0
            ? input.requestId.slice(0, 128)
            : null;

    const record: AuditRecord = {
        id: newId(),
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        target: input.target,
        outcome: input.outcome,
        reason: input.reason ?? null,
        meta: sanitizeAuditMeta(input.meta),
        createdAt: Math.floor(Date.now() / 1000),
        surface,
        requestId,
        targetRef,
        before: before && Object.keys(before).length ? before : null,
        after: after && Object.keys(after).length ? after : null,
    };

    const data: Record<string, unknown> = {
        key: record.id,
        id: record.id,
        actorType: record.actorType,
        actorId: record.actorId,
        action: record.action,
        target: record.target,
        outcome: record.outcome,
        reason: record.reason,
        meta: record.meta,
        createdAt: record.createdAt,
        surface: record.surface,
        requestId: record.requestId,
        targetRef: record.targetRef,
        before: record.before,
        after: record.after,
    };

    await db.query('UPSERT type::thing($table, $key) CONTENT $data RETURN NONE', {
        table: TABLE,
        key: record.id,
        data,
    });
    return record;
}

export interface AuditListFilter {
    actorId?: string;
    actorType?: string;
    action?: string;
    outcome?: string;
    surface?: string;
    requestId?: string;
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

export async function listAuditRecords(filter: AuditListFilter = {}): Promise<AuditRecord[]> {
    const db = getDb();
    const limit = clampLimit(filter.limit);
    const clauses: string[] = [];
    const vars: Record<string, unknown> = { table: TABLE, limit };

    if (filter.actorId) {
        clauses.push('actorId = $actorId');
        vars.actorId = filter.actorId;
    }
    if (filter.actorType) {
        clauses.push('actorType = $actorType');
        vars.actorType = filter.actorType;
    }
    if (filter.action) {
        clauses.push('action = $action');
        vars.action = filter.action;
    }
    if (filter.outcome) {
        clauses.push('outcome = $outcome');
        vars.outcome = filter.outcome;
    }
    if (filter.surface) {
        clauses.push('surface = $surface');
        vars.surface = filter.surface;
    }
    if (filter.requestId) {
        clauses.push('requestId = $requestId');
        vars.requestId = filter.requestId;
    }
    if (filter.from != null) {
        clauses.push('createdAt >= $from');
        vars.from = filter.from;
    }
    if (filter.to != null) {
        clauses.push('createdAt <= $to');
        vars.to = filter.to;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
        `SELECT * FROM type::table($table) ${where} ORDER BY createdAt DESC LIMIT $limit`,
        vars,
    );
    return unwrapList(result).map(rowToRecord);
}

export async function getAuditRecordById(id: string): Promise<AuditRecord | null> {
    const db = getDb();
    const result = await db.query('SELECT * FROM ONLY type::thing($table, $key)', {
        table: TABLE,
        key: id,
    });
    const row = unwrapOne(result);
    if (!row) return null;
    return rowToRecord(row);
}

export function resetAuditAdapterCache(): void {
    // Surreal client is process-scoped via surrealDB registry; nothing to clear.
}
