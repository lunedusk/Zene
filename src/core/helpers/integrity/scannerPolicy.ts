/**
 * Phase 2E — Integrity scanner security rules.
 */

import path from 'node:path';

/** Exact self-referential artifact names excluded from integrity (not prefix match). */
export const INTEGRITY_SELF_EXCLUDE_NAMES = new Set([
    'manifest.nvx',
    'manifest.json',
    'manifest.json5',
]);

/** Executable extensions that MUST participate in integrity (ignoreHash forbidden). */
export const EXECUTABLE_INTEGRITY_EXTENSIONS = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.mts',
    '.cts',
    '.wasm',
    '.node',
]);

/** Paths that can never be ignoreHash-exempt. */
export const CRITICAL_INTEGRITY_BASENAMES = new Set([
    'package.json',
    'package-lock.json',
    'bun.lock',
    'bun.lockb',
    'yarn.lock',
    'pnpm-lock.yaml',
    'manifest.nvx',
    'manifest.json',
    'index.js',
    'index.mjs',
    'index.cjs',
]);

const PRIVATE_KEY_MARKERS = [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
];

export function isSelfReferentialIntegrityFile(relPath: string): boolean {
    const base = path.posix.basename(relPath.replace(/\\/g, '/'));
    return INTEGRITY_SELF_EXCLUDE_NAMES.has(base);
}

export function isExecutableIntegrityPath(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    const base = path.posix.basename(normalized);
    const ext = path.posix.extname(base).toLowerCase();
    if (EXECUTABLE_INTEGRITY_EXTENSIONS.has(ext)) return true;
    if (CRITICAL_INTEGRITY_BASENAMES.has(base)) return true;
    if (normalized.startsWith('dist/') && ext === '.js') return true;
    return false;
}

/**
 * Returns true if ignoreHash path is forbidden (security-critical).
 */
export function isIgnoreHashForbidden(relPath: string): boolean {
    return isExecutableIntegrityPath(relPath) || isSelfReferentialIntegrityFile(relPath);
}

export function validateIgnoreHashList(
    ignoreHash: readonly string[],
): { ok: true } | { ok: false; path: string; reason: string } {
    for (const p of ignoreHash) {
        if (isIgnoreHashForbidden(p)) {
            return {
                ok: false,
                path: p,
                reason: `ignoreHash cannot exempt security-critical path '${p}'`,
            };
        }
    }
    return { ok: true };
}

/** Detect private key PEM material (not public certificates). */
export function looksLikePrivateKeyMaterial(content: string): boolean {
    for (const marker of PRIVATE_KEY_MARKERS) {
        if (content.includes(marker)) return true;
    }
    return false;
}

/** Public certs use BEGIN CERTIFICATE / BEGIN PUBLIC KEY — not private. */
export function looksLikePublicCertificate(content: string): boolean {
    return (
        content.includes('-----BEGIN CERTIFICATE-----') ||
        content.includes('-----BEGIN PUBLIC KEY-----')
    );
}
