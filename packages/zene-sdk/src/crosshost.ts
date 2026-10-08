import { assertBridgeAuthorized, type SdkBridge, type SdkCrossHostHandler } from './bridge.js';
import { SdkError } from './types.js';

export type { SdkCrossHostMeta, SdkCrossHostHandler, SdkBridgeCrossHost } from './bridge.js';

function unavailable(op: string): never {
    throw new SdkError({
        code: 'CROSSHOST_UNAVAILABLE',
        message: `CrossHost is not available (${op})`,
        details: { operation: op },
    });
}

export function crossHostIsAvailable(bridge: SdkBridge): boolean {
    assertBridgeAuthorized(bridge, 'crossHost.isAvailable');
    return bridge.crossHost.isAvailable();
}

export function crossHostMachineId(bridge: SdkBridge): string | null {
    assertBridgeAuthorized(bridge, 'crossHost.machineId');
    return bridge.crossHost.machineId();
}

export function crossHostPeers(bridge: SdkBridge): readonly string[] {
    assertBridgeAuthorized(bridge, 'crossHost.peers');
    return bridge.crossHost.peers();
}

export async function crossHostSend(
    bridge: SdkBridge,
    options: {
        target: string;
        channel: string;
        payload: unknown;
        trackingId?: string;
    },
): Promise<void> {
    assertBridgeAuthorized(bridge, 'crossHost.send');
    if (!bridge.crossHost.isAvailable()) unavailable('send');
    try {
        await bridge.crossHost.send(options);
    } catch (err) {
        if (err instanceof SdkError) throw err;
        throw new SdkError({
            code: 'CROSSHOST_TRANSPORT',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function crossHostRequest<T = unknown>(
    bridge: SdkBridge,
    options: {
        target: string;
        channel: string;
        payload: unknown;
        timeoutMs?: number;
        trackingId?: string;
    },
): Promise<T> {
    assertBridgeAuthorized(bridge, 'crossHost.request');
    if (!bridge.crossHost.isAvailable()) unavailable('request');
    try {
        return await bridge.crossHost.request<T>(options);
    } catch (err) {
        if (err instanceof SdkError) throw err;
        throw new SdkError({
            code: 'CROSSHOST_TRANSPORT',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

export function crossHostOn(
    bridge: SdkBridge,
    channel: string,
    handler: SdkCrossHostHandler,
): () => void {
    assertBridgeAuthorized(bridge, 'crossHost.on');
    if (!bridge.crossHost.isAvailable()) unavailable('on');
    return bridge.crossHost.on(channel, handler);
}

export function crossHostOff(
    bridge: SdkBridge,
    channel: string,
    handler?: SdkCrossHostHandler,
): void {
    assertBridgeAuthorized(bridge, 'crossHost.off');
    bridge.crossHost.off(channel, handler);
}
