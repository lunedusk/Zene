export interface RuntimeApiKeyEntry {
    readonly key: string;
    readonly label: string;
    readonly enabled: boolean;
    readonly bits?: readonly string[];
}

export type RuntimeKeyRegistrar = {
    registerRuntimeKey(entry: RuntimeApiKeyEntry): void;
    revokeRuntimeKey(label: string): boolean;
};

let registrar: RuntimeKeyRegistrar | null = null;

/** Called by the api plugin during onSetup once GatewayConfigManager is initialised. */
export function bindGatewayRuntimeKeyRegistrar(next: RuntimeKeyRegistrar | null): void {
    registrar = next;
}

export function getGatewayRuntimeKeyRegistrar(): RuntimeKeyRegistrar | null {
    return registrar;
}
