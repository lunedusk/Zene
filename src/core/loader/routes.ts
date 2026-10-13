import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLogger } from '#core/utils/logger.js';
import { type IHeart } from '#core/heart/index.js';
import { BaseRoute } from '#core/bases/Route.js';

const log = getLogger('RouteLoader');

export class RouteLoader {
    private static async getFiles(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') log.warn(`Failed to read directory ${dir}: ${err.message}`);
            return [];
        });
        
        const paths = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                return this.getFiles(fullPath);
            }
            return fullPath.endsWith('.js') ? fullPath : [];
        }));

        return paths.flat();
    }

    public static async loadForPlugin(pluginDir: string, pluginId: string, heart: IHeart): Promise<void> {
        const routesDir = path.join(pluginDir, 'src', 'routes');
        const files = await this.getFiles(routesDir);

        if (files.length === 0) return;

        let loadedCount = 0;

        const loadPromises = files.map(async (file) => {
            try {
                const baseUrl = pathToFileURL(file).href;
                const importUrl = `${baseUrl}?v=${Date.now()}`;
                
                const Module = await import(importUrl);
                const RouteClass = Module.default;
                
                if (typeof RouteClass !== 'function' || !(RouteClass.prototype instanceof BaseRoute)) {
                    log.warn(`[${pluginId}] File ${path.basename(file)} does not export a BaseRoute class. Skipping.`);
                    return;
                }

                const instance: BaseRoute = new RouteClass(heart);
                
                if (typeof instance.basePath !== 'string') {
                    throw new TypeError(`Route class lacks a valid 'basePath' string property.`);
                }
                
                const cleanBasePath = instance.basePath.startsWith('/') 
                    ? instance.basePath.substring(1) 
                    : instance.basePath;
                
                const namespacedRoute = `/${cleanBasePath}`;
                
                heart.net.http.registerRouter(namespacedRoute, instance._buildRouter());

                loadedCount++;
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                log.error(`[${pluginId}] Failed to load API route ${path.basename(file)}: ${err.message}`);
            }
        });

        await Promise.all(loadPromises);

        if (loadedCount > 0) log.info(`[${pluginId}] Autoloaded ${loadedCount} REST API routes.`);
    }
}