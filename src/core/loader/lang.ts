import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { getLogger } from '#core/utils/logger.js';
import { formatIssues, loadPluginLangRules, loadPluginLangSchema, validateValue } from '#core/validation/index.js';
import { expandValue } from '#core/placeholder/index.js';
import { mergePreserveObject } from '#core/loader/mergePreserve.js';
import { writeJson5Preserving, writeJson5Wholesale } from '#core/loader/json5SurgicalWrite.js';

const log = getLogger('LangLoader');
type JsonObject = Record<string, any>;

export class LangLoader {
    private readonly globalLangDir: string;
    private readonly pluginsDir: string;

    constructor(baseDir: string = process.cwd()) {
        this.globalLangDir = path.join(baseDir, 'configuration', 'lang');
        this.pluginsDir = path.join(baseDir, 'plugins');
    }

    private formatLangName(pluginId: string, originalName: string): string {
        const locale = path.basename(originalName, '.json5');
        const safePluginId = pluginId.replace(/[^a-zA-Z0-9_-]/g, '');
        return `${safePluginId}_${locale}.json5`;
    }

    private async atomicWrite(targetPath: string, data: JsonObject): Promise<void> {
        await writeJson5Preserving(targetPath, data);
    }

    private async atomicWriteNew(targetPath: string, data: JsonObject): Promise<void> {
        await writeJson5Wholesale(targetPath, data);
    }

    private async validateLang(pluginId: string, filePath: string, data: unknown, locale?: string) {
        const loc = locale || path.basename(filePath, '.json5');
        const schema = await loadPluginLangSchema(pluginId, loc);
        const rules = await loadPluginLangRules(pluginId, loc);
        const forValidation = expandValue(data, {
            failClosed: false,
            resolveEmoji: false,
            collectUntaggedRand: false,
            softMiss: 'absent',
        }).value;
        const result = await validateValue(forValidation, {
            kind: 'lang',
            filePath,
            pluginId,
            name: path.basename(filePath),
            locale: loc
        }, schema, rules);
        if (!result.ok) return { ok: false as const, message: formatIssues(result.issues) };
        return { ok: true as const, data: data as JsonObject };
    }

    public async syncPlugin(pluginDir: string, pluginId: string): Promise<void> {
        const sourceLangDir = path.join(pluginDir, 'data', 'configuration', 'lang');
        try {
            const files = await fs.readdir(sourceLangDir).catch((err) =>
                err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT'
                    ? null
                    : Promise.reject(err),
            );
            if (!files) return;
            const json5Files = files.filter((f: string) => f.endsWith('.json5'));
            if (!json5Files.length) return;
            await fs.mkdir(this.globalLangDir, { recursive: true });

            for (const file of json5Files) {
                const sourcePath = path.join(sourceLangDir, file);
                const targetName = this.formatLangName(pluginId, file);
                const targetPath = path.join(this.globalLangDir, targetName);
                const locale = path.basename(file, '.json5');

                let defaultLang: JsonObject;
                try {
                    defaultLang = JSON5.parse(await fs.readFile(sourcePath, 'utf-8'));
                } catch {
                    log.error(`[${pluginId}] Malformed default language file: ${file}. Skipping sync.`);
                    continue;
                }

                const defOk = await this.validateLang(pluginId, sourcePath, defaultLang, locale);
                if (!defOk.ok) {
                    log.warn(
                        `[${pluginId}] Default lang has validation issues (${file}): ${defOk.message}. Continuing merge using raw default as structure donor.`,
                    );
                } else {
                    defaultLang = defOk.data;
                }

                let userLang: JsonObject | null = null;
                let userMissing = false;
                try {
                    userLang = JSON5.parse(await fs.readFile(targetPath, 'utf-8'));
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code === 'ENOENT') {
                        userMissing = true;
                    } else if (error instanceof SyntaxError) {
                        log.warn(`[${pluginId}] Global translation ${targetName} corrupted; backup and reset from default.`);
                        await fs.rename(targetPath, `${targetPath}.corrupted.bak`).catch(() => undefined);
                        userMissing = true;
                    } else {
                        throw error;
                    }
                }

                if (userMissing || !userLang) {
                    await this.atomicWriteNew(targetPath, defaultLang);
                    const freshOk = await this.validateLang(pluginId, targetPath, defaultLang, locale);
                    if (!freshOk.ok) {
                        log.error(
                            `[${pluginId}] Fresh global translation ${targetName} still invalid: ${freshOk.message}`,
                        );
                    } else {
                        log.info(`[${pluginId}] Generated fresh global translation: ${targetName}`);
                    }
                    continue;
                }

                const mutations: string[] = [];
                const merged = mergePreserveObject(
                    defaultLang as Record<string, unknown>,
                    userLang as Record<string, unknown>,
                    mutations,
                ) as JsonObject;

                const mergedOk = await this.validateLang(pluginId, targetPath, merged, locale);
                if (!mergedOk.ok) {
                    log.error(
                        `[${pluginId}] Merged lang has validation issues (${targetName}): ${mergedOk.message}`,
                    );
                }

                if (mutations.length > 0) {
                    const mode = await writeJson5Preserving(targetPath, merged);
                    log.info(
                        `[${pluginId}] Synced language file ${targetName} (${mode}). Applied ${mutations.length} updates.`,
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
            log.error(`[${pluginId}] Language sync failure: ${(error as Error).message}`);
        }
    }

    public async syncAll(): Promise<void> {
        log.info('Initializing Global Language Sync...');
        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
            await Promise.all(entries.map(async (entry) => {
                if (!entry.isDirectory()) return;
                const pluginDir = path.join(this.pluginsDir, entry.name);
                try {
                    const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf-8'));
                    await this.syncPlugin(pluginDir, manifest?.id || entry.name);
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code !== 'ENOENT') log.warn(`[${entry.name}] Failed to read manifest: ${err.message}`);
                }
            }));
            log.info('Global Language Sync complete.');
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') log.error(`Failed to scan plugins directory: ${err.message}`);
        }
    }
}

export const langLoader = new LangLoader();
