/**
 * Opaque HTTP router handle — framework-specific routers are provided by the host adapter.
 * The public SDK never depends on Express or other HTTP frameworks.
 */
export type SdkHttpRouterHandle = object;

export interface SdkBridgeHttp {
    registerRouter(basePath: string, router: SdkHttpRouterHandle): void;
    unregisterRouter(basePath: string): void;
    listMounts(): readonly string[];
}
