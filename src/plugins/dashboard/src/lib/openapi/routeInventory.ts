/**
 * Phase 4 — Deterministic Dashboard OpenAPI surface inventory + validation.
 * Routes register via JSDoc; this inventory is the contract checklist and structural validator.
 */

export type OpenApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpenApiRouteEntry {
    readonly method: OpenApiMethod;
    readonly path: string;
    readonly tag: string;
    readonly auth: 'none' | 'session' | 'session_or_sudo';
    readonly summary: string;
}

/** Authoritative inventory of Phase 1–4 Dashboard public API surface. */
export const DASHBOARD_OPENAPI_INVENTORY: readonly OpenApiRouteEntry[] = [
    { method: 'get', path: '/api/dash/auth/resolve', tag: 'DashboardAuth', auth: 'none', summary: 'Resolve Discord OAuth' },
    { method: 'get', path: '/api/dash/auth/permissions', tag: 'DashboardAuth', auth: 'session', summary: 'Permission bits' },
    { method: 'get', path: '/api/dash/auth/session-check', tag: 'DashboardAuth', auth: 'session', summary: 'Session check' },
    { method: 'get', path: '/api/dash/account/sessions', tag: 'DashboardAccount', auth: 'session', summary: 'List sessions' },
    { method: 'delete', path: '/api/dash/account/sessions/{sessionId}', tag: 'DashboardAccount', auth: 'session', summary: 'Revoke session' },
    { method: 'delete', path: '/api/dash/account/sessions/others', tag: 'DashboardAccount', auth: 'session', summary: 'Revoke others' },
    { method: 'get', path: '/api/dash/account/devices', tag: 'DashboardAccount', auth: 'session', summary: 'List devices' },
    { method: 'get', path: '/api/dash/account/mfa', tag: 'DashboardAccount', auth: 'session', summary: 'MFA status' },
    { method: 'post', path: '/api/dash/account/mfa/totp/begin', tag: 'DashboardAccount', auth: 'session', summary: 'TOTP begin' },
    { method: 'post', path: '/api/dash/account/mfa/totp/confirm', tag: 'DashboardAccount', auth: 'session', summary: 'TOTP confirm' },
    { method: 'post', path: '/api/dash/account/mfa/disable', tag: 'DashboardAccount', auth: 'session', summary: 'MFA disable' },
    { method: 'get', path: '/api/dash/account/passkeys', tag: 'DashboardAccount', auth: 'session', summary: 'List passkeys' },
    { method: 'post', path: '/api/dash/account/passkeys/register/begin', tag: 'DashboardAccount', auth: 'session', summary: 'Passkey begin' },
    { method: 'post', path: '/api/dash/account/passkeys/register/complete', tag: 'DashboardAccount', auth: 'session', summary: 'Passkey complete' },
    { method: 'get', path: '/api/dash/account/login-history', tag: 'DashboardAccount', auth: 'session', summary: 'Login history' },
    { method: 'get', path: '/api/dash/search', tag: 'DashboardSearch', auth: 'session', summary: 'Authorized search' },
    { method: 'get', path: '/api/dash/jobs', tag: 'DashboardJobs', auth: 'session', summary: 'List jobs' },
    { method: 'post', path: '/api/dash/jobs', tag: 'DashboardJobs', auth: 'session', summary: 'Create job' },
    { method: 'get', path: '/api/dash/data-rights', tag: 'DashboardDataRights', auth: 'session', summary: 'Data rights requests' },
    { method: 'post', path: '/api/dash/data-rights', tag: 'DashboardDataRights', auth: 'session', summary: 'Create data rights request' },
    { method: 'get', path: '/api/dash/registry', tag: 'DashboardRegistry', auth: 'session', summary: 'Registry projection' },
    { method: 'get', path: '/api/dash/events/sse', tag: 'DashboardRealtime', auth: 'session', summary: 'SSE stream' },
] as const;

export interface OpenApiValidationResult {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly routeCount: number;
}

/**
 * Structural validation of the inventory (paths, methods, auth tags).
 * Fails if inventory is empty, duplicates exist, or paths violate conventions.
 */
export function validateOpenApiInventory(
    inventory: readonly OpenApiRouteEntry[] = DASHBOARD_OPENAPI_INVENTORY,
): OpenApiValidationResult {
    const errors: string[] = [];
    if (inventory.length === 0) errors.push('inventory_empty');
    const seen = new Set<string>();
    for (const r of inventory) {
        const key = `${r.method}:${r.path}`;
        if (seen.has(key)) errors.push(`duplicate:${key}`);
        seen.add(key);
        if (!r.path.startsWith('/api/dash/')) errors.push(`path_prefix:${r.path}`);
        if (!r.summary.trim()) errors.push(`missing_summary:${key}`);
        if (!r.tag.trim()) errors.push(`missing_tag:${key}`);
    }
    const requiredTags = ['DashboardAuth', 'DashboardAccount', 'DashboardSearch', 'DashboardJobs', 'DashboardDataRights', 'DashboardRegistry', 'DashboardRealtime'];
    for (const t of requiredTags) {
        if (!inventory.some((r) => r.tag === t)) errors.push(`missing_tag_group:${t}`);
    }
    return { ok: errors.length === 0, errors, routeCount: inventory.length };
}

/** Minimal OpenAPI 3.0 document derived from inventory (deterministic). */
export function buildOpenApiDocument(
    inventory: readonly OpenApiRouteEntry[] = DASHBOARD_OPENAPI_INVENTORY,
): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of inventory) {
        const pathItem = paths[r.path] ?? {};
        pathItem[r.method] = {
            tags: [r.tag],
            summary: r.summary,
            security: r.auth === 'none' ? [] : [{ bearerAuth: [] }],
            responses: {
                '200': { description: 'OK' },
                '401': { description: 'Unauthorized' },
                '403': { description: 'Forbidden' },
                '404': { description: 'Not found' },
            },
        };
        paths[r.path] = pathItem;
    }
    return {
        openapi: '3.0.3',
        info: { title: 'Zene Dashboard API', version: '1.0.0' },
        paths,
        components: {
            securitySchemes: {
                bearerAuth: { type: 'http', scheme: 'bearer' },
            },
        },
    };
}
