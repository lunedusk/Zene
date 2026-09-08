import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { materializeBootEnv } from '#core/defaults.js';
import { secrets } from '#core/helpers/secretManager.js';

materializeBootEnv();
import { getLogger, flushLogs } from '#core/utils/logger.js';
import { PackageManager } from '#core/helpers/integrity/manifest.js';
import type { PluginManifest } from '#core/bases/Plugin.js';

function resolvePrivateKey(): string | null {
    const raw =
        secrets.getOptional('PrivateKey') ||
        process.env.PrivateKey ||
        secrets.getOptional('PLUGIN_SIGNING_KEY') ||
        process.env.PLUGIN_SIGNING_KEY ||
        null;
    return raw && String(raw).trim() ? String(raw).trim() : null;
}

function toPem(privKey: string): string {
    if (privKey.includes('BEGIN PRIVATE KEY')) return privKey;
    const formattedKey = privKey.match(/.{1,64}/g)?.join('\n');
    return `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
}

function normalizeNodeDependencies(raw: unknown): Record<string, string> | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof key === 'string' && key.trim() && typeof value === 'string' && value.trim()) {
            out[key.trim()] = value.trim();
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

class BinaryManifestPacker {
    private readonly log;
    private readonly privateKeyPem: string;

    constructor() {
        this.log = getLogger('BinaryPacker');

        const privKey = resolvePrivateKey();
        if (!privKey) {
            this.log.error(
                'Missing cryptographic key! Set PrivateKey or PLUGIN_SIGNING_KEY in .env / CI secrets.'
            );
            process.exit(1);
        }

        this.privateKeyPem = toPem(privKey);
        this.log.info('Cryptographic engine initialized with Ed25519 PEM Key.');
    }

    private async resolvePluginDir(pluginId: string): Promise<string> {
        const candidates = [
            path.resolve(process.cwd(), 'plugins', pluginId),
            path.resolve(process.cwd(), 'src', 'plugins', pluginId)
        ];
        for (const dir of candidates) {
            const st = await fs.stat(dir).catch(() => null);
            if (st?.isDirectory()) {
                const man = path.join(dir, 'manifest.json');
                try {
                    await fs.access(man);
                    return dir;
                } catch {  }
            }
        }
        throw new Error(
            `Plugin directory with manifest.json not found for "${pluginId}". ` +
            `Tried: plugins/${pluginId}, src/plugins/${pluginId}`
        );
    }

    public async pack(pluginId: string): Promise<void> {
        if (!pluginId) {
            this.log.error('No plugin specified. Usage: npm run pack <plugin_id>');
            process.exit(1);
        }

        const pluginDir = await this.resolvePluginDir(pluginId);
        const sourceManifestPath = path.join(pluginDir, 'manifest.json');

        try {
            this.log.info(`Reading source metadata for plugin: [${pluginId}] @ ${pluginDir}`);
            const rawData = await fs.readFile(sourceManifestPath, 'utf-8');
            const rawJson: unknown = JSON.parse(rawData);
            if (typeof rawJson !== 'object' || rawJson === null || Array.isArray(rawJson)) {
                throw new Error(`Invalid manifest.json. Expected a JSON object.`);
            }
            const raw = rawJson as Record<string, unknown>;

            const id = typeof raw.id === 'string' ? raw.id : '';
            const name = typeof raw.name === 'string' ? raw.name : '';
            const version = typeof raw.version === 'string' ? raw.version : '';
            if (!id || !name || !version) {
                throw new Error(`Invalid manifest.json. Missing required fields (id, name, version).`);
            }

            const nodeDependencies = normalizeNodeDependencies(
                raw.node_dependencies ?? raw.nodeDependencies
            );

            const metadata: PluginManifest = {
                id,
                name,
                version,
                description: typeof raw.description === 'string' ? raw.description : undefined,
                author: typeof raw.author === 'string' ? raw.author : undefined,
                dependencies: Array.isArray(raw.dependencies)
                    ? raw.dependencies.filter((d): d is string => typeof d === 'string')
                    : undefined,
                zene_version: (typeof raw.zene_version === 'string' || Array.isArray(raw.zene_version))
                    ? (raw.zene_version as string | string[])
                    : undefined,
                node_version: typeof raw.node_version === 'string' ? raw.node_version : undefined,
                priority: typeof raw.priority === 'number' ? raw.priority : undefined,
                nodeDependencies,
            };

            this.log.info(`Generating Flatbuffer and calculating file hashes...`);

            await PackageManager.pack(
                pluginDir,
                this.privateKeyPem,
                metadata,
                'manifest.nvx'
            );

            this.log.info('--------------------------------------------------');
            this.log.info(`Successfully locked and signed: ${pluginId}`);
            this.log.info(`Output: ${path.join(pluginDir, 'manifest.nvx')}`);
            this.log.info('--------------------------------------------------');
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                this.log.error(`Source manifest.json not found at: ${sourceManifestPath}`);
                this.log.error(`You must have a basic manifest.json to generate the .nvx file.`);
            } else if (error instanceof SyntaxError) {
                this.log.error(`Invalid JSON format in manifest.json for ${pluginId}.`);
            } else {
                this.log.error(`Packaging failed: ${error.message}`);
                if (error.stack) this.log.debug(error.stack);
            }
            process.exit(1);
        }
    }
}

async function main() {
    try {
        secrets.assimilateEnv();

        const logger = getLogger('Bootstrap');
        logger.info('Starting Zene Binary Manifest Packer...');

        const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
        let pluginId = args[0];
        const pluginFlag = process.argv.findIndex(a => a === '--plugin' || a === '--pluginId');
        if (pluginFlag >= 0 && process.argv[pluginFlag + 1]) {
            pluginId = process.argv[pluginFlag + 1];
        }

        const packer = new BinaryManifestPacker();
        await packer.pack(pluginId);
    } catch (error) {
        console.error('FATAL APPLICATION CRASH:', error);
        process.exit(1);
    } finally {
        await flushLogs();
    }
}

main();
