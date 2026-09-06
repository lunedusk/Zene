import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const sourceRoot = path.join(projectRoot, 'src');
const assetExtensions = new Set(['.json5', '.json', '.nvx', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.js', ".mjs", ".cjs", ".d.ts", ".wasm", ".node"]);

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