/**
 * Verified artifact materialization — TOCTOU-resistant execution snapshot.
 *
 * mutable pluginDir
 *   → verified integrity tree / artifactDigest
 *   → materialize byte-identical tree under Core-controlled cache
 *   → verify materialization against authenticated digests
 *   → runtime executes ONLY materialized path
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HASH_ALGORITHM } from './constants.js';
import { realpathSync, existsSync, lstatSync } from 'node:fs';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('ArtifactMaterialization');

export interface IntegrityFileSpec {
    readonly path: string;
    readonly digest: string;
    readonly size: number;
}

export interface MaterializationRequest {
    readonly pluginId: string;
    readonly sourceDir: string;
    /** Authenticated integrity root (from signed payload or computed tree). */
    readonly artifactDigest: string;
    readonly files: readonly IntegrityFileSpec[];
    /** Relative entry under the tree, e.g. index.js */
    readonly entryRelative: string;
}

export interface MaterializedArtifact {
    readonly pluginId: string;
    readonly artifactDigest: string;
    readonly materializedRoot: string;
    readonly entryAbsolute: string;
    readonly generation: number;
    readonly materializedAt: number;
}

const generationByPlugin = new Map<string, number>();

function nextGeneration(pluginId: string): number {
    const n = (generationByPlugin.get(pluginId) ?? 0) + 1;
    generationByPlugin.set(pluginId, n);
    return n;
}

function materializationRoot(): string {
    return path.resolve(process.cwd(), '.data', 'verified-artifacts');
}

function assertNoSymlink(absPath: string): void {
    let st;
    try {
        st = lstatSync(absPath);
    } catch {
        return;
    }
    if (st.isSymbolicLink()) {
        throw new Error(`Symlink rejected in materialization path: ${absPath}`);
    }
}

function assertInsideRoot(root: string, candidate: string): string {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(root, candidate);
    const rel = path.relative(resolvedRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path traversal rejected: ${candidate}`);
    }
    return resolved;
}

async function hashFile(abs: string): Promise<{ digest: string; size: number }> {
    const buf = await fs.readFile(abs);
    const digest = createHash(HASH_ALGORITHM).update(buf).digest('hex');
    return { digest, size: buf.byteLength };
}

/**
 * Materialize the authenticated file set into a Core-controlled directory.
 * Content identity is re-verified after copy.
 */
export async function materializeVerifiedArtifact(
    request: MaterializationRequest,
): Promise<MaterializedArtifact> {
    const gen = nextGeneration(request.pluginId);
    const destRoot = path.join(
        materializationRoot(),
        request.pluginId,
        `${request.artifactDigest.slice(0, 16)}_${gen}`,
    );

    // Reject if source has symlink at root
    assertNoSymlink(request.sourceDir);

    await fs.rm(destRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(destRoot, { recursive: true });

    for (const file of request.files) {
        const srcAbs = assertInsideRoot(request.sourceDir, file.path);
        assertNoSymlink(srcAbs);
        // real path containment
        let realSrc: string;
        try {
            realSrc = realpathSync(srcAbs);
        } catch {
            throw new Error(`Source file missing for materialization: ${file.path}`);
        }
        const realSourceRoot = realpathSync(request.sourceDir);
        if (!realSrc.startsWith(realSourceRoot + path.sep) && realSrc !== realSourceRoot) {
            throw new Error(`Source path escaped package root: ${file.path}`);
        }

        const destAbs = assertInsideRoot(destRoot, file.path);
        await fs.mkdir(path.dirname(destAbs), { recursive: true });
        await fs.copyFile(srcAbs, destAbs);

        const verified = await hashFile(destAbs);
        if (
            verified.digest.toLowerCase() !== file.digest.toLowerCase() ||
            verified.size !== file.size
        ) {
            throw new Error(
                `Materialization content mismatch for ${file.path}: expected ${file.digest}/${file.size}, got ${verified.digest}/${verified.size}`,
            );
        }
    }

    const entryAbsolute = assertInsideRoot(destRoot, request.entryRelative);
    if (!existsSync(entryAbsolute)) {
        throw new Error(`Materialized entry missing: ${request.entryRelative}`);
    }
    assertNoSymlink(entryAbsolute);

    // Recompute root over materialized files
    const ordered = [...request.files]
        .map((f) => ({
            path: f.path.replace(/\\/g, '/'),
            digest: f.digest.toLowerCase(),
            size: f.size,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const rootMaterial = ordered.map((f) => `${f.path}:${f.digest}:${f.size}`).join('\n');
    const recomputed = createHash(HASH_ALGORITHM).update(rootMaterial, 'utf8').digest('hex');
    if (recomputed !== request.artifactDigest) {
        throw new Error(
            `Materialized artifact digest mismatch: expected ${request.artifactDigest}, got ${recomputed}`,
        );
    }

    const result: MaterializedArtifact = {
        pluginId: request.pluginId,
        artifactDigest: request.artifactDigest,
        materializedRoot: destRoot,
        entryAbsolute,
        generation: gen,
        materializedAt: Date.now(),
    };
    log.info(
        `[${request.pluginId}] Materialized verified artifact gen=${gen} digest=${request.artifactDigest.slice(0, 12)}…`,
    );
    return result;
}

export async function disposeMaterialization(artifact: MaterializedArtifact): Promise<void> {
    try {
        await fs.rm(artifact.materializedRoot, { recursive: true, force: true });
    } catch (err: unknown) {
        log.warn(
            `[${artifact.pluginId}] Failed to dispose materialization: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * Snapshot a plugin directory for bypassed/unsigned execution.
 * Content identity is local (not cryptographically trusted).
 */
export async function snapshotDirectoryForExecution(input: {
    readonly pluginId: string;
    readonly sourceDir: string;
    readonly entryRelative: string;
}): Promise<MaterializedArtifact> {
    const { IntegrityScanner } = await import('./scanner.js');
    const files: IntegrityFileSpec[] = [];
    for await (const disc of IntegrityScanner.discoverFiles(input.sourceDir)) {
        const stats = await IntegrityScanner.calculateFileStats(disc.fullPath);
        files.push({
            path: disc.relPath.replace(/\\/g, '/'),
            digest: stats.hash,
            size: stats.size,
        });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    if (files.length === 0) {
        throw new Error(
            `Cannot snapshot empty plugin directory for '${input.pluginId}'`,
        );
    }
    const rootMaterial = files
        .map((f) => `${f.path}:${f.digest}:${f.size}`)
        .join('\n');
    const artifactDigest = createHash(HASH_ALGORITHM)
        .update(rootMaterial, 'utf8')
        .digest('hex');
    return materializeVerifiedArtifact({
        pluginId: input.pluginId,
        sourceDir: input.sourceDir,
        artifactDigest,
        files,
        entryRelative: input.entryRelative,
    });
}
