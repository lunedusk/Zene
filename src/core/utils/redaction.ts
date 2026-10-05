const SENSITIVE_KEY_PATTERN = /(pass(word|code)?|token|secret|api[-_ ]?key|authorization|auth|cookie|session|credential|bearer|private[-_ ]?key|refresh[-_ ]?token|access[-_ ]?token|client[-_ ]?secret)/i;

const KEY_VALUE_PATTERN = /(api[-_ ]?key|token|secret|password|authorization|cookie|session|credential|bearer|private[-_ ]?key|refresh[-_ ]?token|access[-_ ]?token|client[-_ ]?secret)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function sanitizeString(value: string): string {
    let output = value;
    output = output.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
    output = output.replace(JWT_PATTERN, '[REDACTED]');
    output = output.replace(KEY_VALUE_PATTERN, (_match, label: string) => `${label}: [REDACTED]`);
    return output;
}

function redactNode(value: unknown, seen: WeakMap<object, unknown>): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
        return sanitizeString(value);
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (seen.has(value)) {
        return seen.get(value);
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (value instanceof RegExp) {
        return new RegExp(value.source, value.flags);
    }

    if (value instanceof Error) {
        const errorShape: Record<string, unknown> = {
            name: value.name,
            message: sanitizeString(value.message),
            stack: value.stack ? sanitizeString(value.stack) : undefined,
        };
        seen.set(value, errorShape);
        const errorValue = value as unknown as Record<string, unknown>;

        if ('cause' in value) {
            errorShape.cause = redactNode((value as Error & { cause?: unknown }).cause, seen);
        }

        for (const key of Object.keys(value)) {
            if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
            errorShape[key] = redactNode(errorValue[key], seen);
        }

        return errorShape;
    }

    if (Array.isArray(value)) {
        const redactedArray: unknown[] = [];
        seen.set(value, redactedArray);
        for (const item of value) {
            redactedArray.push(redactNode(item, seen));
        }
        return redactedArray;
    }

    if (value instanceof Map) {
        const redactedMap = new Map();
        seen.set(value, redactedMap);
        for (const [key, mapValue] of value.entries()) {
            redactedMap.set(redactNode(key, seen), redactNode(mapValue, seen));
        }
        return redactedMap;
    }

    if (value instanceof Set) {
        const redactedSet = new Set();
        seen.set(value, redactedSet);
        for (const item of value.values()) {
            redactedSet.add(redactNode(item, seen));
        }
        return redactedSet;
    }

    const prototype = Object.getPrototypeOf(value);
    const clone: Record<string, unknown> = prototype === Object.prototype || prototype === null ? {} : Object.create(prototype);
    seen.set(value, clone);

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {


        if (SENSITIVE_KEY_PATTERN.test(key)) {
            clone[key] = '[REDACTED]';
            continue;
        }

        clone[key] = redactNode(item, seen);
    }

    return clone;
}

export function redactSensitiveData<T>(value: T): T {
    return redactNode(value, new WeakMap()) as T;
}