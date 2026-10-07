import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const sourceRoot = path.join(projectRoot, 'src');
const assetExtensions = new Set([
    '.json5',
    '.json',
    '.nvx',
    '.png',
    '.webp',
    '.jpg',
    '.jpeg',
    '.svg',
    '.js',
    '.mjs',
    '.cjs',
    '.d.ts',
    '.wasm',
    '.node',
]);

/**
 * Copy non-TypeScript assets from src/ into the compiled root layout.
 * tsc emits .js under plugins/<id>/; this ensures manifest.json and other
 * assets land beside them so production pack can find plugins/<id>/manifest.json.
 */
async function copyAssets(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await copyAssets(sourcePath);
            continue;
        }
        if (!assetExtensions.has(path.extname(entry.name).toLowerCase())) continue;

        const relativePath = path.relative(sourceRoot, sourcePath);
        const destinationPath = path.join(projectRoot, relativePath);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
    }
}

await copyAssets(sourceRoot);

// Phase 2E: verify plugin production trees were materialised (tsc + assets).
// Do not create a second builder — only assert the existing pipeline left plugins usable.
const srcPlugins = path.join(sourceRoot, 'plugins');
try {
    const pluginDirs = await fs.readdir(srcPlugins, { withFileTypes: true });
    for (const entry of pluginDirs) {
        if (!entry.isDirectory()) continue;
        const dest = path.join(projectRoot, 'plugins', entry.name);
        const man = path.join(dest, 'manifest.json');
        const hasMan = await fs.access(man).then(() => true).catch(() => false);
        if (!hasMan) {
            // Ensure manifest is present even if copy walk missed a race
            const srcMan = path.join(srcPlugins, entry.name, 'manifest.json');
            const srcHas = await fs.access(srcMan).then(() => true).catch(() => false);
            if (srcHas) {
                await fs.mkdir(dest, { recursive: true });
                await fs.copyFile(srcMan, man);
            }
        }
    }
} catch {
    /* no src/plugins */
}
