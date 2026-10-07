import fs from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { hashFile } from '#core/helpers/hash/index.js';
import type { FileMetadata } from './types.js';
import {
    isSelfReferentialIntegrityFile,
    isIgnoreHashForbidden,
    looksLikePrivateKeyMaterial,
} from './scannerPolicy.js';

const log = getLogger('IntegrityScanner');

export class IntegrityScannerError extends Error {
    constructor(
        message: string,
        readonly code:
            | 'SYMLINK_REJECTED'
            | 'SECRET_MATERIAL'
            | 'IGNORE_HASH_FORBIDDEN'
            | 'SCAN_FAILED',
        readonly filePath?: string,
    ) {
        super(message);
        this.name = 'IntegrityScannerError';
    }
}

export class IntegrityScanner {
    static readonly #EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.data', 'logs', 'configuration']);
    static readonly #EXCLUDE_EXTENSIONS = new Set(['.log', '.tmp', '.map', '.env', '.bin', '.nc']);
    static readonly #DATA_CODE_SUBDIRS = new Set(['schema', 'rules']);
    static readonly #MAX_CONCURRENCY = 50;

    public static async runConcurrently(tasks: (() => Promise<void>)[]): Promise<void> {
        const executing = new Set<Promise<void>>();
        for (const task of tasks) {
            const p = task().finally(() => executing.delete(p));
            executing.add(p);
            if (executing.size >= this.#MAX_CONCURRENCY) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);
    }

    public static async calculateFileStats(filePath: string): Promise<FileMetadata> {
        const { hash, size } = await hashFile(filePath);
        return { hash, size };
    }

    static #isUnderData(relPath: string): boolean {
        return relPath === 'data' || relPath.startsWith('data/') || relPath.includes('/data/');
    }

    static #dataCodeAllowed(relPath: string, isDirectory: boolean): boolean {
        if (!this.#isUnderData(relPath)) return true;
        const parts = relPath.split('/');
        const dataIdx = parts.indexOf('data');
        if (dataIdx === -1) return true;
        if (parts.length === dataIdx + 1) {
            return isDirectory;
        }
        const sub = parts[dataIdx + 1];
        return this.#DATA_CODE_SUBDIRS.has(sub);
    }

    /**
     * Discover integrity-relevant files.
     * Symlinks → reject (do not follow).
     * Self-referential manifests → exact basename exclusion only.
     * ignoreHash of executable paths → reject.
     */
    public static async *discoverFiles(
        dir: string,
        root = dir,
        ignoreHash: ReadonlySet<string> = new Set(),
    ): AsyncGenerator<{ fullPath: string; relPath: string }> {
        // Validate ignoreHash up front
        for (const p of ignoreHash) {
            if (isIgnoreHashForbidden(p)) {
                throw new IntegrityScannerError(
                    `ignoreHash cannot exempt security-critical path '${p}'`,
                    'IGNORE_HASH_FORBIDDEN',
                    p,
                );
            }
        }

        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);

            if (entry.isSymbolicLink()) {
                throw new IntegrityScannerError(
                    `Symbolic link rejected in artifact tree: ${path.relative(root, res)}`,
                    'SYMLINK_REJECTED',
                    res,
                );
            }

            const relPath = path.relative(root, res).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                if (this.#EXCLUDE_DIRS.has(entry.name)) continue;
                if (!this.#dataCodeAllowed(relPath, true)) continue;
                yield* this.discoverFiles(res, root, ignoreHash);
            } else {
                const base = entry.name;
                const ext = path.extname(base);

                // Exact self-referential exclusion — NOT startsWith('manifest')
                if (isSelfReferentialIntegrityFile(relPath)) {
                    continue;
                }

                if (
                    this.#EXCLUDE_EXTENSIONS.has(ext) ||
                    this.#EXCLUDE_EXTENSIONS.has(base)
                ) {
                    continue;
                }
                if (!this.#dataCodeAllowed(relPath, false)) continue;
                if (ignoreHash.has(relPath)) continue;

                // Secret material must not be hashed-as-if-shipped; reject presence
                if (
                    ext === '.pem' ||
                    ext === '.key' ||
                    base.endsWith('.private.pem') ||
                    base === 'private.key'
                ) {
                    try {
                        const sample = await fs.readFile(res, 'utf8');
                        if (looksLikePrivateKeyMaterial(sample)) {
                            throw new IntegrityScannerError(
                                `Private key material must not ship in artifact: ${relPath}`,
                                'SECRET_MATERIAL',
                                res,
                            );
                        }
                    } catch (err: unknown) {
                        if (err instanceof IntegrityScannerError) throw err;
                        // binary read failure — skip content check for non-utf8
                    }
                }

                yield { fullPath: res, relPath };
            }
        }
    }
}
