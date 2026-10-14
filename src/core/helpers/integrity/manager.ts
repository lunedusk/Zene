import fs from 'node:fs/promises';
import path from 'node:path';
import { sign, verify, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import * as flatbuffers from 'flatbuffers';
import { getLogger } from '#core/utils/logger.js';

import { Manifest } from '#core/flatbuffer/zene/integrity/manifest.js';
import { FileEntry } from '#core/flatbuffer/zene/integrity/file-entry.js';

import { IntegrityError, ManifestSignatureError, FileTamperingError } from './errors.js';
import { HASH_ALGORITHM, SIGNATURE_LENGTH } from './constants.js';
import { IntegrityScanner } from './scanner.js';
import type { FileMetadata } from './types.js';

const log = getLogger('IntegrityManager');

export class IntegrityManager {
    public static async generate(
        rootDir: string, 
        signingPrivKeyPem: string, 
        manifestFile = 'manifest.bin',
        ignoreHash: readonly string[] = [],
    ): Promise<void> {
        const files: Record<string, FileMetadata> = {};
        const tasks: (() => Promise<void>)[] = [];
        const ignoreList = ignoreHash
            .map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''))
            .filter((p) => p.length > 0 && !p.includes('..'));
        const ignoreSet = new Set(ignoreList);

        for await (const { fullPath, relPath } of IntegrityScanner.discoverFiles(rootDir, rootDir, ignoreSet)) {
            tasks.push(async () => {
                files[relPath] = await IntegrityScanner.calculateFileStats(fullPath);
            });
        }
        await IntegrityScanner.runConcurrently(tasks);

        const builder = new flatbuffers.Builder(1024 * 64);
        const fileOffsets: number[] = [];
        const sortedPaths = Object.keys(files).sort();
        
        for (const relPath of sortedPaths) {
            const file = files[relPath];
            const pathOffset = builder.createString(relPath);
            
            const hashBuf = Buffer.from(file.hash, 'hex');
            const hashOffset = FileEntry.createHashVector(builder, hashBuf);

            FileEntry.startFileEntry(builder);
            FileEntry.addPath(builder, pathOffset);
            FileEntry.addHash(builder, hashOffset);
            FileEntry.addSize(builder, file.size);
            fileOffsets.push(FileEntry.endFileEntry(builder));
        }

        const filesVecOffset = Manifest.createFilesVector(builder, fileOffsets);
        const algoOffset = builder.createString(HASH_ALGORITHM);

        let ignoreHashOffset = 0;
        if (ignoreList.length > 0) {
            const offs = ignoreList.map((p) => builder.createString(p));
            ignoreHashOffset = Manifest.createIgnoreHashVector(builder, offs);
        }

        Manifest.startManifest(builder);
        Manifest.addTimestamp(builder, BigInt(Date.now()));
        Manifest.addAlgorithm(builder, algoOffset);
        Manifest.addFiles(builder, filesVecOffset);
        if (ignoreHashOffset) {
            Manifest.addIgnoreHash(builder, ignoreHashOffset);
        }
        builder.finish(Manifest.endManifest(builder));

        const fbPayload = Buffer.from(builder.asUint8Array());

        const signKey = createPrivateKey(signingPrivKeyPem);
        const signature = sign(null, fbPayload, signKey);
        
        const signedPayload = Buffer.concat([signature, fbPayload]);

        const manifestPath = path.resolve(rootDir, manifestFile);
        const tempPath = `${manifestPath}.tmp`;
        await fs.writeFile(tempPath, signedPayload);
        await fs.rename(tempPath, manifestPath);
        
        log.info(`Lock applied. Manifest signed containing ${sortedPaths.length} files.`);
    }

    public static async verify(
        rootDir: string, 
        signingPubKeyB64: string, 
        manifestFile = 'manifest.bin'
    ): Promise<boolean> {
        const manifestPath = path.resolve(rootDir, manifestFile);
        const signedPayload = await fs.readFile(manifestPath).catch(() => {
            throw new IntegrityError('Manifest file not found. System integrity cannot be verified.');
        });

        if (signedPayload.length < SIGNATURE_LENGTH) {
            throw new IntegrityError('Payload is too small to contain a valid signature.');
        }

        const signature = signedPayload.subarray(0, SIGNATURE_LENGTH);
        const fbPayload = signedPayload.subarray(SIGNATURE_LENGTH);

        const publicKey = createPublicKey({ key: Buffer.from(signingPubKeyB64, 'base64'), format: 'der', type: 'spki' });
        const isAuthentic = verify(null, fbPayload, publicKey, signature);

        if (!isAuthentic) {
            throw new ManifestSignatureError('CRITICAL: Manifest signature is invalid. The manifest itself was forged or tampered with.');
        }

        const buf = new flatbuffers.ByteBuffer(fbPayload);
        const manifest = Manifest.getRootAsManifest(buf);
        
        const filesLength = manifest.filesLength();
        const scannedFiles = new Set<string>();
        const mismatches: string[] = [];
        const tasks: (() => Promise<void>)[] = [];

        const ignoredPaths = new Set<string>();
        for (let i = 0; i < manifest.ignoreHashLength(); i++) {
            const p = manifest.ignoreHash(i);
            if (p) ignoredPaths.add(p.replace(/\\/g, '/'));
        }

        const expectedFiles = new Map<string, { hash: Buffer; size: number }>();
        for (let i = 0; i < filesLength; i++) {
            const fileNode = manifest.files(i)!;
            const pathStr = fileNode.path();
            if (pathStr) {
                expectedFiles.set(pathStr, {
                    hash: Buffer.from(fileNode.hashArray()!),
                    size: fileNode.size()
                });
            }
        }

        for await (const { fullPath, relPath } of IntegrityScanner.discoverFiles(rootDir, rootDir, ignoredPaths)) {
            scannedFiles.add(relPath);
            const expected = expectedFiles.get(relPath);

            if (!expected) {
                log.error(`[UNAUTHORIZED ADDITION] File detected: ${relPath}`);
                mismatches.push(relPath);
                continue;
            }

            tasks.push(async () => {
                const current = await IntegrityScanner.calculateFileStats(fullPath);
                const currentHashBuf = Buffer.from(current.hash, 'hex');

                if (
                    current.size !== expected.size || 
                    expected.hash.length !== currentHashBuf.length || 
                    !timingSafeEqual(expected.hash, currentHashBuf)
                ) {
                    log.error(`[MODIFIED/CORRUPTED] Integrity breach: ${relPath}`);
                    mismatches.push(relPath);
                }
            });
        }

        await IntegrityScanner.runConcurrently(tasks);

        for (const expectedRelPath of expectedFiles.keys()) {
            if (!scannedFiles.has(expectedRelPath)) {
                log.error(`[DELETED] Required file missing: ${expectedRelPath}`);
                mismatches.push(expectedRelPath);
            }
        }

        if (mismatches.length > 0) {
            throw new FileTamperingError(`Integrity check failed: ${mismatches.length} unauthorized alterations detected.`);
        }

        log.info('System integrity verified. Authentic and Unmodified.');
        return true;
    }
}
