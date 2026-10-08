/**
 * Public SDK package version — independent of Zene Core package version.
 */
export const SDK_VERSION = '0.1.0' as const;
export const SDK_COMPAT_RANGE = '^0.1.0' as const;
/** Capability contract generation (Phase 3A surface). Independent of npm package version. */
export const SDK_CONTRACT_VERSION = '3.0.0' as const;
export type SdkVersion = typeof SDK_VERSION;
export type SdkContractVersion = typeof SDK_CONTRACT_VERSION;

export interface SdkCompatibilityInfo {
    readonly packageVersion: SdkVersion;
    readonly contractVersion: SdkContractVersion;
    readonly compatRange: typeof SDK_COMPAT_RANGE;
}

export function getSdkCompatibilityInfo(): SdkCompatibilityInfo {
    return {
        packageVersion: SDK_VERSION,
        contractVersion: SDK_CONTRACT_VERSION,
        compatRange: SDK_COMPAT_RANGE,
    };
}

/**
 * Core hosts use this to reject plugins built against an incompatible SDK contract.
 * `hostContractVersion` is the contract generation the host implements.
 */
export function isSdkContractCompatible(
    hostContractVersion: string,
    pluginContractVersion: string = SDK_CONTRACT_VERSION,
): boolean {
    const hostMajor = Number.parseInt(hostContractVersion.split('.')[0] ?? '', 10);
    const pluginMajor = Number.parseInt(pluginContractVersion.split('.')[0] ?? '', 10);
    if (!Number.isFinite(hostMajor) || !Number.isFinite(pluginMajor)) return false;
    return hostMajor === pluginMajor;
}
