const LOGICAL_CHANNEL_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

const RESERVED_LOGICAL_PREFIXES = [
    'control',
    'zene',
    'crosshost',
    'dashboard',
    'orchestrator',
    'fleet',
] as const;

export function isValidLogicalChannel(channel: string): boolean {
    return LOGICAL_CHANNEL_RE.test(channel);
}

export function isReservedLogicalChannel(channel: string): boolean {
    const lower = channel.toLowerCase();
    for (const prefix of RESERVED_LOGICAL_PREFIXES) {
        if (lower === prefix || lower.startsWith(`${prefix}.`) || lower.startsWith(`${prefix}:`)) {
            return true;
        }
    }
    return false;
}

export function physicalPluginChannel(pluginId: string, logicalChannel: string): string {
    return `plugin:${pluginId}:${logicalChannel}`;
}

export function parsePhysicalPluginChannel(
    physical: string,
): { pluginId: string; logicalChannel: string } | null {
    if (!physical.startsWith('plugin:')) return null;
    const rest = physical.slice('plugin:'.length);
    const idx = rest.indexOf(':');
    if (idx <= 0 || idx === rest.length - 1) return null;
    return {
        pluginId: rest.slice(0, idx),
        logicalChannel: rest.slice(idx + 1),
    };
}

export function assertSdkLogicalChannel(channel: string): void {
    if (!isValidLogicalChannel(channel)) {
        throw Object.assign(new Error(`Invalid CrossHost channel: ${channel}`), {
            code: 'CROSSHOST_CHANNEL_INVALID',
        });
    }
    if (isReservedLogicalChannel(channel)) {
        throw Object.assign(new Error(`Reserved CrossHost channel: ${channel}`), {
            code: 'CROSSHOST_CHANNEL_DENIED',
        });
    }
}
