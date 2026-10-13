import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { getLogger } from '#core/utils/logger.js';
import { formatIssues, loadPluginConfigRules, loadPluginConfigSchema, validateValue } from '#core/validation/index.js';
import { expandValue } from '#core/placeholder/index.js';
import { mergePreserveObject } from '#core/loader/mergePreserve.js';
import { writeJson5Preserving, writeJson5Wholesale } from '#core/loader/json5SurgicalWrite.js';

const log = getLogger('ConfigLoader');
type JsonObject = Record<string, any>;

export class ConfigLoader {
    private readonly globalConfigDir: string;
    private readonly pluginsDir: string;

    constructor(baseDir: string = process.cwd()) {
        this.globalConfigDir = path.join(baseDir, 'configuration');
        this.pluginsDir = path.join(baseDir, 'plugins');
    }

    private formatConfigName(pluginId: string, originalName: string): string {
        const baseName = path.basename(originalName, '.json5');
        let cleanedName = baseName
            .replace(/(?:^|[-_])config(?:[-_]|$)/gi, '-')
            .replace(/[-_]+/g, '-')
            .replace(/^-|-$/g, '');
        if (!cleanedName) return `${pluginId}.json5`;
        return `${pluginId}-${cleanedName}.json5`;
    }

    private async atomicWrite(targetPath: string, data: JsonObject): Promise<void> {
        await writeJson5Preserving(targetPath, data);
    }

    private async atomicWriteNew(targetPath: string, data: JsonObject): Promise<void> {
        await writeJson5Wholesale(targetPath, data);
    }

    private async validatePluginConfig(pluginId: string, filePath: string, data: unknown, fromLocalStem = false) {
        const base = path.basename(filePath, '.json5');
        const schema = await loadPluginConfigSchema(pluginId, base, fromLocalStem);
        const rules = await loadPluginConfigRules(pluginId, base, fromLocalStem);
        const forValidation = expandValue(data, {
            failClosed: false,
            resolveEmoji: false,
            collectUntaggedRand: false,
            softMiss: 'absent',
        }).value;
        const result = await validateValue(
            forValidation,
            { kind: 'config', filePath, pluginId, name: path.basename(filePath) },
            schema,
            rules
        );
        if (!result.ok) return { ok: false as const, message: formatIssues(result.issues) };
        return { ok: true as const, data: data as JsonObject };
    }

    public async syncPlugin(pluginDir: string, pluginId: string): Promise<void> {
        const sourceConfigDir = path.join(pluginDir, 'data', 'configuration');
        try {
            const files = await fs.readdir(sourceConfigDir).catch(err => err.code === 'ENOENT' ? null : Promise.reject(err));
            if (!files) return;
            const json5Files = files.filter((f: string) => f.endsWith('.json5'));
            if (!json5Files.length) return;
            await fs.mkdir(this.globalConfigDir, { recursive: true });

            for (const file of json5Files) {
                const sourcePath = path.join(sourceConfigDir, file);
                const targetName = this.formatConfigName(pluginId, file);
                const targetPath = path.join(this.globalConfigDir, targetName);
                let defaultConfig: JsonObject;
                try {
                    defaultConfig = JSON5.parse(await fs.readFile(sourcePath, 'utf-8'));
                } catch {
                    log.error(`[${pluginId}] Malformed default config: ${file}. Skipping sync.`);
                    continue;
                }
                const defOk = await this.validatePluginConfig(pluginId, sourcePath, defaultConfig, true);
                if (!defOk.ok) {
                    log.warn(
                        `[${pluginId}] Default config has validation issues (${file}): ${defOk.message}. Continuing merge using raw default as structure donor.`,
                    );
                } else {
                    defaultConfig = defOk.data;
                }

                let userConfig: JsonObject | null = null;
                let userMissing = false;
                try {
                    userConfig = JSON5.parse(await fs.readFile(targetPath, 'utf-8'));
                } catch (err: unknown) {
                    const e = err as NodeJS.ErrnoException;
                    if (e.code === 'ENOENT') {
                        userMissing = true;
                    } else if (err instanceof SyntaxError) {
                        log.warn(`[${pluginId}] User config ${targetName} corrupted; backup and reset.`);
                        await fs.rename(targetPath, `${targetPath}.corrupted.bak`).catch(() => undefined);
                        userMissing = true;
                    } else {
                        throw err;
                    }
                }

                if (userMissing || !userConfig) {
                    await this.atomicWriteNew(targetPath, defaultConfig);
                    const freshOk = await this.validatePluginConfig(pluginId, targetPath, defaultConfig, false);
                    if (!freshOk.ok) {
                        log.error(
                            `[${pluginId}] Fresh global config ${targetName} still invalid: ${freshOk.message}`,
                        );
                    } else {
                        log.info(`[${pluginId}] Generated fresh global config: ${targetName}`);
                    }
                    continue;
                }

                const mutations: string[] = [];
                const merged = mergePreserveObject(
                    defaultConfig as Record<string, unknown>,
                    userConfig as Record<string, unknown>,
                    mutations,
                ) as JsonObject;

                const mergedOk = await this.validatePluginConfig(pluginId, targetPath, merged, false);
                if (!mergedOk.ok) {
                    log.error(
                        `[${pluginId}] Merged config has validation issues (${targetName}): ${mergedOk.message}`,
                    );
                }

                if (mutations.length > 0) {
                    const mode = await writeJson5Preserving(targetPath, merged);
                    log.info(
                        `[${pluginId}] synced ${targetName} (${mode}). Applied ${mutations.length} updates.`,
                    );
                    for (const m of mutations) {
                        if (m.startsWith('[Type Mismatch]')) log.warn(`[${pluginId}] ${m}`);
                        else if (m.startsWith('[Missing Key]')) log.info(`[${pluginId}] ${m}`);
                    }
                } else if (!mergedOk.ok) {
                    log.warn(
                        `[${pluginId}] No structural mutations for ${targetName}, but validation failed — check schema/rules vs content.`,
                    );
                }
            }
        } catch (error: unknown) {
            log.error(`[${pluginId}] Config sync failure: ${(error as Error).message}`);
        }
    }

    public async syncAll(): Promise<void> {
        log.info('Initializing Global Configuration Sync...');
        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
            await Promise.all(entries.map(async (entry) => {
                if (!entry.isDirectory()) return;
                const pluginDir = path.join(this.pluginsDir, entry.name);
                try {
                    const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf-8'));
                    await this.syncPlugin(pluginDir, manifest?.id || entry.name);
                } catch (err: any) {
                    if (err.code !== 'ENOENT') log.warn(`[${entry.name}] Failed to read manifest: ${err.message}`);
                }
            }));
            log.info('Global Configuration Sync complete.');
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') log.error(`Failed to scan plugins directory: ${err.message}`);
        }
    }
}

export const configLoader = new ConfigLoader();
