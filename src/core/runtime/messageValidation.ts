/**
 * Strict validation of host→core messages.
 * Constructs typed discriminated-union members after field validation — no unchecked casts.
 */

import {
    RUNTIME_PROTOCOL_VERSION,
    type BridgeRegisterKind,
    type HostToCoreMessage,
    type HostReadyMessage,
    type HostLifecycleResultMessage,
    type HostIdentityMessage,
    type HostRegisterMessage,
    type HostUnregisterMessage,
    type HostErrorMessage,
    type HostPongMessage,
    type HostInvokeResultMessage,
} from './protocol.js';

export class ProtocolValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProtocolValidationError';
    }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
    const v = obj[key];
    if (typeof v !== 'string' || v.length === 0) {
        throw new ProtocolValidationError(`Missing or invalid string field '${key}'`);
    }
    return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
    const v = obj[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ProtocolValidationError(`Missing or invalid number field '${key}'`);
    }
    return v;
}

function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
    const v = obj[key];
    if (typeof v !== 'boolean') {
        throw new ProtocolValidationError(`Missing or invalid boolean field '${key}'`);
    }
    return v;
}

function rejectAuthorityClaims(payload: Record<string, unknown>, ctx: string): void {
    const forbidden = [
        'trustOutcome',
        'authorization',
        'signerFingerprint',
        'signerIdentity',
        'authenticatedPolicy',
        'securityFloor',
        'providerAuthorization',
        'runtimeAuthorization',
        'privileged',
        'minimumIsolation',
        'requiredCapabilities',
        'permission',
        'permissions',
    ] as const;
    for (const f of forbidden) {
        if (Object.prototype.hasOwnProperty.call(payload, f)) {
            throw new ProtocolValidationError(
                `${ctx} must not claim Core authority field '${f}'`,
            );
        }
    }
}

function narrowBridgeKind(kind: string): BridgeRegisterKind {
    switch (kind) {
        case 'event':
        case 'handler':
        case 'route':
        case 'command':
        case 'interaction':
        case 'provider':
        case 'resource':
            return kind;
        default:
            throw new ProtocolValidationError(`Invalid bridge kind: ${kind}`);
    }
}

function narrowIsolation(
    isolation: string,
): HostReadyMessage['payload']['isolation'] {
    switch (isolation) {
        case 'in-process':
        case 'worker':
        case 'process':
        case 'container':
        case 'external':
            return isolation;
        default:
            throw new ProtocolValidationError(
                `host.ready.isolation invalid: ${isolation}`,
            );
    }
}

function narrowLifecycleOp(
    op: string,
): HostLifecycleResultMessage['payload']['op'] {
    switch (op) {
        case 'setup':
        case 'enable':
        case 'disable':
        case 'unload':
            return op;
        default:
            throw new ProtocolValidationError(
                `host.lifecycle.result.op invalid: ${op}`,
            );
    }
}

function narrowErrorPhase(
    phase: string,
): 'startup' | 'runtime' {
    switch (phase) {
        case 'startup':
        case 'runtime':
            return phase;
        default:
            throw new ProtocolValidationError(
                `host.error.phase invalid: ${phase}`,
            );
    }
}

function parseStringNumberBooleanRecord(
    value: unknown,
    fieldName: string,
): Readonly<Record<string, string | number | boolean>> {
    if (!isPlainObject(value)) {
        throw new ProtocolValidationError(`${fieldName} must be an object`);
    }
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            out[k] = v;
        } else {
            throw new ProtocolValidationError(
                `${fieldName}.${k} must be string | number | boolean`,
            );
        }
    }
    return out;
}

function baseEnvelope(raw: Record<string, unknown>): {
    readonly v: typeof RUNTIME_PROTOCOL_VERSION;
    readonly runtimeId: string;
    readonly pluginId: string;
    readonly requestId: string;
} {
    if (raw.v !== RUNTIME_PROTOCOL_VERSION) {
        throw new ProtocolValidationError(
            `Unsupported protocol version: ${String(raw.v)}`,
        );
    }
    if (raw.direction !== 'host→core') {
        throw new ProtocolValidationError(
            `Invalid direction: ${String(raw.direction)}`,
        );
    }
    return {
        v: RUNTIME_PROTOCOL_VERSION,
        runtimeId: requireString(raw, 'runtimeId'),
        pluginId: requireString(raw, 'pluginId'),
        requestId: requireString(raw, 'requestId'),
    };
}

/**
 * Validate untrusted inbound host message and return a constructed HostToCoreMessage.
 * No unchecked casts — each variant is built after exhaustive field validation.
 */
export function validateHostToCoreMessage(raw: unknown): HostToCoreMessage {
    if (!isPlainObject(raw)) {
        throw new ProtocolValidationError('Message must be a plain object');
    }
    const envelope = baseEnvelope(raw);
    const type = requireString(raw, 'type');
    if (!isPlainObject(raw.payload)) {
        throw new ProtocolValidationError('payload must be an object');
    }
    const payload = raw.payload;
    rejectAuthorityClaims(payload, type);

    switch (type) {
        case 'host.ready': {
            const isolation = narrowIsolation(requireString(payload, 'isolation'));
            if (typeof payload.setupRan === 'boolean') {
                const msg: HostReadyMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.ready',
                    payload: {
                        pid: requireNumber(payload, 'pid'),
                        isMainThread: requireBoolean(payload, 'isMainThread'),
                        isolation,
                        setupRan: payload.setupRan,
                    },
                };
                return msg;
            }
            const msg: HostReadyMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.ready',
                payload: {
                    pid: requireNumber(payload, 'pid'),
                    isMainThread: requireBoolean(payload, 'isMainThread'),
                    isolation,
                },
            };
            return msg;
        }
        case 'host.lifecycle.result': {
            const op = narrowLifecycleOp(requireString(payload, 'op'));
            const ok = requireBoolean(payload, 'ok');
            if (typeof payload.error === 'string' && isPlainObject(payload.evidence)) {
                const msg: HostLifecycleResultMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.lifecycle.result',
                    payload: {
                        op,
                        ok,
                        error: payload.error,
                        evidence: parseStringNumberBooleanRecord(
                            payload.evidence,
                            'host.lifecycle.result.evidence',
                        ),
                    },
                };
                return msg;
            }
            if (typeof payload.error === 'string') {
                const msg: HostLifecycleResultMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.lifecycle.result',
                    payload: { op, ok, error: payload.error },
                };
                return msg;
            }
            if (isPlainObject(payload.evidence)) {
                const msg: HostLifecycleResultMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.lifecycle.result',
                    payload: {
                        op,
                        ok,
                        evidence: parseStringNumberBooleanRecord(
                            payload.evidence,
                            'host.lifecycle.result.evidence',
                        ),
                    },
                };
                return msg;
            }
            const msg: HostLifecycleResultMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.lifecycle.result',
                payload: { op, ok },
            };
            return msg;
        }
        case 'host.identity': {
            if (Array.isArray(payload.envKeys)) {
                const envKeys = payload.envKeys.filter(
                    (k): k is string => typeof k === 'string',
                );
                const msg: HostIdentityMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.identity',
                    payload: {
                        pid: requireNumber(payload, 'pid'),
                        isMainThread: requireBoolean(payload, 'isMainThread'),
                        pluginModuleLoaded: requireBoolean(
                            payload,
                            'pluginModuleLoaded',
                        ),
                        envKeys,
                    },
                };
                return msg;
            }
            const msg: HostIdentityMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.identity',
                payload: {
                    pid: requireNumber(payload, 'pid'),
                    isMainThread: requireBoolean(payload, 'isMainThread'),
                    pluginModuleLoaded: requireBoolean(
                        payload,
                        'pluginModuleLoaded',
                    ),
                },
            };
            return msg;
        }
        case 'host.register': {
            const kind = narrowBridgeKind(requireString(payload, 'kind'));
            const name = requireString(payload, 'name');
            if (typeof payload.componentId === 'string' && isPlainObject(payload.meta)) {
                const msg: HostRegisterMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.register',
                    payload: {
                        kind,
                        name,
                        componentId: payload.componentId,
                        meta: parseStringNumberBooleanRecord(
                            payload.meta,
                            'host.register.meta',
                        ),
                    },
                };
                return msg;
            }
            if (typeof payload.componentId === 'string') {
                const msg: HostRegisterMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.register',
                    payload: { kind, name, componentId: payload.componentId },
                };
                return msg;
            }
            if (isPlainObject(payload.meta)) {
                const msg: HostRegisterMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.register',
                    payload: {
                        kind,
                        name,
                        meta: parseStringNumberBooleanRecord(
                            payload.meta,
                            'host.register.meta',
                        ),
                    },
                };
                return msg;
            }
            const msg: HostRegisterMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.register',
                payload: { kind, name },
            };
            return msg;
        }
        case 'host.unregister': {
            const kind = narrowBridgeKind(requireString(payload, 'kind'));
            const name = requireString(payload, 'name');
            if (typeof payload.componentId === 'string') {
                const msg: HostUnregisterMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.unregister',
                    payload: { kind, name, componentId: payload.componentId },
                };
                return msg;
            }
            const msg: HostUnregisterMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.unregister',
                payload: { kind, name },
            };
            return msg;
        }
        case 'host.error': {
            const message = requireString(payload, 'message');
            if (typeof payload.fatal === 'boolean' && typeof payload.phase === 'string') {
                const msg: HostErrorMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.error',
                    payload: {
                        message,
                        fatal: payload.fatal,
                        phase: narrowErrorPhase(payload.phase),
                    },
                };
                return msg;
            }
            if (typeof payload.fatal === 'boolean') {
                const msg: HostErrorMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.error',
                    payload: { message, fatal: payload.fatal },
                };
                return msg;
            }
            if (typeof payload.phase === 'string') {
                const msg: HostErrorMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.error',
                    payload: {
                        message,
                        phase: narrowErrorPhase(payload.phase),
                    },
                };
                return msg;
            }
            const msg: HostErrorMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.error',
                payload: { message },
            };
            return msg;
        }
        case 'host.pong': {
            const msg: HostPongMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.pong',
                payload: {
                    t:
                        typeof payload.t === 'number' && Number.isFinite(payload.t)
                            ? payload.t
                            : Date.now(),
                },
            };
            return msg;
        }
        case 'host.invoke.result': {
            const ok = requireBoolean(payload, 'ok');
            if (typeof payload.error === 'string' && payload.result !== undefined) {
                const msg: HostInvokeResultMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.invoke.result',
                    payload: { ok, error: payload.error, result: payload.result },
                };
                return msg;
            }
            if (typeof payload.error === 'string') {
                const msg: HostInvokeResultMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.invoke.result',
                    payload: { ok, error: payload.error },
                };
                return msg;
            }
            if (payload.result !== undefined) {
                const msg: HostInvokeResultMessage = {
                    v: envelope.v,
                    runtimeId: envelope.runtimeId,
                    pluginId: envelope.pluginId,
                    requestId: envelope.requestId,
                    direction: 'host→core',
                    type: 'host.invoke.result',
                    payload: { ok, result: payload.result },
                };
                return msg;
            }
            const msg: HostInvokeResultMessage = {
                v: envelope.v,
                runtimeId: envelope.runtimeId,
                pluginId: envelope.pluginId,
                requestId: envelope.requestId,
                direction: 'host→core',
                type: 'host.invoke.result',
                payload: { ok },
            };
            return msg;
        }
        default:
            throw new ProtocolValidationError(`Unknown host message type: ${type}`);
    }
}

export function assertResponseCorrelation(input: {
    expectedRuntimeId: string;
    expectedPluginId: string;
    expectedRequestId: string;
    message: HostToCoreMessage;
}): void {
    if (input.message.runtimeId !== input.expectedRuntimeId) {
        throw new ProtocolValidationError(
            `Stale/mismatched runtimeId: got ${input.message.runtimeId}, expected ${input.expectedRuntimeId}`,
        );
    }
    if (input.message.pluginId !== input.expectedPluginId) {
        throw new ProtocolValidationError(
            `Mismatched pluginId on response: ${input.message.pluginId}`,
        );
    }
    if (input.message.requestId !== input.expectedRequestId) {
        throw new ProtocolValidationError(
            `Mismatched requestId: got ${input.message.requestId}, expected ${input.expectedRequestId}`,
        );
    }
}
