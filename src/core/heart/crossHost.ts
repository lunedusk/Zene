import { getLogger } from '#core/utils/logger.js';

const log = getLogger('Heart:CrossHost');

export type PluginBusHandler = (
    payload: unknown,
    meta: {
        fromMachineId: string;
        channel: string;
        requestId?: string;
        trackingId?: string;
        messageId?: string;
    },
) => unknown | Promise<unknown>;

export type CrossHostBus = {
    isAvailable(): boolean;
    machineId(): string | null;
    peers(): readonly string[];
    send(target: string, channel: string, payload: unknown): Promise<void>;
    request<T = unknown>(
        target: string,
        channel: string,
        payload: unknown,
        timeoutMs?: number,
    ): Promise<T>;
    on(channel: string, handler: PluginBusHandler): void;
    off(channel: string, handler: PluginBusHandler): void;
    shutdownWorker(machineId: string, reason?: string): Promise<void>;
};

const unavailable: CrossHostBus = Object.freeze({
    isAvailable: () => false,
    machineId: () => null,
    peers: () => [],
    async send(): Promise<void> {
        throw new Error(
            'Cross-Host plugin bus is not available (only on Cross-Host workers after control plane start)',
        );
    },
    async request<T = unknown>(): Promise<T> {
        throw new Error(
            'Cross-Host plugin bus is not available (only on Cross-Host workers after control plane start)',
        );
    },
    on(): void {
        log.warn('crossHost.on ignored: bus not available');
    },
    off(): void {},
    async shutdownWorker(): Promise<void> {
        throw new Error('Cross-Host plugin bus is not available');
    },
});

let activeBus: CrossHostBus = unavailable;

export function setCrossHostBus(bus: CrossHostBus | null): void {
    activeBus = bus ?? unavailable;
}

export function getCrossHostBus(): CrossHostBus {
    return activeBus;
}

export type CrossHostDomain = CrossHostBus;

export const crossHostDomain: CrossHostDomain = {
    isAvailable: () => activeBus.isAvailable(),
    machineId: () => activeBus.machineId(),
    peers: () => activeBus.peers(),
    send: (t, c, p) => activeBus.send(t, c, p),
    request<T = unknown>(
        target: string,
        channel: string,
        payload: unknown,
        timeoutMs?: number,
    ): Promise<T> {
        return activeBus.request<T>(target, channel, payload, timeoutMs);
    },
    on: (c, h) => activeBus.on(c, h),
    off: (c, h) => activeBus.off(c, h),
    shutdownWorker: (id, reason) => activeBus.shutdownWorker(id, reason),
};
