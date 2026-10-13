import type { ZodError } from 'zod';
import { parseDocument } from './parse.js';
import type {
    RulesValidateFn,
    ValidationContext,
    ValidationIssue,
    ValidationResult
} from './types.js';

export type AnyZodSchema = {
     
    safeParse: (data: unknown) => {
        success: boolean;
        data?: unknown;
        error?: ZodError | { issues: Array<{ path?: PropertyKey[]; message: string }> };
    };
};

function zodToIssues(err: {
    issues: Array<{ path?: PropertyKey[]; message: string }>;
}): ValidationIssue[] {
    return err.issues.map(i => {
        const pathParts = (i.path ?? [])
            .filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
            .map(String);
        return {
            code: 'schema' as const,
            message: i.message,
            path: pathParts.length ? pathParts.join('.') : undefined
        };
    });
}

async function runRules(
    data: unknown,
    ctx: ValidationContext,
    rules: RulesValidateFn | null | undefined
): Promise<ValidationIssue[]> {
    if (!rules) return [];
    try {
        const out = await rules(data, ctx);
        if (out === true || out === undefined) return [];
        if (out === false) return [{ code: 'rules', message: 'Rules validation failed' }];
        if (typeof out === 'string') return [{ code: 'rules', message: out }];
        if (Array.isArray(out)) {
            return out.map(m => ({ code: 'rules' as const, message: String(m) }));
        }
        return [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return [{ code: 'rules', message: `Rules threw: ${msg}` }];
    }
}

export async function validateValue<T = unknown>(
    data: unknown,
    ctx: ValidationContext,
    schema?: AnyZodSchema | null,
    rules?: RulesValidateFn | null
): Promise<ValidationResult<T>> {
    let current: unknown = data;

    if (schema) {
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
            const err = parsed.error ?? { issues: [{ message: 'Schema validation failed' }] };
            return { ok: false, data, issues: zodToIssues(err) };
        }
        current = parsed.data;
    }

    const ruleIssues = await runRules(current, ctx, rules);
    if (ruleIssues.length) {
        return { ok: false, data: current, issues: ruleIssues };
    }
    return { ok: true, data: current as T, issues: [] };
}

export async function validateRawString<T = unknown>(
    raw: string,
    ctx: ValidationContext,
    schema?: AnyZodSchema | null,
    rules?: RulesValidateFn | null
): Promise<ValidationResult<T>> {
    const parsed = parseDocument(raw, ctx.filePath);
    if (!parsed.ok) return { ok: false, issues: parsed.issues };
    return validateValue<T>(parsed.data, ctx, schema, rules);
}

export function formatIssues(issues: ValidationIssue[]): string {
    return issues
        .map(i => (i.path ? `[${i.code}] ${i.path}: ${i.message}` : `[${i.code}] ${i.message}`))
        .join('; ');
}
