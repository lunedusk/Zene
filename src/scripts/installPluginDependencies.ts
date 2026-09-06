import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolvePluginPublicKey } from '#core/helpers/integrity/publicKey.js';
import { readSignedManifestMetadata } from '#core/helpers/integrity/signedMetadata.js';

process.loadEnvFile?.();

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../..');
const pluginsRoot = path.join(projectRoot, 'src', 'plugins');

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDependencyMap(value: unknown): Record<string, string> {
    if (!isObject(value)) return {};

    const dependencies: Record<string, string> = {};
    for (const [name, range] of Object.entries(value)) {
        if (name.trim() && typeof range === 'string' && range.trim()) {
            dependencies[name.trim()] = range.trim();
        }
    }
    return dependencies;
}

async function readJson(filePath: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

async function readManifest(pluginDir: string, pluginId: string): Promise<JsonObject> {
    const signedManifestPath = path.join(pluginDir, 'manifest.nvx');
    if (await fs.access(signedManifestPath).then(() => true).catch(() => false)) {
        return await readSignedManifestMetadata(
            signedManifestPath,
            resolvePluginPublicKey(pluginId),
        ) as unknown as JsonObject;
    }

    const manifest = await readJson(path.join(pluginDir, 'manifest.json'));
    if (!isObject(manifest)) throw new Error(`Invalid manifest for plugin ${pluginId}.`);
    return manifest;
}

async function installPluginDependencies(pluginDir: string): Promise<void> {
    const pluginId = path.basename(pluginDir);
    const manifest = await readManifest(pluginDir, pluginId);

    const packageJson = await readJson(path.join(pluginDir, 'package.json')).catch(() => null);
    const dependencies = {
        ...readDependencyMap(isObject(packageJson) ? packageJson.dependencies : undefined),
        ...readDependencyMap(manifest.node_dependencies ?? manifest.nodeDependencies),
    };
    const specs = Object.entries(dependencies).map(([name, range]) => `${name}@${range}`);

    if (specs.length === 0) return;

    const resolvedPluginId = typeof manifest.id === 'string' ? manifest.id : pluginId;
    console.log(`[${resolvedPluginId}] Installing ${specs.length} local npm dependenc${specs.length === 1 ? 'y' : 'ies'}...`);
    const packagePath = path.join(pluginDir, 'package.json');
    const hasPackageJson = await fs.access(packagePath).then(() => true).catch(() => false);
    if (!hasPackageJson) {
        await fs.writeFile(packagePath, JSON.stringify({ private: true }, null, 2));
    }
    try {
        await execFileAsync('npm', [
            'install',
            '--prefix',
            pluginDir,
            ...specs,
            '--no-save',
            '--package-lock=false',
            '--no-audit',
            '--no-fund',
            '--prefer-offline',
        ], { cwd: projectRoot, maxBuffer: 1024 * 1024 });
    } finally {
        if (!hasPackageJson) await fs.rm(packagePath, { force: true });
    }
}

const entries = await fs.readdir(pluginsRoot, { withFileTypes: true });
for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(pluginsRoot, entry.name);
    const hasManifest = await Promise.all([
        fs.access(path.join(pluginDir, 'manifest.nvx')).then(() => true).catch(() => false),
        fs.access(path.join(pluginDir, 'manifest.json')).then(() => true).catch(() => false),
    ]).then(([hasNvx, hasJson]) => hasNvx || hasJson);
    if (hasManifest) {
        await installPluginDependencies(pluginDir);
    }
}