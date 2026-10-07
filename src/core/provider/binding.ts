/**
 * Provider binding identity — generation-scoped, runtime-scoped.
 * Invalidating R1 must never invalidate R2 bindings under the same provider key.
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
    valid: boolean;
}

type LiveBinding = ProviderBindingIdentity;

/** Primary index: category/providerId/pluginId → current live binding (latest). */
const bindings = new Map<string, LiveBinding>();
/** runtimeId → set of bindingIds owned by that runtime. */
const byRuntime = new Map<string, Set<string>>();
/** bindingId → LiveBinding */
const byBindingId = new Map<string, LiveBinding>();

const generationByPlugin = new Map<string, number>();

function key(category: string, providerId: string, pluginId: string): string {
    return `${category}::${providerId}::${pluginId}`;
}

function nextProviderGeneration(pluginId: string): number {
    const n = (generationByPlugin.get(pluginId) ?? 0) + 1;
    generationByPlugin.set(pluginId, n);
    return n;
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
    // Previous binding for same key stays in byBindingId until its runtime is terminated
    bindings.set(k, identity);
    byBindingId.set(bindingId, identity);
    let set = byRuntime.get(input.runtimeId);
    if (!set) {
        set = new Set();
        byRuntime.set(input.runtimeId, set);
    }
    set.add(bindingId);
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

/** Invalidate all bindings whose stored runtimeId === runtimeId (R1 only). */
export function invalidateBindingsForRuntime(runtimeId: string): void {
    const set = byRuntime.get(runtimeId);
    if (!set) return;
    for (const bindingId of set) {
        const b = byBindingId.get(bindingId);
        if (!b) continue;
        if (b.runtimeId !== runtimeId) continue; // defensive
        b.valid = false;
        byBindingId.delete(bindingId);
        const k = key(b.category, b.providerId, b.pluginId);
        const current = bindings.get(k);
        // Only remove primary index entry if it still points at this binding
        if (current && current.bindingId === bindingId) {
            bindings.delete(k);
        }
        log.debug(`Invalidated binding ${bindingId} runtime=${runtimeId}`);
    }
    byRuntime.delete(runtimeId);
}

export function invalidateBindingsForPlugin(pluginId: string): void {
    for (const [bindingId, b] of [...byBindingId.entries()]) {
        if (b.pluginId !== pluginId) continue;
        b.valid = false;
        byBindingId.delete(bindingId);
        const k = key(b.category, b.providerId, b.pluginId);
        const current = bindings.get(k);
        if (current && current.bindingId === bindingId) {
            bindings.delete(k);
        }
        const set = byRuntime.get(b.runtimeId);
        set?.delete(bindingId);
    }
}
