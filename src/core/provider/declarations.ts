/**
 * Phase 2E — Authenticated provider declaration registry (from signed metadata).
 * Runtime registration must match these claims.
 */

export interface AuthenticatedProviderDeclaration {
    readonly category: string;
    readonly id: string;
    readonly priority: number;
    readonly capabilities: readonly string[];
    readonly contractVersion?: string;
}

/** pluginId → declarations */
const byPlugin = new Map<string, readonly AuthenticatedProviderDeclaration[]>();

export function setAuthenticatedProviderDeclarations(
    pluginId: string,
    decls: readonly AuthenticatedProviderDeclaration[],
): void {
    byPlugin.set(pluginId, decls.map((d) => ({ ...d, capabilities: [...d.capabilities] })));
}

export function getAuthenticatedProviderDeclarations(
    pluginId: string,
): readonly AuthenticatedProviderDeclaration[] | undefined {
    return byPlugin.get(pluginId);
}

export function clearAuthenticatedProviderDeclarations(pluginId: string): void {
    byPlugin.delete(pluginId);
}

/**
 * Validate a runtime registration against authenticated declarations.
 * Plugins with no authenticated declarations: only non-privileged categories allowed under bypass.
 */
export function assertProviderRegistrationAllowed(input: {
    pluginId: string;
    category: string;
    id: string;
    priority: number;
    trustOutcome: 'trusted' | 'bypassed' | 'rejected' | 'unknown-signer' | 'untrusted';
}): void {
    const decls = byPlugin.get(input.pluginId);
    if (decls === undefined) {
        // No authenticated declaration set recorded (legacy / pre-signed metadata).
        // Privileged categories always denied without an explicit declaration entry.
        if (input.category.startsWith('core.') || input.category === 'dependency.install') {
            throw new Error(
                `Plugin ${input.pluginId} cannot register privileged provider ${input.category}/${input.id} without authenticated declaration`,
            );
        }
        if (input.trustOutcome === 'bypassed' || input.trustOutcome === 'untrusted') {
            // Bypassed may only register non-privileged categories
            return;
        }
        // Trusted without recorded declarations: allow non-privileged until signed metadata is present
        return;
    }
    if (decls.length === 0) {
        throw new Error(
            `Plugin ${input.pluginId} has empty authenticated provider set; cannot register ${input.category}/${input.id}`,
        );
    }
    const match = decls.find((d) => d.category === input.category && d.id === input.id);
    if (!match) {
        throw new Error(
            `Undeclared provider ${input.category}/${input.id} for plugin ${input.pluginId}`,
        );
    }
    if (match.priority !== input.priority) {
        throw new Error(
            `Provider priority mismatch for ${input.category}/${input.id}: ` +
                `signed=${match.priority} runtime=${input.priority}`,
        );
    }
}
