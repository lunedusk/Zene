/**
 * Phase 2E — Provider binding/lease tied to runtime generation.
 * Stale bindings after runtime terminate cannot be invoked.
 */

import { randomUUID } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('ProviderBinding');

export interface ProviderBindingIdentity {
    readonly bindingId: string;
    readonly pluginId: string;
    readonly providerId: string;
    readonly category: string;
    readonly runtimeId: string;
    readonly generation: number;
}

interface LiveBinding extends ProviderBindingIdentity {
    valid: boolean;
}

const bindings = new Map<string, LiveBinding>();
/** runtimeId → binding keys */
const byRuntime = new Map<string, Set<string>>();
/** pluginId → generation counter */
const generations = new Map<string, number>();

function key(category: string, providerId: string, pluginId: string): string {
    return `${category}::${providerId}::${pluginId}`;
}

export function nextProviderGeneration(pluginId: string): number {
    const g = (generations.get(pluginId) ?? 0) + 1;
    generations.set(pluginId, g);
    return g;
}

export function createProviderBinding(input: {
    pluginId: string;
    providerId: string;
    category: string;
    runtimeId: string;
}): ProviderBindingIdentity {
    const generation = nextProviderGeneration(input.pluginId);
    const bindingId = randomUUID();
    const identity: LiveBinding = {
        bindingId,
        pluginId: input.pluginId,
        providerId: input.providerId,
        category: input.category,
        runtimeId: input.runtimeId,
        generation,
        valid: true,
    };
    const k = key(input.category, input.providerId, input.pluginId);
    bindings.set(k, identity);
    let set = byRuntime.get(input.runtimeId);
    if (!set) {
        set = new Set();
        byRuntime.set(input.runtimeId, set);
    }
    set.add(k);
    log.debug(
        `Binding ${k} runtime=${input.runtimeId} gen=${generation} id=${bindingId}`,
    );
    return identity;
}

export function getProviderBinding(
    category: string,
    providerId: string,
    pluginId: string,
): ProviderBindingIdentity | undefined {
    const b = bindings.get(key(category, providerId, pluginId));
    if (!b || !b.valid) return undefined;
    return b;
}

export function assertProviderBindingUsable(
    category: string,
    providerId: string,
    pluginId: string,
    expectedRuntimeId?: string,
): ProviderBindingIdentity {
    const b = bindings.get(key(category, providerId, pluginId));
    if (!b || !b.valid) {
        throw new Error(
            `Provider binding ${category}/${providerId} for ${pluginId} is invalid or terminated`,
        );
    }
    if (expectedRuntimeId !== undefined && b.runtimeId !== expectedRuntimeId) {
        throw new Error(
            `Provider binding runtime mismatch for ${category}/${providerId}`,
        );
    }
    return b;
}

/** Invalidate all bindings for a runtime (terminate/reload). */
export function invalidateBindingsForRuntime(runtimeId: string): void {
    const set = byRuntime.get(runtimeId);
    if (!set) return;
    for (const k of set) {
        const b = bindings.get(k);
        if (b) {
            b.valid = false;
            log.debug(`Invalidated binding ${k} runtime=${runtimeId}`);
        }
        bindings.delete(k);
    }
    byRuntime.delete(runtimeId);
}

export function invalidateBindingsForPlugin(pluginId: string): void {
    for (const [k, b] of [...bindings.entries()]) {
        if (b.pluginId === pluginId) {
            b.valid = false;
            bindings.delete(k);
            const set = byRuntime.get(b.runtimeId);
            set?.delete(k);
        }
    }
}
