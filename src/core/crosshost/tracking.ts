import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const TRACKING_ID_HEADER = 'X-Tracking-ID';
export const MAX_TRACKING_ID_LENGTH = 128;
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TrackingContext {
    readonly trackingId: string;
    readonly requestId?: string;
    readonly pluginId?: string;
    readonly runtimeId?: string;
    readonly generation?: number;
    readonly machineId?: string;
}

const trackingAls = new AsyncLocalStorage<TrackingContext>();

export function isValidTrackingId(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_TRACKING_ID_LENGTH &&
        UUID_RE.test(value)
    );
}

export function generateTrackingId(): string {
    return randomUUID();
}

export function resolveTrackingId(supplied?: string): string {
    if (supplied === undefined || supplied === '') {
        return generateTrackingId();
    }
    if (!isValidTrackingId(supplied)) {
        return generateTrackingId();
    }
    return supplied;
}

export function getTrackingContext(): TrackingContext | undefined {
    return trackingAls.getStore();
}

export function runWithTrackingContext<T>(
    ctx: TrackingContext,
    fn: () => T,
): T {
    return trackingAls.run(ctx, fn);
}

export async function runWithTrackingContextAsync<T>(
    ctx: TrackingContext,
    fn: () => Promise<T>,
): Promise<T> {
    return trackingAls.run(ctx, fn);
}

export function parseTrackingIdFromHeaders(
    headers: Record<string, string | string[] | undefined>,
): string | undefined {
    const raw = headers[TRACKING_ID_HEADER] ?? headers['x-tracking-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (isValidTrackingId(value)) return value;
    return undefined;
}
