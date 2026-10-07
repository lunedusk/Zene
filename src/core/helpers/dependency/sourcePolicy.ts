/**
 * Phase 2E — Dependency source authorization (host policy).
 *
 * A signed lock authenticates what the plugin requested.
 * Host policy decides which resolved sources are permitted.
 */

export type DependencySourceKind =
    | 'registry'
    | 'http'
    | 'https'
    | 'git'
    | 'file'
    | 'link'
    | 'workspace'
    | 'unknown';

export interface ResolvedPackageSource {
    readonly name: string;
    readonly version?: string;
    readonly resolved?: string;
    readonly integrity?: string;
}

const DEFAULT_ALLOWED_KINDS = new Set<DependencySourceKind>(['registry']);

const allowedRegistryHosts = new Set<string>(['registry.npmjs.org']);

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

export function getDefaultRegistry(): string {
    return DEFAULT_REGISTRY;
}

export function allowRegistryHost(host: string): void {
    allowedRegistryHosts.add(host.toLowerCase());
}

export function clearAllowedRegistryHosts(): void {
    allowedRegistryHosts.clear();
    allowedRegistryHosts.add('registry.npmjs.org');
}

export function listAllowedRegistryHosts(): readonly string[] {
    return [...allowedRegistryHosts].sort();
}

export function classifyResolvedSource(resolved: string | undefined): DependencySourceKind {
    if (!resolved || resolved.length === 0) return 'unknown';
    const r = resolved.trim().toLowerCase();
    if (r.startsWith('git+') || r.startsWith('git://') || r.includes('github.com:') || r.endsWith('.git')) {
        return 'git';
    }
    if (r.startsWith('file:') || r.startsWith('/') || r.startsWith('./') || r.startsWith('../')) {
        return 'file';
    }
    if (r.startsWith('link:')) return 'link';
    if (r.startsWith('workspace:')) return 'workspace';
    if (r.startsWith('http://')) return 'http';
    if (r.startsWith('https://')) {
        try {
            const u = new URL(resolved);
            if (u.username || u.password) return 'https';
            if (allowedRegistryHosts.has(u.hostname.toLowerCase())) {
                return 'registry';
            }
            return 'https';
        } catch {
            return 'https';
        }
    }
    if (r.includes('registry.npmjs.org')) return 'registry';
    return 'unknown';
}

/**
 * Host policy over a resolved lock entry.
 * Rejects userinfo in URL, non-HTTPS, non-approved hosts, unexpected ports.
 */
export function assertSourceAuthorized(pkg: ResolvedPackageSource): void {
    const kind = classifyResolvedSource(pkg.resolved);
    if (!DEFAULT_ALLOWED_KINDS.has(kind)) {
        throw new Error(
            `Dependency source policy rejected '${pkg.name}' resolved=${pkg.resolved ?? '(none)'} kind=${kind}`,
        );
    }
    if (!pkg.resolved) {
        throw new Error(`Dependency '${pkg.name}' has no resolved URL in lock.`);
    }
    let u: URL;
    try {
        u = new URL(pkg.resolved);
    } catch {
        throw new Error(`Dependency '${pkg.name}' has invalid resolved URL.`);
    }
    if (u.protocol !== 'https:') {
        throw new Error(`Dependency '${pkg.name}' must use https resolved URL.`);
    }
    if (u.username || u.password) {
        throw new Error(`Dependency '${pkg.name}' resolved URL must not embed credentials.`);
    }
    // Default port only (443 implicit) or explicit 443
    if (u.port && u.port !== '443') {
        throw new Error(`Dependency '${pkg.name}' resolved URL uses unexpected port ${u.port}.`);
    }
    if (!allowedRegistryHosts.has(u.hostname.toLowerCase())) {
        throw new Error(
            `Dependency '${pkg.name}' registry host '${u.hostname}' is not on the Core allowlist.`,
        );
    }
}
