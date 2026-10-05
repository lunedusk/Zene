import { isBuiltin, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);

interface ResolutionResult {
    shortCircuit: boolean;
    url: string;
}
const resolutionCache = new Map<string, ResolutionResult>();

interface ResolveContext {
    conditions: string[];
    parentURL?: string;
}
type NextResolve = (
    specifier: string,
    context: ResolveContext
) => Promise<{ url: string; format?: string | null; shortCircuit?: boolean }>;

export async function resolve(
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolve
): Promise<ResolutionResult> {
    const cacheKey = `${context.parentURL ?? ''}::${specifier}`;
    const cached = resolutionCache.get(cacheKey);
    if (cached) {
        return { shortCircuit: true, url: cached.url };
    }

    const isBareSpecifier =
        !specifier.startsWith('.') &&
        !specifier.startsWith('/') &&
        !specifier.startsWith('file://') &&
        !isBuiltin(specifier);

    if (isBareSpecifier && context.parentURL) {
        let parentPath = '';
        try {
            parentPath = fileURLToPath(context.parentURL);
        } catch {              }

        const pluginMatch = parentPath.replace(/\\/g, '/').match(/\/plugins\/([^/]+)/);

        if (pluginMatch) {
            const pluginId = pluginMatch[1];
            const sandboxNodeModules = path.join(process.cwd(), 'plugins', pluginId, 'node_modules');

            try {
                const absolutePath = require.resolve(specifier, { paths: [sandboxNodeModules] });
                const result: ResolutionResult = {
                    shortCircuit: true,
                    url: pathToFileURL(absolutePath).href
                };
                resolutionCache.set(cacheKey, result);
                return result;
            } catch {
            }
        }
    }

    try {
        const resolved = await nextResolve(specifier, context);
        const result: ResolutionResult = { shortCircuit: true, url: resolved.url };
        resolutionCache.set(cacheKey, result);
        return result;
    } catch (error: any) {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && isBareSpecifier && context.parentURL) {
            let parentPath = '';
            try {
                parentPath = fileURLToPath(context.parentURL);
            } catch {              }

            const pluginMatch = parentPath.replace(/\\/g, '/').match(/\/plugins\/([^/]+)/);
            if (pluginMatch) {
                throw new Error(
                    `[Plugin Engine] '${pluginMatch[1]}' requested '${specifier}' but it was not found in its sandbox OR globally.`
                );
            }
        }
        throw error;
    }
}