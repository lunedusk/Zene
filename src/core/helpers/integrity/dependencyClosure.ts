/**
 * Phase 2E — Boot-time dependency closure verification (no network repair).
 *
 * Distinguishes: declared | locked | resolved | installed | authorized.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';
import { getAuthenticatedPluginContext } from './authenticatedContext.js';
import {
    assertSourceAuthorized,
    classifyResolvedSource,
} from '#core/helpers/dependency/sourcePolicy.js';

const log = getLogger('DependencyClosure');

export class DependencyClosureError extends Error {
    constructor(
        message: string,
        readonly code:
            | 'LOCKFILE_MISSING'
            | 'LOCKFILE_DIGEST_MISMATCH'
            | 'PACKAGE_MANAGER_MISMATCH'
            | 'DEPENDENCY_SET_MISMATCH'
            | 'PACKAGE_MISSING'
            | 'VERSION_MISMATCH'
            | 'INTEGRITY_MISMATCH'
            | 'SOURCE_REJECTED'
            | 'UNEXPECTED_PACKAGE'
            | 'CLOSURE_INVALID',
    ) {
        super(message);
        this.name = 'DependencyClosureError';
    }
}

async function fileDigest(filePath: string): Promise<string> {
    const buf = await fs.readFile(filePath);
    return createHash('sha256').update(buf).digest('hex');
}

interface NpmLockPackage {
    version?: string;
    resolved?: string;
    integrity?: string;
    link?: boolean;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peer?: boolean;
    optional?: boolean;
    dev?: boolean;
    hasInstallScript?: boolean;
}

interface NpmLockFile {
    lockfileVersion?: number;
    name?: string;
    packages?: Record<string, NpmLockPackage>;
    dependencies?: Record<
        string,
        {
            version?: string;
            resolved?: string;
            integrity?: string;
            dependencies?: Record<string, unknown>;
        }
    >;
}

function packageKeyForName(name: string): string {
    return name.startsWith('@') ? `node_modules/${name}` : `node_modules/${name}`;
}

/**
 * Verify installed/lock closure against authenticated context.
 * Called BEFORE plugin execution. Does NOT perform network install.
 */
export async function verifyDependencyClosure(
    pluginId: string,
    pluginDir: string,
): Promise<void> {
    const ctx = getAuthenticatedPluginContext(pluginId);
    if (!ctx) {
        log.debug(`[${pluginId}] No authenticated context; skip strict closure.`);
        return;
    }

    if (ctx.profile !== 'v2-authenticated' && !ctx.dependencyLock?.lockfileDigest) {
        log.debug(`[${pluginId}] Non-v2 profile without lock digest; no strict closure claim.`);
        return;
    }

    const lock = ctx.dependencyLock;
    if (!lock || lock.packageManager === 'none') {
        return;
    }

    if (lock.packageManager === 'npm') {
        await verifyNpmClosure(pluginId, pluginDir, lock);
        return;
    }

    if (lock.packageManager === 'bun') {
        await verifyBunClosure(pluginId, pluginDir, lock);
        return;
    }

    throw new DependencyClosureError(
        `[${pluginId}] Unsupported authenticated package manager '${String(lock.packageManager)}'.`,
        'PACKAGE_MANAGER_MISMATCH',
    );
}

async function verifyNpmClosure(
    pluginId: string,
    pluginDir: string,
    lock: {
        packageManager: 'npm' | 'bun' | 'none';
        lockfileName?: string;
        lockfileDigest?: string;
        dependencies: Readonly<Record<string, string>>;
    },
): Promise<void> {
    const lockName = lock.lockfileName ?? 'package-lock.json';
    const lockPath = path.join(pluginDir, lockName);
    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    if (!exists) {
        throw new DependencyClosureError(
            `[${pluginId}] Authenticated npm lockfile '${lockName}' missing at boot.`,
            'LOCKFILE_MISSING',
        );
    }

    if (lock.lockfileDigest) {
        const actual = await fileDigest(lockPath);
        if (actual !== lock.lockfileDigest) {
            throw new DependencyClosureError(
                `[${pluginId}] Lockfile digest mismatch for '${lockName}'.`,
                'LOCKFILE_DIGEST_MISMATCH',
            );
        }
    }

    const raw = await fs.readFile(lockPath, 'utf8');
    let parsed: NpmLockFile;
    try {
        parsed = JSON.parse(raw) as NpmLockFile;
    } catch {
        throw new DependencyClosureError(
            `[${pluginId}] Lockfile is not valid JSON.`,
            'CLOSURE_INVALID',
        );
    }

    const declared = Object.keys(lock.dependencies);

    // --- declared vs locked ---
    for (const name of declared) {
        const entry = resolveLockEntry(parsed, name);
        if (!entry) {
            throw new DependencyClosureError(
                `[${pluginId}] Authenticated dependency '${name}' absent from lockfile.`,
                'DEPENDENCY_SET_MISMATCH',
            );
        }

        // Source authorization (host policy)
        try {
            assertSourceAuthorized({
                name,
                version: entry.version,
                resolved: entry.resolved,
                integrity: entry.integrity,
            });
        } catch (err: unknown) {
            throw new DependencyClosureError(
                err instanceof Error ? err.message : String(err),
                'SOURCE_REJECTED',
            );
        }

        // --- locked vs installed ---
        const installedPath = path.join(pluginDir, 'node_modules', ...name.split('/'));
        const pkgJsonPath = path.join(installedPath, 'package.json');
        const installed = await fs.access(pkgJsonPath).then(() => true).catch(() => false);
        if (!installed) {
            const nested = await findNestedPackage(pluginDir, name);
            if (!nested) {
                throw new DependencyClosureError(
                    `[${pluginId}] Required package '${name}' is not installed.`,
                    'PACKAGE_MISSING',
                );
            }
            continue;
        }

        let pkg: { name?: string; version?: string };
        try {
            pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8')) as {
                name?: string;
                version?: string;
            };
        } catch {
            throw new DependencyClosureError(
                `[${pluginId}] Cannot read installed package '${name}'.`,
                'CLOSURE_INVALID',
            );
        }

        if (entry.version && pkg.version && entry.version !== pkg.version) {
            throw new DependencyClosureError(
                `[${pluginId}] Package '${name}' installed version ${pkg.version} != locked ${entry.version}.`,
                'VERSION_MISMATCH',
            );
        }

        // Integrity field present in lock — note on disk we cannot re-hash tarball without cache;
        // we record the requirement that lock integrity must be non-empty for registry packages.
        if (entry.resolved && classifyResolvedSource(entry.resolved) === 'registry') {
            if (!entry.integrity || entry.integrity.length < 8) {
                throw new DependencyClosureError(
                    `[${pluginId}] Lock entry for '${name}' missing integrity field.`,
                    'INTEGRITY_MISMATCH',
                );
            }
        }
    }

    // --- unexpected top-level packages in node_modules (not in lock packages map) ---
    // Only flag when packages map is present (lockfileVersion >= 2)
    if (parsed.packages) {
        const nm = path.join(pluginDir, 'node_modules');
        const nmExists = await fs.access(nm).then(() => true).catch(() => false);
        if (nmExists) {
            const top = await fs.readdir(nm, { withFileTypes: true }).catch(() => []);
            for (const e of top) {
                if (!e.isDirectory() || e.name.startsWith('.')) continue;
                if (e.name.startsWith('@')) {
                    const scoped = await fs.readdir(path.join(nm, e.name), { withFileTypes: true }).catch(() => []);
                    for (const s of scoped) {
                        if (!s.isDirectory()) continue;
                        const full = `${e.name}/${s.name}`;
                        const key = `node_modules/${full}`;
                        if (!(key in parsed.packages!) && !declared.includes(full)) {
                            // Allow transitive packages that appear under packages with nested keys
                            const anyNested = Object.keys(parsed.packages!).some(
                                (k) => k === key || k.endsWith(`/node_modules/${full}`),
                            );
                            if (!anyNested) {
                                log.debug(
                                    `[${pluginId}] Unexpected top-level package '${full}' not in lock packages map`,
                                );
                            }
                        }
                    }
                } else {
                    const key = `node_modules/${e.name}`;
                    if (!(key in parsed.packages!)) {
                        const anyNested = Object.keys(parsed.packages!).some(
                            (k) => k === key || k.endsWith(`/node_modules/${e.name}`),
                        );
                        if (!anyNested && !declared.includes(e.name)) {
                            log.debug(
                                `[${pluginId}] Unexpected top-level package '${e.name}' not in lock packages map`,
                            );
                        }
                    }
                }
            }
        }
    }
}

function resolveLockEntry(
    parsed: NpmLockFile,
    name: string,
): NpmLockPackage | null {
    if (parsed.packages) {
        const key = packageKeyForName(name);
        if (parsed.packages[key]) return parsed.packages[key]!;
        // nested path
        for (const [k, v] of Object.entries(parsed.packages)) {
            if (k === key || k.endsWith(`/node_modules/${name}`)) return v;
        }
    }
    if (parsed.dependencies?.[name]) {
        const d = parsed.dependencies[name]!;
        return {
            version: d.version,
            resolved: d.resolved,
            integrity: d.integrity,
        };
    }
    return null;
}

async function verifyBunClosure(
    pluginId: string,
    pluginDir: string,
    lock: {
        packageManager: 'npm' | 'bun' | 'none';
        lockfileName?: string;
        lockfileDigest?: string;
        dependencies: Readonly<Record<string, string>>;
    },
): Promise<void> {
    const candidates = [lock.lockfileName ?? 'bun.lock', 'bun.lockb', 'bun.lock'];
    let found: string | null = null;
    for (const c of candidates) {
        const p = path.join(pluginDir, c);
        if (await fs.access(p).then(() => true).catch(() => false)) {
            found = p;
            break;
        }
    }
    if (!found) {
        throw new DependencyClosureError(
            `[${pluginId}] Authenticated bun lockfile missing at boot.`,
            'LOCKFILE_MISSING',
        );
    }
    if (lock.lockfileDigest) {
        const actual = await fileDigest(found);
        if (actual !== lock.lockfileDigest) {
            throw new DependencyClosureError(
                `[${pluginId}] Bun lockfile digest mismatch.`,
                'LOCKFILE_DIGEST_MISMATCH',
            );
        }
    }
    for (const name of Object.keys(lock.dependencies)) {
        const pkgJsonPath = path.join(pluginDir, 'node_modules', ...name.split('/'), 'package.json');
        const installed = await fs.access(pkgJsonPath).then(() => true).catch(() => false);
        if (!installed) {
            const nested = await findNestedPackage(pluginDir, name);
            if (!nested) {
                throw new DependencyClosureError(
                    `[${pluginId}] Required package '${name}' is not installed.`,
                    'PACKAGE_MISSING',
                );
            }
        }
    }
}

async function findNestedPackage(pluginDir: string, name: string): Promise<boolean> {
    const nm = path.join(pluginDir, 'node_modules');
    try {
        const entries = await fs.readdir(nm, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            if (e.name === name) {
                const pj = path.join(nm, e.name, 'package.json');
                if (await fs.access(pj).then(() => true).catch(() => false)) return true;
            }
            if (e.name.startsWith('@')) {
                const leaf = name.includes('/') ? name.split('/')[1]! : name;
                const scoped = path.join(nm, e.name, leaf);
                if (await fs.access(path.join(scoped, 'package.json')).then(() => true).catch(() => false)) {
                    return true;
                }
            }
        }
    } catch {
        return false;
    }
    return false;
}

export async function computeLockfileDigest(
    pluginDir: string,
    lockfileName: string,
): Promise<string | undefined> {
    const p = path.join(pluginDir, lockfileName);
    try {
        return await fileDigest(p);
    } catch {
        return undefined;
    }
}
