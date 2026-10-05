



export type PluginTrustState =
    | 'trusted'
    | 'untrusted'
    | 'invalid'
    | 'incompatible'
    | 'disabled'
    | 'quarantined';

export interface PluginIntegrityInput {
    readonly pluginId: string;
    readonly pluginVersion: string;
    readonly zeneVersion: string;
    readonly sdkVersion: string;
    readonly requiredSdkRange?: string;
    readonly manifestHash?: string;
    readonly expectedManifestHash?: string;





    readonly signatureValid?: boolean;
    readonly disabled?: boolean;
    readonly quarantined?: boolean;
}

export interface PluginIntegrityResult {
    readonly state: PluginTrustState;
    readonly acceptContributions: boolean;
    readonly reasons: readonly string[];
}

function semverMajor(v: string): string {
    return (v.replace(/^v/, '').split('.')[0] ?? '0') || '0';
}






export function evaluatePluginIntegrity(input: PluginIntegrityInput): PluginIntegrityResult {
    const reasons: string[] = [];

    if (input.quarantined) {
        return { state: 'quarantined', acceptContributions: false, reasons: ['quarantined'] };
    }
    if (input.disabled) {
        return { state: 'disabled', acceptContributions: false, reasons: ['disabled'] };
    }
    if (!input.pluginId || !input.pluginVersion) {
        return { state: 'invalid', acceptContributions: false, reasons: ['missing_identity'] };
    }
    if (
        typeof input.expectedManifestHash === 'string' &&
        typeof input.manifestHash === 'string' &&
        input.manifestHash !== input.expectedManifestHash
    ) {
        reasons.push('manifest_hash_mismatch');
        return { state: 'invalid', acceptContributions: false, reasons };
    }
    if (input.signatureValid === false) {
        reasons.push('signature_invalid');
        return { state: 'untrusted', acceptContributions: false, reasons };
    }
    if (input.requiredSdkRange) {
        const reqMaj = semverMajor(input.requiredSdkRange);
        const haveMaj = semverMajor(input.sdkVersion);
        if (reqMaj !== haveMaj) {
            reasons.push('sdk_incompatible');
            return { state: 'incompatible', acceptContributions: false, reasons };
        }
    }
    if (!input.zeneVersion) {
        reasons.push('zene_version_missing');
        return { state: 'incompatible', acceptContributions: false, reasons };
    }


    if (input.signatureValid === true) {
        return { state: 'trusted', acceptContributions: true, reasons };
    }



    reasons.push('signature_not_evaluated');
    return { state: 'untrusted', acceptContributions: true, reasons };
}


export function filterContributionsByIntegrity<T>(
    integrity: PluginIntegrityResult,
    contributions: readonly T[],
): readonly T[] {
    if (!integrity.acceptContributions) return [];
    return contributions;
}
