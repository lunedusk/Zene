/**
 * Resolve compiled vs source host/plugin artifacts.
 * Production prefers emitted JS under cwd/core/... (tsconfig outDir "./").
 * No production dependency on tsx; no runtime compilation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function moduleDir(): string {
    return path.dirname(fileURLToPath(import.meta.url));
}

function parentHasTsLoader(execArgv: readonly string[]): boolean {
    return execArgv.some(
        (a) =>
            a.includes('tsx') ||
            a.includes('ts-node') ||
            a.includes('ts-node/esm') ||
            a.includes('--loader') ||
            a.includes('--import'),
    );
}

export interface ResolvedHostArtifact {
    readonly absolutePath: string;
    readonly execArgv: readonly string[];
    readonly kind: 'compiled-js' | 'source-ts';
}

export function resolveHostArtifact(
    name: string,
    execArgv: readonly string[] = process.execArgv,
): ResolvedHostArtifact {
    const cwd = process.cwd();
    const jsCandidates = [
        path.join(cwd, 'core', 'runtime', 'host', `${name}.js`),
        path.join(moduleDir(), 'host', `${name}.js`),
        path.join(moduleDir(), 'host', `${name}.mjs`),
    ];
    for (const candidate of jsCandidates) {
        if (fs.existsSync(candidate)) {
            return { absolutePath: candidate, execArgv: [], kind: 'compiled-js' };
        }
    }

    const tsCandidates = [
        path.join(moduleDir(), 'host', `${name}.ts`),
        path.join(cwd, 'src', 'core', 'runtime', 'host', `${name}.ts`),
    ];
    if (parentHasTsLoader(execArgv)) {
        for (const candidate of tsCandidates) {
            if (fs.existsSync(candidate)) {
                return {
                    absolutePath: candidate,
                    execArgv: [...execArgv],
                    kind: 'source-ts',
                };
            }
        }
    }

    throw new Error(
        `Runtime host artifact unavailable for '${name}'. ` +
            `Expected compiled JS at core/runtime/host/${name}.js (run slim-build).`,
    );
}

/**
 * Resolve an executable plugin entry under pluginDir.
 * Prefer existing .js; accept .ts only when parent has an explicit TS loader.
 * Never invent a path by string-replacing .ts → .js without existence check.
 */
export function resolvePluginEntryArtifact(
    pluginDir: string,
    entryRelative: string,
    execArgv: readonly string[] = process.execArgv,
): string {
    const root = path.resolve(pluginDir);
    const requested = path.resolve(root, entryRelative);
    const rel = path.relative(root, requested);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Entrypoint escapes pluginDir: ${entryRelative}`);
    }

    // Exact path if it exists and is executable for this environment
    if (fs.existsSync(requested)) {
        if (requested.endsWith('.ts') && !parentHasTsLoader(execArgv)) {
            throw new Error(
                `Plugin entry is TypeScript but no TS execution mechanism is active: ${requested}`,
            );
        }
        return requested;
    }

    // Prefer compiled .js sibling/name when requested .ts is missing (or vice versa only with loader)
    const base = requested.replace(/\.(ts|js|mjs|cjs)$/, '');
    const jsPath = `${base}.js`;
    if (fs.existsSync(jsPath)) {
        const relJs = path.relative(root, jsPath);
        if (!relJs.startsWith('..') && !path.isAbsolute(relJs)) {
            return jsPath;
        }
    }
    if (parentHasTsLoader(execArgv)) {
        const tsPath = `${base}.ts`;
        if (fs.existsSync(tsPath)) {
            const relTs = path.relative(root, tsPath);
            if (!relTs.startsWith('..') && !path.isAbsolute(relTs)) {
                return tsPath;
            }
        }
    }

    throw new Error(
        `Executable plugin entry not found under '${pluginDir}' for '${entryRelative}'. ` +
            `Expected a compiled .js artifact (run slim-build).`,
    );
}

/** @deprecated use resolvePluginEntryArtifact */
export function resolvePluginEntry(
    pluginDir: string,
    entryRelative: string,
): string {
    return resolvePluginEntryArtifact(pluginDir, entryRelative);
}
