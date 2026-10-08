/**
 * Core-side SDK version mirror.
 * Public package is @lunedusk/zene-sdk@0.1.0 — keep these aligned when releasing.
 */
export const SDK_VERSION = '0.1.0' as const;
export const SDK_COMPAT_RANGE = '^0.1.0' as const;
export const SDK_CONTRACT_VERSION = '3.0.0' as const;
export type SdkVersion = typeof SDK_VERSION;
export type SdkContractVersion = typeof SDK_CONTRACT_VERSION;
