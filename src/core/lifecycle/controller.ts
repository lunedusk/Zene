/**
 * Phase 2B — Lifecycle phase tracking and transition guards.
 *
 * Complements PluginManager disable/reload; does not replace Discord-resident core.
 */

import { getLogger } from '#core/utils/logger.js';
import type { LifecycleOperation, LifecyclePhase } from './types.js';

const log = getLogger('LifecycleController');

const ENABLE_FROM: ReadonlySet<LifecyclePhase> = new Set(['loaded', 'disabled']);
const LOAD_FROM: ReadonlySet<LifecyclePhase> = new Set(['unloaded', 'failed']);
const DISABLE_FROM: ReadonlySet<LifecyclePhase> = new Set(['enabled']);
const UNLOAD_FROM: ReadonlySet<LifecyclePhase> = new Set([
    'disabled',
    'loaded',
    'failed',
    'enabled',
]);
const RELOAD_FROM: ReadonlySet<LifecyclePhase> = new Set([
    'enabled',
    'disabled',
    'loaded',
    'failed',
    'unloaded',
]);

export class LifecycleController {
    readonly #phase = new Map<string, LifecyclePhase>();

    getPhase(pluginId: string): LifecyclePhase {
        return this.#phase.get(pluginId) ?? 'unloaded';
    }

    setPhase(pluginId: string, phase: LifecyclePhase): void {
        this.#phase.set(pluginId, phase);
        log.debug(`[${pluginId}] lifecycle → ${phase}`);
    }

    clear(pluginId: string): void {
        this.#phase.delete(pluginId);
    }

    /**
     * Whether the operation should perform work (false = already satisfied / noop).
     */
    shouldRun(pluginId: string, op: LifecycleOperation): boolean {
        const current = this.getPhase(pluginId);
        switch (op) {
            case 'enable':
                if (current === 'enabled') return false;
                return ENABLE_FROM.has(current);
            case 'disable':
                if (current === 'disabled' || current === 'unloaded') return false;
                return DISABLE_FROM.has(current);
            case 'load':
                if (current === 'loaded' || current === 'enabled') return false;
                return LOAD_FROM.has(current);
            case 'unload':
                if (current === 'unloaded') return false;
                return UNLOAD_FROM.has(current);
            case 'reload':
                return RELOAD_FROM.has(current);
            default:
                return false;
        }
    }

    assertCan(pluginId: string, op: LifecycleOperation): void {
        const current = this.getPhase(pluginId);
        const alreadyDone =
            (op === 'enable' && current === 'enabled') ||
            (op === 'disable' && (current === 'disabled' || current === 'unloaded')) ||
            (op === 'load' && (current === 'loaded' || current === 'enabled')) ||
            (op === 'unload' && current === 'unloaded');
        if (alreadyDone) return;
        if (!this.shouldRun(pluginId, op)) {
            throw new Error(
                `Lifecycle: cannot ${op} plugin '${pluginId}' from phase '${current}'.`,
            );
        }
    }
}

export const lifecycleController = new LifecycleController();
