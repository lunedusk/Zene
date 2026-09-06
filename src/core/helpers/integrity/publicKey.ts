export const BUILTIN_PUBLIC_KEY =
    'MCowBQYDK2VwAyEAxGjGVv/sK86Px3N7hLY1x1QxS5bugvrqPlo8MW95BwQ=';

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
    return (pluginId && (pluginKeys[pluginId] || pluginKeys['*'])) ||
        process.env.PublicKey?.trim() ||
        BUILTIN_PUBLIC_KEY;
}