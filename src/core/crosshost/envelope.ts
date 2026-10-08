/**
 * Typed cross-boundary envelope for Core ↔ runtime ↔ dashboard ↔ cross-host.
 */

export const CROSSHOST_ENVELOPE_VERSION = 1 as const;

export interface CrossHostEnvelopeBase {
    readonly v: typeof CROSSHOST_ENVELOPE_VERSION;
    readonly requestId: string;
    readonly correlationId?: string;
    readonly pluginId?: string;
    readonly runtimeId?: string;
    readonly generation?: number;
    readonly componentId?: string;
    readonly timeoutMs?: number;
    readonly trackingId?: string;
}

export interface CrossHostRequest extends CrossHostEnvelopeBase {
    readonly direction: 'request';
    readonly type: string;
    readonly payload: unknown;
}

export interface CrossHostResponse extends CrossHostEnvelopeBase {
    readonly direction: 'response';
    readonly type: string;
    readonly ok: boolean;
    readonly payload?: unknown;
    readonly error?: {
        readonly code: string;
        readonly message: string;
    };
}

export type CrossHostEnvelope = CrossHostRequest | CrossHostResponse;

export class CrossHostValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CrossHostValidationError';
    }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const AUTHORITY_FIELDS = [
    'trustOutcome',
    'signerFingerprint',
    'authorization',
    'securityFloor',
    'providerAuthorization',
    'permissions',
] as const;

export function validateCrossHostEnvelope(raw: unknown): CrossHostEnvelope {
    if (!isPlainObject(raw)) {
        throw new CrossHostValidationError('Envelope must be an object');
    }
    if (raw.v !== CROSSHOST_ENVELOPE_VERSION) {
        throw new CrossHostValidationError(`Unsupported envelope version ${String(raw.v)}`);
    }
    if (typeof raw.requestId !== 'string' || raw.requestId.length === 0) {
        throw new CrossHostValidationError('requestId required');
    }
    if (raw.direction !== 'request' && raw.direction !== 'response') {
        throw new CrossHostValidationError('direction must be request|response');
    }
    if (typeof raw.type !== 'string' || raw.type.length === 0) {
        throw new CrossHostValidationError('type required');
    }
    for (const f of AUTHORITY_FIELDS) {
        if (f in raw) {
            throw new CrossHostValidationError(
                `Envelope must not carry authority field '${f}'`,
            );
        }
        if (isPlainObject(raw.payload) && f in raw.payload) {
            throw new CrossHostValidationError(
                `Envelope payload must not carry authority field '${f}'`,
            );
        }
    }
    if (raw.direction === 'request') {
        return {
            v: CROSSHOST_ENVELOPE_VERSION,
            direction: 'request',
            requestId: raw.requestId,
            correlationId:
                typeof raw.correlationId === 'string' ? raw.correlationId : undefined,
            pluginId: typeof raw.pluginId === 'string' ? raw.pluginId : undefined,
            runtimeId: typeof raw.runtimeId === 'string' ? raw.runtimeId : undefined,
            generation: typeof raw.generation === 'number' ? raw.generation : undefined,
            componentId:
                typeof raw.componentId === 'string' ? raw.componentId : undefined,
            timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : undefined,
            trackingId: typeof raw.trackingId === 'string' ? raw.trackingId : undefined,
            type: raw.type,
            payload: raw.payload,
        };
    }
    return {
        v: CROSSHOST_ENVELOPE_VERSION,
        direction: 'response',
        requestId: raw.requestId,
        correlationId:
            typeof raw.correlationId === 'string' ? raw.correlationId : undefined,
        pluginId: typeof raw.pluginId === 'string' ? raw.pluginId : undefined,
        runtimeId: typeof raw.runtimeId === 'string' ? raw.runtimeId : undefined,
        generation: typeof raw.generation === 'number' ? raw.generation : undefined,
        componentId: typeof raw.componentId === 'string' ? raw.componentId : undefined,
        trackingId: typeof raw.trackingId === 'string' ? raw.trackingId : undefined,
        type: raw.type,
        ok: raw.ok === true,
        payload: raw.payload,
        error: isPlainObject(raw.error)
            ? {
                  code: String(raw.error.code ?? 'ERROR'),
                  message: String(raw.error.message ?? 'error'),
              }
            : undefined,
    };
}

export function assertGenerationMatch(
    envelope: CrossHostEnvelope,
    expected: { runtimeId: string; generation: number },
): void {
    if (envelope.runtimeId && envelope.runtimeId !== expected.runtimeId) {
        throw new CrossHostValidationError(
            `Stale runtimeId: got ${envelope.runtimeId}, expected ${expected.runtimeId}`,
        );
    }
    if (
        envelope.generation !== undefined &&
        envelope.generation !== expected.generation
    ) {
        throw new CrossHostValidationError(
            `Stale generation: got ${envelope.generation}, expected ${expected.generation}`,
        );
    }
}
