



import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DASHBOARD_OPENAPI_INVENTORY, validateOpenApiInventory } from './routeInventory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GenerateOpenApiResult {
    readonly ok: boolean;
    readonly spec: Record<string, unknown>;
    readonly errors: readonly string[];
    readonly pathCount: number;
    readonly inventoryOk: boolean;
}

/**
 * Scan Dashboard route sources for @openapi annotations and build a validated spec.
 */
export async function generateDashboardOpenApiSpec(): Promise<GenerateOpenApiResult> {
    const inventory = validateOpenApiInventory();
    const errors: string[] = [...inventory.errors];

    let swaggerJsdoc: (opts: Record<string, unknown>) => Record<string, unknown>;
    try {
        const mod = await import('swagger-jsdoc');
        swaggerJsdoc = (mod.default ?? mod) as typeof swaggerJsdoc;
    } catch {
        return {
            ok: false,
            spec: {},
            errors: ['swagger-jsdoc_unavailable'],
            pathCount: 0,
            inventoryOk: inventory.ok,
        };
    }

    const routesDir = path.join(__dirname, '..', '..', 'routes');
    const spec = swaggerJsdoc({
        definition: {
            openapi: '3.0.3',
            info: {
                title: 'Zene Dashboard API',
                version: '1.2.0',
                description: 'Dashboard HTTP surface (Phase 1–4)',
            },
            components: {
                securitySchemes: {
                    bearerAuth: { type: 'http', scheme: 'bearer' },
                },
            },
        },
        apis: [
            path.join(routesDir, '*.ts'),
            path.join(routesDir, '*.js'),
        ],
    }) as Record<string, unknown>;

    const paths = (spec.paths ?? {}) as Record<string, unknown>;
    const pathCount = Object.keys(paths).length;


    for (const entry of DASHBOARD_OPENAPI_INVENTORY) {
        const pathItem = paths[entry.path] as Record<string, unknown> | undefined;
        if (!pathItem) {

            errors.push(`generated_missing_path:${entry.method}:${entry.path}`);
        } else if (!pathItem[entry.method]) {
            errors.push(`generated_missing_method:${entry.method}:${entry.path}`);
        }
    }


    if (pathCount === 0) errors.push('generated_paths_empty');
    if (spec.openapi !== '3.0.3' && spec.openapi !== '3.1.0') {
        errors.push(`openapi_version:${String(spec.openapi)}`);
    }


    const hardErrors = errors.filter(
        (e) =>
            e === 'generated_paths_empty' ||
            e === 'swagger-jsdoc_unavailable' ||
            e.startsWith('openapi_version') ||
            e.startsWith('inventory_') ||
            e.startsWith('duplicate:') ||
            e.startsWith('path_prefix:') ||
            e.startsWith('missing_tag_group:'),
    );

    return {
        ok: hardErrors.length === 0 && inventory.ok,
        spec,
        errors,
        pathCount,
        inventoryOk: inventory.ok,
    };
}
