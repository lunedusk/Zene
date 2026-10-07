/**
 * Phase 2E — Install-script authorization policy.
 *
 * Default: deny. Host grants bind to pluginId + signerFingerprint + packageName + exactVersion.
 */

export type InstallScriptDecision = 'deny' | 'allow';

export interface InstallScriptPolicyInput {
    readonly pluginId: string;
    readonly packageName?: string;
    readonly exactVersion?: string;
    readonly signerFingerprint?: string;
    readonly trustProfile: 'v2-authenticated' | 'legacy-signed' | 'bypassed-unsigned' | 'unknown';
}

export interface InstallScriptGrant {
    readonly pluginId: string;
    readonly packageName: string;
    readonly exactVersion: string;
    readonly signerFingerprint: string;
}

function grantKey(g: InstallScriptGrant): string {
    return `${g.pluginId}\0${g.signerFingerprint}\0${g.packageName}\0${g.exactVersion}`;
}

const grants = new Set<string>();

export function allowInstallScriptsForPackage(grant: InstallScriptGrant): void {
    grants.add(grantKey(grant));
}

export function clearInstallScriptAllows(): void {
    grants.clear();
}

export function evaluateInstallScriptPolicy(
    input: InstallScriptPolicyInput,
): InstallScriptDecision {
    if (input.trustProfile !== 'v2-authenticated') {
        return 'deny';
    }
    if (!input.packageName || !input.exactVersion || !input.signerFingerprint) {
        return 'deny';
    }
    const key = grantKey({
        pluginId: input.pluginId,
        packageName: input.packageName,
        exactVersion: input.exactVersion,
        signerFingerprint: input.signerFingerprint,
    });
    return grants.has(key) ? 'allow' : 'deny';
}

export function mustIgnoreInstallScripts(input: {
    pluginId: string;
    packages: readonly { name: string; exactVersion?: string }[];
    trustProfile: InstallScriptPolicyInput['trustProfile'];
    signerFingerprint?: string;
}): boolean {
    if (input.packages.length === 0) return true;
    if (input.trustProfile !== 'v2-authenticated') return true;
    if (!input.signerFingerprint) return true;

    for (const pkg of input.packages) {
        if (
            evaluateInstallScriptPolicy({
                pluginId: input.pluginId,
                packageName: pkg.name,
                exactVersion: pkg.exactVersion,
                signerFingerprint: input.signerFingerprint,
                trustProfile: input.trustProfile,
            }) === 'deny'
        ) {
            return true;
        }
    }
    return false;
}
