import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import * as flatbuffers from 'flatbuffers';
import { ZeneManifest } from '#core/flatbuffer/nova-x/system/nova-xmanifest.js';
import type { PluginManifest } from '#core/bases/Plugin.js';

const MAGIC_HEADER = Buffer.from('NCPLUG', 'utf8');
const SIGNATURE_LENGTH = 64;

export async function readSignedManifestMetadata(
    filePath: string,
    publicKeyB64: string,
): Promise<PluginManifest> {
    const fileBytes = await fs.readFile(filePath);
    const payloadOffset = MAGIC_HEADER.length + SIGNATURE_LENGTH;
    if (fileBytes.length < payloadOffset || !fileBytes.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)) {
        throw new Error('Invalid signed plugin manifest header.');
    }

    const signature = fileBytes.subarray(MAGIC_HEADER.length, payloadOffset);
    const payload = fileBytes.subarray(payloadOffset);
    const publicKey = createPublicKey({
        key: Buffer.from(publicKeyB64, 'base64'),
        format: 'der',
        type: 'spki',
    });
    if (!verify(null, payload, publicKey, signature)) {
        throw new Error('Signed plugin manifest signature is invalid.');
    }

    const manifest = ZeneManifest.getRootAsZeneManifest(new flatbuffers.ByteBuffer(payload));
    const dependencies: string[] = [];
    for (let i = 0; i < manifest.dependenciesLength(); i++) {
        const dependency = manifest.dependencies(i);
        if (dependency) dependencies.push(dependency);
    }

    const nodeDependencies: Record<string, string> = {};
    for (let i = 0; i < manifest.nodeDependenciesLength(); i++) {
        const dependency = manifest.nodeDependencies(i);
        const name = dependency?.name();
        const version = dependency?.version();
        if (name && version) nodeDependencies[name] = version;
    }

    return {
        id: manifest.id() ?? '',
        name: manifest.name() ?? '',
        version: manifest.version() ?? '',
        description: manifest.description() ?? undefined,
        author: manifest.author() ?? undefined,
        zene_version: manifest.zeneVersion() ?? undefined,
        node_version: manifest.nodeVersion() ?? undefined,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
        nodeDependencies: Object.keys(nodeDependencies).length > 0 ? nodeDependencies : undefined,
    };
}