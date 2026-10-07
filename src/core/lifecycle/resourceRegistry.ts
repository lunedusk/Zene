/**
 * Phase 2B — Explicit plugin resource ownership.
 *
 * Prefer register-at-creation over global "scan everything for this plugin".
 * Subsystem bulk unregisters (handlers, eventBus, http) remain; this registry
 * covers additional handles (timers, provider regs, custom disposables).
 */

import { getLogger } from '#core/utils/logger.js';
import type {
    CleanupFailure,
    CleanupReport,
    ResourceHandle,
    ResourceKind,
} from './types.js';

const log = getLogger('ResourceRegistry');

let seq = 0;

export class ResourceRegistry {
    readonly #byPlugin = new Map<string, Map<string, ResourceHandle>>();

    track(input: {
        pluginId: string;
        kind: ResourceKind;
        releaseOn: 'disable' | 'unload';
        dispose: () => void | Promise<void>;
        label?: string;
        id?: string;
    }): ResourceHandle {
        const id = input.id ?? `res_${++seq}`;
        const handle: ResourceHandle = {
            id,
            kind: input.kind,
            pluginId: input.pluginId,
            releaseOn: input.releaseOn,
            dispose: input.dispose,
            label: input.label,
        };
        let map = this.#byPlugin.get(input.pluginId);
        if (!map) {
            map = new Map();
            this.#byPlugin.set(input.pluginId, map);
        }
        if (map.has(id)) {
            throw new Error(
                `Resource id '${id}' already tracked for plugin '${input.pluginId}'.`,
            );
        }
        map.set(id, handle);
        log.debug(
            `[${input.pluginId}] tracked ${input.kind} ${id}` +
                (input.label ? ` (${input.label})` : ''),
        );
        return handle;
    }

    untrack(pluginId: string, resourceId: string): boolean {
        const map = this.#byPlugin.get(pluginId);
        if (!map) return false;
        const ok = map.delete(resourceId);
        if (map.size === 0) this.#byPlugin.delete(pluginId);
        return ok;
    }

    list(pluginId: string): readonly ResourceHandle[] {
        const map = this.#byPlugin.get(pluginId);
        return map ? [...map.values()] : [];
    }

    count(pluginId: string): number {
        return this.#byPlugin.get(pluginId)?.size ?? 0;
    }

    /**
     * Dispose resources for a plugin. Continues after individual failures.
     * @param mode disable → releaseOn disable|unload still keeps unload-only;
     *             unload → all remaining handles
     */
    async release(
        pluginId: string,
        mode: 'disable' | 'unload',
    ): Promise<CleanupReport> {
        const map = this.#byPlugin.get(pluginId);
        const failures: CleanupFailure[] = [];
        let attempted = 0;
        let succeeded = 0;

        if (!map || map.size === 0) {
            return { pluginId, attempted: 0, succeeded: 0, failures: [] };
        }

        const toRelease: ResourceHandle[] = [];
        for (const handle of map.values()) {
            if (mode === 'unload' || handle.releaseOn === 'disable') {
                toRelease.push(handle);
            }
        }

        for (const handle of toRelease) {
            attempted++;
            try {
                await handle.dispose();
                map.delete(handle.id);
                succeeded++;
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                failures.push({
                    resourceId: handle.id,
                    kind: handle.kind,
                    message,
                });
                log.warn(
                    `[${pluginId}] cleanup failed for ${handle.kind}/${handle.id}: ${message}`,
                );
            }
        }

        if (map.size === 0) this.#byPlugin.delete(pluginId);

        return {
            pluginId,
            attempted,
            succeeded,
            failures,
        };
    }

    clearAll(): void {
        this.#byPlugin.clear();
    }
}

export const resourceRegistry = new ResourceRegistry();
