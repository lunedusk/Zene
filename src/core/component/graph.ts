/**
 * Phase 2C — Component dependency graph: register, resolve, topological order, cycle detect.
 */

import type {
    ComponentDeclaration,
    ComponentDependency,
    ComponentResolution,
    ComponentResolutionStatus,
} from './types.js';
import { providerRegistry } from '#core/provider/registry.js';

export class ComponentGraph {
    readonly #components = new Map<string, ComponentDeclaration>();
    /** component id → disabled */
    readonly #disabled = new Set<string>();
    /** plugin id → loaded */
    readonly #loadedPlugins = new Set<string>();

    register(decl: ComponentDeclaration): void {
        if (!decl.id.trim()) {
            throw new Error('Component id must be non-empty.');
        }
        this.#components.set(decl.id, decl);
    }

    unregister(componentId: string): boolean {
        this.#disabled.delete(componentId);
        return this.#components.delete(componentId);
    }

    unregisterPlugin(pluginId: string): void {
        for (const [id, decl] of this.#components) {
            if (decl.pluginId === pluginId) {
                this.#components.delete(id);
                this.#disabled.delete(id);
            }
        }
    }

    setPluginLoaded(pluginId: string, loaded: boolean): void {
        if (loaded) this.#loadedPlugins.add(pluginId);
        else this.#loadedPlugins.delete(pluginId);
    }

    setDisabled(componentId: string, disabled: boolean): void {
        if (disabled) this.#disabled.add(componentId);
        else this.#disabled.delete(componentId);
    }

    get(componentId: string): ComponentDeclaration | undefined {
        return this.#components.get(componentId);
    }

    list(pluginId?: string): readonly ComponentDeclaration[] {
        const all = [...this.#components.values()];
        if (pluginId === undefined) return all;
        return all.filter((c) => c.pluginId === pluginId);
    }

    resolve(componentId: string): ComponentResolution {
        const decl = this.#components.get(componentId);
        if (!decl) {
            return {
                componentId,
                status: 'missing',
                reasons: [`component '${componentId}' is not registered`],
            };
        }
        if (this.#disabled.has(componentId)) {
            return {
                componentId,
                status: 'disabled',
                reasons: [`component '${componentId}' is disabled`],
            };
        }

        const visiting = new Set<string>();
        const visited = new Set<string>();
        const order: string[] = [];
        const reasons: string[] = [];

        const visit = (id: string): ComponentResolutionStatus | null => {
            if (visited.has(id)) return null;
            if (visiting.has(id)) {
                reasons.push(`circular dependency involving '${id}'`);
                return 'circular';
            }
            const node = this.#components.get(id);
            if (!node) {
                reasons.push(`missing component '${id}'`);
                return 'missing';
            }
            if (this.#disabled.has(id)) {
                reasons.push(`disabled component '${id}'`);
                return 'disabled';
            }

            visiting.add(id);
            for (const dep of node.dependencies ?? []) {
                const status = this.#checkDep(dep, reasons, visit);
                if (status) {
                    visiting.delete(id);
                    return status;
                }
            }
            visiting.delete(id);
            visited.add(id);
            order.push(id);
            return null;
        };

        const bad = visit(componentId);
        if (bad) {
            return { componentId, status: bad, reasons };
        }
        return {
            componentId,
            status: 'available',
            reasons: [],
            order,
        };
    }

    /**
     * Activation order for a set of components (deps first).
     * Fails if any member is not available.
     */
    activationOrder(componentIds: readonly string[]): ComponentResolution {
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const id of componentIds) {
            const r = this.resolve(id);
            if (r.status !== 'available') return r;
            for (const x of r.order ?? []) {
                if (!seen.has(x)) {
                    seen.add(x);
                    merged.push(x);
                }
            }
        }
        return {
            componentId: componentIds.join(','),
            status: 'available',
            reasons: [],
            order: merged,
        };
    }

    #checkDep(
        dep: ComponentDependency,
        reasons: string[],
        visit: (id: string) => ComponentResolutionStatus | null,
    ): ComponentResolutionStatus | null {
        const required = dep.required !== false;
        if (dep.kind === 'component') {
            const st = visit(dep.id);
            if (st && required) return st;
            if (st && !required) {
                // optional missing — drop that reason if only optional
                return null;
            }
            return null;
        }
        if (dep.kind === 'plugin') {
            if (!this.#loadedPlugins.has(dep.id)) {
                if (required) {
                    reasons.push(`plugin '${dep.id}' not loaded`);
                    return 'missing';
                }
            }
            return null;
        }
        if (dep.kind === 'provider-category') {
            const result = providerRegistry.select(dep.id);
            if (!result.ok) {
                if (required) {
                    reasons.push(
                        `provider category '${dep.id}' unavailable: ${result.message}`,
                    );
                    return result.code === 'none_eligible' ? 'disabled' : 'missing';
                }
            }
            return null;
        }
        reasons.push(`unknown dependency kind`);
        return 'incompatible';
    }

    clear(): void {
        this.#components.clear();
        this.#disabled.clear();
        this.#loadedPlugins.clear();
    }
}

export const componentGraph = new ComponentGraph();
