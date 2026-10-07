import fs from 'node:fs/promises';
import path from 'node:path';
import { sign, verify, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import * as flatbuffers from 'flatbuffers';
import { getLogger } from '#core/utils/logger.js';

import { ZeneManifest } from '#core/flatbuffer/nova-x/system/nova-xmanifest.js';
import { IntegrityPayload } from '#core/flatbuffer/nova-x/system/integrity-payload.js';
import { FileEntry } from '#core/flatbuffer/nova-x/system/file-entry.js';
import { NodeDependency } from '#core/flatbuffer/nova-x/system/node-dependency.js';

import { IntegrityError, ManifestSignatureError, FileTamperingError, VaultMissingKeyError } from './errors.js';
import { HASH_ALGORITHM, SIGNATURE_LENGTH } from './constants.js';
import { IntegrityScanner } from './scanner.js';
import type { FileMetadata } from './types.js';
import type { PluginManifest } from '#core/bases/Plugin.js';
import {
    canonicalForPack,
    canonicalFromVerifiedFlatFields,
    toPluginManifest,
    type CanonicalPluginMetadata,
} from './canonicalMetadata.js';
import {
    buildSignedLogicalPayload,
    canonicalizeSignedPayload,
    deriveSignerFingerprint,
    METADATA_SCHEMA_VERSION,
    type SignedLogicalPayload,
} from './signedPayload.js';
import { CANONICALIZATION_VERSION } from './jcs.js';
import { computeLockfileDigest } from './dependencyClosure.js';
import { setAuthenticatedPluginContext } from './authenticatedContext.js';
import { setAuthenticatedRuntimeFloor } from '#core/runtime/authenticatedPolicy.js';
import { setAuthenticatedProviderDeclarations } from '#core/provider/declarations.js';
import { createHash } from 'node:crypto';
import {
    signV2CanonicalPayload,
    verifyV2CanonicalPayload,
} from './domainSeparatedSign.js';

const log = getLogger('PackageManager');

const MAGIC_HEADER = Buffer.from('NCPLUG', 'utf8');
const HEADER_OFFSET = MAGIC_HEADER.length; 
const PAYLOAD_OFFSET = HEADER_OFFSET + SIGNATURE_LENGTH;

export class PackageManager {
    
    public static async pack(
        rootDir: string, 
        signingPrivKeyPem: string, 
        metadata: PluginManifest,
        outputFile = 'manifest.nvx'
    ): Promise<void> {
        const canonical = canonicalForPack(metadata);
        const files: Record<string, FileMetadata> = {};
        const tasks: (() => Promise<void>)[] = [];
        const ignoreList = [...canonical.ignoreHash];
        const ignoreSet = new Set(ignoreList);

        for await (const { fullPath, relPath } of IntegrityScanner.discoverFiles(rootDir, rootDir, ignoreSet)) {
            if (relPath === outputFile || relPath === `${outputFile}.tmp`) continue;

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

        const filesVecOffset = IntegrityPayload.createFilesVector(builder, fileOffsets);
        const algoOffset = builder.createString(HASH_ALGORITHM);

        let ignoreHashOffset = 0;
        if (ignoreList.length > 0) {
            const ignoreOffsets = ignoreList.map((p) => builder.createString(p));
            ignoreHashOffset = IntegrityPayload.createIgnoreHashVector(builder, ignoreOffsets);
        }

        IntegrityPayload.startIntegrityPayload(builder);
        IntegrityPayload.addTimestamp(builder, BigInt(Date.now()));
        IntegrityPayload.addAlgorithm(builder, algoOffset);
        IntegrityPayload.addFiles(builder, filesVecOffset);
        if (ignoreHashOffset) {
            IntegrityPayload.addIgnoreHash(builder, ignoreHashOffset);
        }
        const integrityOffset = IntegrityPayload.endIntegrityPayload(builder);

        const idOffset = builder.createString(canonical.id);
        const nameOffset = builder.createString(canonical.name);
        const versionOffset = builder.createString(canonical.version);
        const descOffset = canonical.description ? builder.createString(canonical.description) : 0;
        const authorOffset = canonical.author ? builder.createString(canonical.author) : 0;
        const nvxVersionOffset = canonical.zene_version
            ? builder.createString(canonical.zene_version)
            : 0;
        const nodeVersionOffset = canonical.node_version
            ? builder.createString(canonical.node_version)
            : 0;

        let depsOffset = 0;
        if (canonical.dependencies.length > 0) {
            const dOffsets = canonical.dependencies.map((d) => builder.createString(d));
            depsOffset = ZeneManifest.createDependenciesVector(builder, dOffsets);
        }

        let nodeDepsOffset = 0;
        const nodeDepKeys = Object.keys(canonical.nodeDependencies);
        if (nodeDepKeys.length > 0) {
            const entryOffsets: number[] = [];
            for (const pkgName of nodeDepKeys) {
                const range = canonical.nodeDependencies[pkgName]!;
                const nameOff = builder.createString(pkgName);
                const verOff = builder.createString(range);
                entryOffsets.push(NodeDependency.createNodeDependency(builder, nameOff, verOff));
            }
            nodeDepsOffset = ZeneManifest.createNodeDependenciesVector(builder, entryOffsets);
        }

        // Phase 2E: build JCS logical payload binding integrity tree + security claims
        const priorityValue = canonical.priority ?? 0;
        const integrityFiles = sortedPaths.map((relPath) => ({
            path: relPath,
            digest: files[relPath]!.hash,
            size: files[relPath]!.size,
        }));
        const rootDigest = createHash('sha256')
            .update(
                integrityFiles.map((f) => `${f.path}:${f.digest}:${f.size}`).join('\n'),
                'utf8',
            )
            .digest('hex');

        let lockfileDigest: string | undefined;
        let lockfileName: string | undefined;
        let packageManager: 'npm' | 'bun' | 'none' = 'none';
        const npmLock = path.join(rootDir, 'package-lock.json');
        const bunLock = path.join(rootDir, 'bun.lock');
        try {
            await fs.access(npmLock);
            lockfileName = 'package-lock.json';
            packageManager = 'npm';
            lockfileDigest = await computeLockfileDigest(rootDir, lockfileName);
        } catch {
            try {
                await fs.access(bunLock);
                lockfileName = 'bun.lock';
                packageManager = 'bun';
                lockfileDigest = await computeLockfileDigest(rootDir, lockfileName);
            } catch {
                /* no lock */
            }
        }

        const logical = buildSignedLogicalPayload({
            id: canonical.id,
            name: canonical.name,
            version: canonical.version,
            description: canonical.description,
            author: canonical.author,
            dependencies: canonical.dependencies,
            zene_version: canonical.zene_version,
            node_version: canonical.node_version,
            priority: priorityValue,
            ignoreHash: canonical.ignoreHash,
            providers: [],
            runtimeRequirements: {
                minimumIsolation: 'process',
                requiredCapabilities: [],
            },
            integrity: {
                // Logical binding digest is SHA-256 over path:fileDigest:size lines.
                // Per-file digests remain the package hash algorithm (see IntegrityPayload).
                algorithm: 'sha256',
                rootDigest,
                files: integrityFiles,
            },
            dependencyLock: {
                packageManager,
                lockfileName,
                lockfileDigest,
                dependencies: { ...canonical.nodeDependencies },
            },
        });
        const jcsPayload = canonicalizeSignedPayload(logical);
        const signedPayloadOffset = builder.createString(jcsPayload);

        ZeneManifest.startZeneManifest(builder);
        ZeneManifest.addId(builder, idOffset);
        ZeneManifest.addName(builder, nameOffset);
        ZeneManifest.addVersion(builder, versionOffset);
        if (descOffset) ZeneManifest.addDescription(builder, descOffset);
        if (authorOffset) ZeneManifest.addAuthor(builder, authorOffset);
        if (nvxVersionOffset) ZeneManifest.addzeneVersion(builder, nvxVersionOffset);
        if (nodeVersionOffset) ZeneManifest.addNodeVersion(builder, nodeVersionOffset);
        if (depsOffset) ZeneManifest.addDependencies(builder, depsOffset);

        ZeneManifest.addIntegrity(builder, integrityOffset);
        if (nodeDepsOffset) ZeneManifest.addNodeDependencies(builder, nodeDepsOffset);
        // Phase 1A/1B: priority always written for new packs (default 0 from canonical).
        ZeneManifest.addPriority(builder, priorityValue);
        // Phase 2E: authenticated JCS payload is part of the signed FlatBuffer body
        ZeneManifest.addSignedPayload(builder, signedPayloadOffset);
        ZeneManifest.addMetadataVersion(builder, METADATA_SCHEMA_VERSION);
        ZeneManifest.addCanonicalizationVersion(builder, CANONICALIZATION_VERSION);
        builder.finish(ZeneManifest.endZeneManifest(builder));

        const fbPayload = Buffer.from(builder.asUint8Array());

        let signKey;
        try {
            signKey = createPrivateKey(signingPrivKeyPem);
        } catch (err) {
            throw new IntegrityError('Invalid Private Key provided for packaging. Must be a valid PEM.');
        }

        // Phase 2E: primary signature is domain-separated over JCS canonical bytes.
        // FlatBuffer is the transport envelope that carries the signed_payload string.
        const signature = signV2CanonicalPayload(jcsPayload, signKey);
        const finalBinaryFile = Buffer.concat([MAGIC_HEADER, signature, fbPayload]);

        const manifestPath = path.resolve(rootDir, outputFile);
        const tempPath = `${manifestPath}.tmp`;
        await fs.writeFile(tempPath, finalBinaryFile);
        await fs.rename(tempPath, manifestPath);
        
        log.info(
            `[${canonical.id}] Packaged perfectly. ${sortedPaths.length} files locked ` +
                `(dist trees included; data/schema + data/rules included; mutable data / node_modules / .data excluded; priority=${priorityValue}).`,
        );
    }

    public static async unpackAndVerify(
        rootDir: string, 
        signingPubKeyB64: string, 
        manifestFile = 'manifest.nvx'
    ): Promise<PluginManifest> {
        const manifestPath = path.resolve(rootDir, manifestFile);
        
        const fileBytes = await fs.readFile(manifestPath).catch(() => {
            throw new IntegrityError(`Required secure package [${manifestFile}] missing.`);
        });

        if (fileBytes.length < PAYLOAD_OFFSET) {
            throw new IntegrityError('File is too small to be a valid Zene package.');
        }

        const magic = fileBytes.subarray(0, HEADER_OFFSET);
        const signature = fileBytes.subarray(HEADER_OFFSET, PAYLOAD_OFFSET);
        const fbPayload = fileBytes.subarray(PAYLOAD_OFFSET);

        if (!magic.equals(MAGIC_HEADER)) {
            throw new IntegrityError('Invalid magic header. This is not a Zene package.');
        }

        let publicKey;
        try {
            publicKey = createPublicKey({ key: Buffer.from(signingPubKeyB64, 'base64'), format: 'der', type: 'spki' });
        } catch (err) {
            throw new VaultMissingKeyError('PluginPublicKey in Vault is malformed or invalid DER format.');
        }

        // Parse FlatBuffer envelope first (structure only), then verify signature target.
        if (fbPayload.length < 8) {
            throw new IntegrityError('FlatBuffer payload too small.');
        }
        // Soft size bound to limit memory amplification from malicious vectors
        const MAX_NVX_PAYLOAD = 64 * 1024 * 1024;
        if (fbPayload.length > MAX_NVX_PAYLOAD) {
            throw new IntegrityError('FlatBuffer payload exceeds maximum allowed size.');
        }

        let buf: flatbuffers.ByteBuffer;
        let manifest: ZeneManifest;
        try {
            buf = new flatbuffers.ByteBuffer(fbPayload);
            manifest = ZeneManifest.getRootAsZeneManifest(buf);
        } catch (err: unknown) {
            throw new IntegrityError(
                `Malformed FlatBuffer envelope: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        const hasV2Payload = manifest.hasSignedPayload();
        const jcsFromFb = hasV2Payload ? manifest.signedPayload() : null;

        if (hasV2Payload && jcsFromFb) {
            if (jcsFromFb.length > 8 * 1024 * 1024) {
                throw new IntegrityError('signed_payload exceeds maximum allowed size.');
            }
            // Primary: domain-separated verification over canonical JCS bytes
            const isAuthentic = verifyV2CanonicalPayload(jcsFromFb, signature, publicKey);
            if (!isAuthentic) {
                throw new ManifestSignatureError(
                    'CRITICAL: V2 canonical payload signature invalid. Metadata or code was tampered with.',
                );
            }
        } else {
            // Legacy: signature over FlatBuffer body (pre-v2 packs)
            const isAuthentic = verify(null, fbPayload, publicKey, signature);
            if (!isAuthentic) {
                throw new ManifestSignatureError(
                    'CRITICAL: Package signature invalid. Metadata or code was tampered with.',
                );
            }
        }

        const integrity = manifest.integrity();

        if (!integrity) {
            throw new IntegrityError('Package is missing the internal cryptographic integrity tree.');
        }

        const filesLength = integrity.filesLength();
        const scannedFiles = new Set<string>();
        const mismatches: string[] = [];
        const tasks: (() => Promise<void>)[] = [];
        const ignoredPaths = new Set<string>();
        for (let i = 0; i < integrity.ignoreHashLength(); i++) {
            const p = integrity.ignoreHash(i);
            if (p) ignoredPaths.add(p.replace(/\\/g, '/'));
        }

        const expectedFiles = new Map<string, { hash: Buffer; size: number }>();

        for (let i = 0; i < filesLength; i++) {
            const fileNode = integrity.files(i)!;
            const pathStr = fileNode.path();
            if (pathStr) {
                expectedFiles.set(pathStr, {
                    hash: Buffer.from(fileNode.hashArray()!),
                    size: fileNode.size()
                });
            }
        }

        for await (const { fullPath, relPath } of IntegrityScanner.discoverFiles(rootDir, rootDir, ignoredPaths)) {
            if (relPath === manifestFile || relPath === `${manifestFile}.tmp`) continue;

            scannedFiles.add(relPath);
            const expected = expectedFiles.get(relPath);

            if (!expected) {
                mismatches.push(`[UNAUTHORIZED ADDITION] ${relPath}`);
                continue;
            }

            tasks.push(async () => {
                const current = await IntegrityScanner.calculateFileStats(fullPath);
                const currentHashBuf = Buffer.from(current.hash, 'hex');

                if (current.size !== expected.size || !timingSafeEqual(expected.hash, currentHashBuf)) {
                    mismatches.push(`[CORRUPTED/MODIFIED] ${relPath}`);
                }
            });
        }

        await IntegrityScanner.runConcurrently(tasks);

        for (const expectedRelPath of expectedFiles.keys()) {
            if (!scannedFiles.has(expectedRelPath)) mismatches.push(`[DELETED] ${expectedRelPath}`);
        }

        if (mismatches.length > 0) {
            mismatches.forEach(m => log.error(m));
            throw new FileTamperingError(`Package integrity check failed: ${mismatches.length} violations detected.`);
        }

        const dependencies: string[] = [];
        for (let i = 0; i < manifest.dependenciesLength(); i++) {
            dependencies.push(manifest.dependencies(i)!);
        }

        const nodeDependencies: Record<string, string> = {};
        for (let i = 0; i < manifest.nodeDependenciesLength(); i++) {
            const entry = manifest.nodeDependencies(i);
            if (!entry) continue;
            const pkgName = entry.name();
            const pkgVersion = entry.version();
            if (pkgName && pkgVersion) {
                nodeDependencies[pkgName] = pkgVersion;
            }
        }

        const ignoreHashList: string[] = [];
        for (let i = 0; i < integrity.ignoreHashLength(); i++) {
            const p = integrity.ignoreHash(i);
            if (p) ignoreHashList.push(p.replace(/\\/g, '/'));
        }

        // Phase 1B: project verified FlatBuffer fields through the canonical layer.
        const priorityAuthenticated = manifest.hasPriority();
        const canonical: CanonicalPluginMetadata = canonicalFromVerifiedFlatFields({
            id: manifest.id()!,
            name: manifest.name()!,
            version: manifest.version()!,
            description: manifest.description() ?? undefined,
            author: manifest.author() ?? undefined,
            dependencies,
            zene_version: manifest.zeneVersion() ?? undefined,
            node_version: manifest.nodeVersion() ?? undefined,
            nodeDependencies,
            priorityAuthenticated,
            priority: priorityAuthenticated ? manifest.priority() : undefined,
            ignoreHash: ignoreHashList,
        });

        // Phase 2E: extract authenticated JCS payload when present (new packs).
        // Signature already verified over the FlatBuffer body that embeds this string.
        const hasV2 = manifest.hasSignedPayload();
        const rawPayload = hasV2 ? manifest.signedPayload() : null;
        let signedLogical: SignedLogicalPayload | undefined;
        if (rawPayload) {
            try {
                const parsed: unknown = JSON.parse(rawPayload);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    signedLogical = parsed as SignedLogicalPayload;
                    // Require version markers when payload present
                    if (
                        typeof signedLogical.canonicalizationVersion !== 'number' ||
                        typeof signedLogical.metadataVersion !== 'number'
                    ) {
                        throw new IntegrityError('Signed payload missing version markers.');
                    }
                    if (
                        signedLogical.canonicalizationVersion !== CANONICALIZATION_VERSION ||
                        signedLogical.metadataVersion !== METADATA_SCHEMA_VERSION
                    ) {
                        throw new IntegrityError(
                            `Unsupported signed payload versions: canon=${String(signedLogical.canonicalizationVersion)} meta=${String(signedLogical.metadataVersion)}`,
                        );
                    }
                    // Authoritative v2 source: signed payload. FB fields must match.
                    if (signedLogical.id !== manifest.id()) {
                        throw new IntegrityError(
                            `Signed payload id '${signedLogical.id}' mismatches FlatBuffer id '${manifest.id() ?? ''}'.`,
                        );
                    }
                    if (signedLogical.version !== manifest.version()) {
                        throw new IntegrityError(
                            `Signed payload version mismatches FlatBuffer version.`,
                        );
                    }
                    if (manifest.hasPriority() && signedLogical.priority !== manifest.priority()) {
                        throw new IntegrityError(
                            `Signed payload priority mismatches FlatBuffer priority.`,
                        );
                    }
                }
            } catch (err: unknown) {
                if (err instanceof IntegrityError) throw err;
                throw new IntegrityError(
                    `Malformed signed payload: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        const pluginId = canonical.id;
        const fingerprint = deriveSignerFingerprint(
            Buffer.from(signingPubKeyB64, 'base64'),
        );

        if (signedLogical) {
            const minIso = signedLogical.runtimeRequirements.minimumIsolation;
            setAuthenticatedPluginContext(pluginId, {
                pluginId,
                profile: 'v2-authenticated',
                authority: 'signed',
                signerFingerprint: fingerprint,
                trustOutcome: 'trusted',
                authorization: 'allowed',
                minimumIsolation: minIso,
                requiredCapabilities: [...signedLogical.runtimeRequirements.requiredCapabilities],
                providerDeclarations: signedLogical.providers.map((pr) => ({
                    category: pr.category,
                    id: pr.id,
                    priority: pr.priority,
                    capabilities: [...pr.capabilities],
                })),
                dependencyLock: {
                    packageManager: signedLogical.dependencyLock.packageManager,
                    lockfileName: signedLogical.dependencyLock.lockfileName,
                    lockfileDigest: signedLogical.dependencyLock.lockfileDigest,
                    dependencies: { ...signedLogical.dependencyLock.dependencies },
                },
                integrityRootDigest: signedLogical.integrity.rootDigest,
                signedPayload: signedLogical,
            });
            setAuthenticatedRuntimeFloor(pluginId, {
                minimumIsolation: minIso,
                requiredCapabilities: [...signedLogical.runtimeRequirements.requiredCapabilities],
            });
            setAuthenticatedProviderDeclarations(
                pluginId,
                signedLogical.providers.map((pr) => ({
                    category: pr.category,
                    id: pr.id,
                    priority: pr.priority,
                    capabilities: [...pr.capabilities],
                })),
            );
        } else {
            // Legacy signed artifact: explicit weaker profile
            setAuthenticatedPluginContext(pluginId, {
                pluginId,
                profile: 'legacy-signed',
                authority: 'legacy-signed',
                signerFingerprint: fingerprint,
                trustOutcome: 'trusted',
                authorization: 'allowed',
                requiredCapabilities: [],
                providerDeclarations: [],
                dependencyLock: {
                    packageManager: 'none',
                    dependencies: { ...canonical.nodeDependencies },
                },
            });
        }

        return toPluginManifest(canonical);
    }
}
