import { BUILTIN_PUBLIC_KEY } from '#core/defaults.js';
import {
    classifySignerKeySource,
    type SignerKeySource,
} from './trustDecision.js';

export { BUILTIN_PUBLIC_KEY };

function readPluginPublicKeys(): Record<string, string> {
    const raw = process.env.PluginPublicKeys;
    if (!raw?.trim()) return {};

    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

        const keys: Record<string, string> = {};
        for (const [pluginId, publicKey] of Object.entries(parsed)) {
            if (pluginId.trim() && typeof publicKey === 'string' && publicKey.trim()) {
                keys[pluginId.trim()] = publicKey.trim();
            }
        }
        return keys;
    } catch {
        return {};
    }
}

export function resolvePluginPublicKey(pluginId?: string): string {
    const pluginKeys = readPluginPublicKeys();
    return (
        (pluginId && (pluginKeys[pluginId] || pluginKeys['*'])) ||
        process.env.PublicKey?.trim() ||
        BUILTIN_PUBLIC_KEY
    );
}

/** Resolve key and classify source for Phase 1C trust diagnostics. */
export function resolvePluginPublicKeyWithSource(pluginId?: string): {
    readonly key: string;
    readonly source: SignerKeySource;
} {
    const pluginKeys = readPluginPublicKeys();
    const key = resolvePluginPublicKey(pluginId);
    const source = classifySignerKeySource(
        pluginId,
        pluginKeys,
        process.env.PublicKey,
        BUILTIN_PUBLIC_KEY,
        key,
    );
    return { key, source };
}
