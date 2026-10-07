/**
 * Phase 2E — Active dependents block disable / unload / reload of a dependency.
 * No silent cascade. ComponentGraph is the dependency source.
 */

import { componentGraph } from '#core/component/graph.js';
import type { LifecycleOperation } from './types.js';

export interface DependencyBlockResult {
    readonly blocked: true;
    readonly pluginId: string;
    readonly operation: LifecycleOperation;
    readonly activeDependents: readonly string[];
    readonly message: string;
}

export interface DependencyAllowResult {
    readonly blocked: false;
    readonly pluginId: string;
    readonly operation: LifecycleOperation;
}

export type DependencyGuardResult = DependencyBlockResult | DependencyAllowResult;

/**
 * Plugins that list `pluginId` as a dependency and are currently loaded/enabled.
 */
export function findActiveDependents(pluginId: string): string[] {
    const dependents: string[] = [];
    // Component graph: components of other plugins depending on this plugin
    for (const decl of componentGraph.list()) {
        if (decl.pluginId === pluginId) continue;
        // Phase 2C: dependencies is optional — missing means none (same as ComponentGraph).
        const deps = decl.dependencies ?? [];
        for (const dep of deps) {
            if (dep.kind === 'plugin' && dep.id === pluginId) {
                if (componentGraph.resolve(decl.id).status === 'available') {
                    dependents.push(decl.pluginId);
                }
            }
        }
    }
    return [...new Set(dependents)];
}

/**
 * Guard disable/unload/reload when active dependents exist.
 */
export function guardDependentOperation(
    pluginId: string,
    operation: LifecycleOperation,
): DependencyGuardResult {
    if (operation !== 'disable' && operation !== 'unload' && operation !== 'reload') {
        return { blocked: false, pluginId, operation };
    }
    const active = findActiveDependents(pluginId);
    if (active.length === 0) {
        return { blocked: false, pluginId, operation };
    }
    return {
        blocked: true,
        pluginId,
        operation,
        activeDependents: active,
        message:
            `Cannot ${operation} plugin '${pluginId}': active dependents require it: ` +
            active.join(', '),
    };
}

export function assertNoActiveDependents(
    pluginId: string,
    operation: LifecycleOperation,
): void {
    const result = guardDependentOperation(pluginId, operation);
    if (result.blocked) {
        throw new Error(result.message);
    }
}
