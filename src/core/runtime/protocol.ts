/**
 * Phase 2D — Internal runtime host protocol (not public SDK).
 * Structured-clone only; no functions / live Core objects across the boundary.
 */

export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export interface RuntimeEnvelopeBase {
    readonly v: typeof RUNTIME_PROTOCOL_VERSION;
    readonly runtimeId: string;
    readonly pluginId: string;
    readonly requestId: string;
}

export type BridgeRegisterKind =
    | 'event'
    | 'handler'
    | 'route'
    | 'command'
    | 'interaction'
    | 'provider'
    | 'resource';

export interface HostReadyMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.ready';
    readonly payload: {
        readonly pid: number;
        readonly isMainThread: boolean;
        readonly isolation: 'worker' | 'process';
        readonly setupRan?: boolean;
    };
}

export interface HostLifecycleResultMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.lifecycle.result';
    readonly payload: {
        readonly op: 'setup' | 'enable' | 'disable' | 'unload';
        readonly ok: boolean;
        readonly error?: string;
        readonly evidence?: Readonly<Record<string, string | number | boolean>>;
    };
}

export interface HostIdentityMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.identity';
    readonly payload: {
        readonly pid: number;
        readonly isMainThread: boolean;
        readonly pluginModuleLoaded: boolean;
        readonly envKeys?: readonly string[];
    };
}

export interface HostRegisterMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.register';
    readonly payload: {
        readonly kind: BridgeRegisterKind;
        readonly name: string;
        readonly componentId?: string;
        readonly meta?: Readonly<Record<string, string | number | boolean>>;
    };
}

export interface HostUnregisterMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.unregister';
    readonly payload: {
        readonly kind: BridgeRegisterKind;
        readonly name: string;
        readonly componentId?: string;
    };
}

export interface HostErrorMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.error';
    readonly payload: {
        readonly message: string;
        readonly fatal?: boolean;
        /** startup = establish/init failure; runtime = post-ready failure */
        readonly phase?: 'startup' | 'runtime';
        readonly code?: string;
    };
}

export interface HostPongMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.pong';
    readonly payload: { readonly t: number };
}

export interface HostInvokeResultMessage extends RuntimeEnvelopeBase {
    readonly direction: 'host→core';
    readonly type: 'host.invoke.result';
    readonly payload: {
        readonly ok: boolean;
        readonly result?: unknown;
        readonly error?: string;
    };
}

export type HostToCoreMessage =
    | HostReadyMessage
    | HostLifecycleResultMessage
    | HostIdentityMessage
    | HostRegisterMessage
    | HostUnregisterMessage
    | HostErrorMessage
    | HostPongMessage
    | HostInvokeResultMessage;

export interface CoreInitMessage extends RuntimeEnvelopeBase {
    readonly direction: 'core→host';
    readonly type: 'core.init';
    readonly payload: {
        readonly pluginDir: string;
        readonly entryRelative: string;
        readonly isolation: 'worker' | 'process';
        readonly approvedEnv?: Readonly<Record<string, string>>;
    };
}

export interface CoreLifecycleMessage extends RuntimeEnvelopeBase {
    readonly direction: 'core→host';
    readonly type: 'core.lifecycle';
    readonly payload: {
        readonly op: 'setup' | 'enable' | 'disable' | 'unload';
    };
}

export interface CorePingMessage extends RuntimeEnvelopeBase {
    readonly direction: 'core→host';
    readonly type: 'core.ping';
    readonly payload: { readonly t: number };
}

export interface CoreTerminateMessage extends RuntimeEnvelopeBase {
    readonly direction: 'core→host';
    readonly type: 'core.terminate';
    readonly payload: { readonly reason: string };
}

export interface CoreGetIdentityMessage extends RuntimeEnvelopeBase {
    readonly direction: 'core→host';
    readonly type: 'core.getIdentity';
    readonly payload: Record<string, never>;
}

export interface CoreInvokeMessage extends RuntimeEnvelopeBase {
    readonly direction: 'core→host';
    readonly type: 'core.invoke';
    readonly payload: {
        readonly kind: BridgeRegisterKind;
        readonly name: string;
        readonly args?: unknown;
    };
}

export type CoreToHostMessage =
    | CoreInitMessage
    | CoreLifecycleMessage
    | CorePingMessage
    | CoreTerminateMessage
    | CoreGetIdentityMessage
    | CoreInvokeMessage;

export type RuntimeProtocolMessage = HostToCoreMessage | CoreToHostMessage;

export function isHostToCore(msg: RuntimeProtocolMessage): msg is HostToCoreMessage {
    return (msg as { direction?: string }).direction === 'host→core';
}

export function isCoreToHost(msg: RuntimeProtocolMessage): msg is CoreToHostMessage {
    return (msg as { direction?: string }).direction === 'core→host';
}
