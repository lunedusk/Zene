import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import { FileWatcher, type WatchEvent } from '#core/watcher/index.js';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { emojis } from './emoji.js';
import {
    resolveGlobalPlaceholders,
    expandValue,
    redactExpandedForApi,
} from '#core/placeholder/index.js';
import { formatIssues, loadPluginLangRules, loadPluginLangSchema, validateValue } from '#core/validation/index.js';
import { guildLocale } from '#core/manager/guildLocale.js';

const log = getLogger('LanguageManager');
const SUPPORTED_LOCALES = new Set([
  'ab',
  'aa',
  'af',
  'ak',
  'sq',
  'am',
  'ar',
  'an',
  'hy',
  'as',
  'av',
  'ay',
  'az',
  'bm',
  'ba',
  'eu',
  'be',
  'bn',
  'bi',
  'bs',
  'br',
  'bg',
  'my',
  'ca',
  'ch',
  'ce',
  'ny',
  'zh',
  'cv',
  'kw',
  'co',
  'cr',
  'hr',
  'cs',
  'da',
  'dv',
  'nl',
  'dz',
  'en',
  'et',
  'ee',
  'fo',
  'fj',
  'fi',
  'fr',
  'fy',
  'ff',
  'gd',
  'gl',
  'lg',
  'ka',
  'de',
  'el',
  'kl',
  'gn',
  'gu',
  'ht',
  'ha',
  'he',
  'hz',
  'hi',
  'ho',
  'hu',
  'is',
  'ig',
  'id',
  'iu',
  'ik',
  'ga',
  'it',
  'ja',
  'jv',
  'kn',
  'kr',
  'ks',
  'kk',
  'km',
  'ki',
  'rw',
  'ky',
  'kv',
  'kg',
  'ko',
  'kj',
  'ku',
  'lo',
  'lv',
  'li',
  'ln',
  'lt',
  'lu',
  'lb',
  'mk',
  'mg',
  'ms',
  'ml',
  'mt',
  'gv',
  'mi',
  'mr',
  'mh',
  'mn',
  'na',
  'nv',
  'nd',
  'nr',
  'ng',
  'ne',
  'no',
  'nb',
  'nn',
  'oc',
  'oj',
  'or',
  'om',
  'os',
  'ps',
  'fa',
  'pl',
  'pt',
  'pa',
  'qu',
  'ro',
  'rm',
  'rn',
  'ru',
  'se',
  'sm',
  'sg',
  'sc',
  'sr',
  'sn',
  'sd',
  'si',
  'sk',
  'sl',
  'so',
  'st',
  'es',
  'su',
  'sw',
  'ss',
  'sv',
  'tl',
  'ty',
  'tg',
  'ta',
  'tt',
  'te',
  'th',
  'bo',
  'ti',
  'to',
  'ts',
  'tn',
  'tr',
  'tk',
  'tw',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'wa',
  'cy',
  'wo',
  'xh',
  'ii',
  'yi',
  'yo',
  'za',
  'zu',

  'en-US',
  'en-GB',
  'en-AU',
  'en-CA',
  'es-ES',
  'es-MX',
  'es-AR',
  'pt-BR',
  'pt-PT',
  'fr-FR',
  'fr-CA',
  'de-DE',
  'de-AT',
  'de-CH',
  'zh-CN',
  'zh-TW',
  'zh-HK',
]);

export type TranslationVars = Record<string, string | number | boolean>;
export type CompiledTranslation = (vars?: TranslationVars) => string;

function pluginIdFromLangNamespace(namespace: string): string | null {
    return namespace || null;
}

export class LanguageManager {
    private readonly dictionary = new Map<string, Map<string, Map<string, CompiledTranslation>>>();
    private readonly liveNamespaces = new Map<string, Map<string, Record<string, CompiledTranslation>>>();
    private readonly rawStore = new Map<string, Map<string, unknown>>();
    private readonly runtimeStore = new Map<string, Map<string, unknown>>();
    private readonly targetDir: string;
    private watcher: FileWatcher | null = null;
    private readonly loadLocks = new Set<string>();
    private readonly langValidationFailures = new Map<string, string[]>();

    constructor(targetDir?: string) {
        this.targetDir = targetDir ? path.resolve(targetDir) : path.join(process.cwd(), 'configuration', 'lang');
    }

    public async init(hotReload: boolean = false): Promise<void> {
        log.info('Initializing Language Manager...');
        await fs.mkdir(this.targetDir, { recursive: true });
        this.langValidationFailures.clear();
        const files = await fs.readdir(this.targetDir);
        let loadedCount = 0;
        const loadPromises = files
            .filter(file => file.endsWith('.json5'))
            .map(file => this.loadFile(path.join(this.targetDir, file)).then(ok => { if (ok) loadedCount++; }));
        await Promise.all(loadPromises);
        log.info(`Language Manager initialized with ${loadedCount} namespaces.`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('lang.loaded', { namespaces: loadedCount }))
            .catch(() => undefined);

        if (hotReload) {
            this.watcher = new FileWatcher(this.targetDir, { includePatterns: ['**/*.json5'] });
            this.watcher.on('events', async (events: WatchEvent[]) => {
                for (const event of events) {
                    if (event.type === 'deleted') {
                        this.unloadPath(event.path);
                    } else {
                        if (!this.loadLocks.has(event.path)) {
                            this.loadLocks.add(event.path);
                            await this.loadFile(event.path);
                            const unlock = setTimeout(() => this.loadLocks.delete(event.path), 100);
                            unlock.unref();
                        }
                    }
                }
            });
            this.watcher.start();
            log.info(`Language Manager hot-reload active.`);
        }
    }

    private parseFilename(filename: string): { namespace: string; locale: string } | null {
        const baseName = path.basename(filename, '.json5');
        const lastUnderscoreIdx = baseName.lastIndexOf('_');
        if (lastUnderscoreIdx === -1) {
            log.warn(`Invalid language file format [${baseName}]. Expected: 'namespace_locale.json5'`);
            return null;
        }
        const namespace = baseName.substring(0, lastUnderscoreIdx);
        const locale = baseName.substring(lastUnderscoreIdx + 1);
        if (!SUPPORTED_LOCALES.has(locale)) {
            log.warn(`Unknown locale code '${locale}' in file ${filename}. Using as custom locale.`);
        }
        return { namespace, locale };
    }

    private async loadFile(filePath: string): Promise<boolean> {
        const meta = this.parseFilename(filePath);
        if (!meta) return false;

        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const data = JSON5.parse(raw);

            const expanded = expandValue(JSON5.parse(JSON5.stringify(data)), {
                failClosed: undefined,
                resolveEmoji: false,
                collectUntaggedRand: false,
                softMiss: 'absent',
            }).value;

            const pluginId = pluginIdFromLangNamespace(meta.namespace);
            const schema = await loadPluginLangSchema(pluginId, meta.locale);
            const rules = await loadPluginLangRules(pluginId, meta.locale);
            const validated = await validateValue(expanded, {
                kind: 'lang',
                filePath,
                name: path.basename(filePath),
                pluginId,
                locale: meta.locale,
                namespace: meta.namespace
            }, schema, rules);

            if (!validated.ok) {
                log.error(
                    `Lang validation failed [${path.basename(filePath)}]: ${formatIssues(validated.issues)}`
                );
                this.recordLangFailure(pluginId, path.basename(filePath));
                if (pluginId) {
                    log.error(`[${pluginId}] Plugin will be DISABLED due to invalid language file.`);
                }
                return false;
            }

            const runtimeTree = validated.data as Record<string, unknown>;

            if (!this.rawStore.has(meta.locale)) {
                this.rawStore.set(meta.locale, new Map());
            }
            this.rawStore.get(meta.locale)!.set(meta.namespace, data);

            if (!this.runtimeStore.has(meta.locale)) {
                this.runtimeStore.set(meta.locale, new Map());
            }
            this.runtimeStore.get(meta.locale)!.set(meta.namespace, runtimeTree);

            const flatMap = new Map<string, CompiledTranslation>();
            this.flattenAndCompile(runtimeTree, '', flatMap);

            if (!this.dictionary.has(meta.locale)) {
                this.dictionary.set(meta.locale, new Map());
            }
            this.dictionary.get(meta.locale)!.set(meta.namespace, flatMap);

            if (!this.liveNamespaces.has(meta.locale)) {
                this.liveNamespaces.set(meta.locale, new Map());
            }
            const localeMap = this.liveNamespaces.get(meta.locale)!;
            if (!localeMap.has(meta.namespace)) {
                localeMap.set(meta.namespace, {});
            }
            const liveRef = localeMap.get(meta.namespace)!;
            for (const key in liveRef) {
                if (Object.prototype.hasOwnProperty.call(liveRef, key)) delete liveRef[key];
            }
            Object.assign(liveRef, Object.fromEntries(flatMap));
            log.debug(`Loaded [${meta.locale}] namespace: '${meta.namespace}' (${flatMap.size} keys)`);
            return true;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Failed to parse ${path.basename(filePath)}: ${err.message}`);
            return false;
        }
    }

    private unloadPath(filePath: string): void {
        const meta = this.parseFilename(filePath);
        if (!meta) return;
        const localeMap = this.dictionary.get(meta.locale);
        if (localeMap) {
            localeMap.delete(meta.namespace);
            log.info(`Unloaded [${meta.locale}] namespace: '${meta.namespace}'`);
            if (localeMap.size === 0) this.dictionary.delete(meta.locale);
        }
        const liveLocaleMap = this.liveNamespaces.get(meta.locale);
        const liveRef = liveLocaleMap?.get(meta.namespace);
        if (liveRef) {
            for (const key in liveRef) {
                if (Object.prototype.hasOwnProperty.call(liveRef, key)) delete liveRef[key];
            }
        }
        const rawLocale = this.rawStore.get(meta.locale);
        if (rawLocale) {
            rawLocale.delete(meta.namespace);
            if (rawLocale.size === 0) this.rawStore.delete(meta.locale);
        }
        const runtimeLocale = this.runtimeStore.get(meta.locale);
        if (runtimeLocale) {
            runtimeLocale.delete(meta.namespace);
            if (runtimeLocale.size === 0) this.runtimeStore.delete(meta.locale);
        }
    }

    public getLoadedNamespaces(): string[] {
        const namespaces = new Set<string>();
        for (const localeMap of this.liveNamespaces.values()) {
            for (const ns of localeMap.keys()) namespaces.add(ns);
        }
        return Array.from(namespaces);
    }

    public dumpSnapshot(): Array<{ locale: string; namespace: string; raw: unknown }> {
        const entries: Array<{ locale: string; namespace: string; raw: unknown }> = [];
        for (const [locale, nsMap] of this.runtimeStore.entries()) {
            for (const [namespace, runtime] of nsMap.entries()) {
                entries.push({
                    locale,
                    namespace,
                    raw: JSON5.parse(JSON5.stringify(runtime)),
                });
            }
        }
        return entries;
    }

    public applySnapshot(
        entries: ReadonlyArray<{ locale: string; namespace: string; raw: unknown }>,
    ): void {
        this.dictionary.clear();
        this.rawStore.clear();
        this.runtimeStore.clear();
        for (const [, liveLocaleMap] of this.liveNamespaces) {
            for (const [, liveRef] of liveLocaleMap) {
                for (const key of Object.keys(liveRef)) {
                    delete liveRef[key];
                }
            }
        }
        this.liveNamespaces.clear();

        for (const entry of entries) {
            const data = entry.raw;
            const expanded = expandValue(JSON5.parse(JSON5.stringify(data)), {
                failClosed: undefined,
                resolveEmoji: false,
                collectUntaggedRand: false,
                softMiss: 'absent',
            }).value;
            const runtimeTree =
                expanded && typeof expanded === 'object' && !Array.isArray(expanded)
                    ? (expanded as Record<string, unknown>)
                    : {};

            if (!this.rawStore.has(entry.locale)) {
                this.rawStore.set(entry.locale, new Map());
            }
            this.rawStore.get(entry.locale)!.set(entry.namespace, data);

            if (!this.runtimeStore.has(entry.locale)) {
                this.runtimeStore.set(entry.locale, new Map());
            }
            this.runtimeStore.get(entry.locale)!.set(entry.namespace, runtimeTree);

            const flatMap = new Map<string, CompiledTranslation>();
            this.flattenAndCompile(runtimeTree, '', flatMap);

            if (!this.dictionary.has(entry.locale)) {
                this.dictionary.set(entry.locale, new Map());
            }
            this.dictionary.get(entry.locale)!.set(entry.namespace, flatMap);

            if (!this.liveNamespaces.has(entry.locale)) {
                this.liveNamespaces.set(entry.locale, new Map());
            }
            const localeMap = this.liveNamespaces.get(entry.locale)!;
            if (!localeMap.has(entry.namespace)) {
                localeMap.set(entry.namespace, {});
            }
            const liveRef = localeMap.get(entry.namespace)!;
            for (const key of Object.keys(liveRef)) {
                delete liveRef[key];
            }
            Object.assign(liveRef, Object.fromEntries(flatMap));
        }

        log.info(`Language snapshot applied (${entries.length} entries, no disk I/O)`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) => eventBus.emitConcurrent('lang.snapshot.applied', { entries: entries.length }))
            .catch(() => undefined);

    }

    private flattenAndCompile(obj: Record<string, unknown>, prefix = '', res: Map<string, CompiledTranslation>): void {
        for (const [key, value] of Object.entries(obj)) {
            if (key === '__proto__' || key === 'constructor') continue;
            const newKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                this.flattenAndCompile(value as Record<string, unknown>, newKey, res);
            } else {
                res.set(newKey, this.compileString(String(value)));
            }
        }
    }

    private compileString(template: string): CompiledTranslation {
        if (!template.includes('{{')) {
            return () => resolveGlobalPlaceholders(emojis.parse(template));
        }
        const parts: Array<string | { varName: string }> = [];
        let lastIndex = 0;
        for (const match of template.matchAll(/\{\{\s*([^}]+)\s*\}\}/g)) {
            if (match.index > lastIndex) parts.push(template.slice(lastIndex, match.index));
            parts.push({ varName: match[1].trim() });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < template.length) parts.push(template.slice(lastIndex));
        return (vars?: TranslationVars) => {
            let result = '';
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (typeof part === 'string') result += part;
                else {
                    const val = vars?.[part.varName];
                    result += val !== undefined ? String(val) : `{{${part.varName}}}`;
                }
            }
            return resolveGlobalPlaceholders(emojis.parse(result));
        };
    }

    public async reloadFile(namespace: string, locale?: string): Promise<boolean> {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = locale || masterLocale;
        const filename = `${namespace}_${targetLocale}.json5`;
        const filePath = path.join(this.targetDir, filename);
        try {
            await fs.access(filePath);
            log.debug(`Manually reloading language file: [${filename}]`);
            return await this.loadFile(filePath);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Manual reload failed for [${filename}]: ${err.message}`);
            return false;
        }
    }

    public async reloadAll(): Promise<boolean> {
        log.info('Initiating global language cache refresh...');
        try {
            const files = await fs.readdir(this.targetDir);
            const targetFiles = files.filter(file => file.endsWith('.json5'));
            if (targetFiles.length === 0) {
                log.warn('ReloadAll aborted: No language files found in target directory.');
                return false;
            }
            const results = await Promise.all(
                targetFiles.map(file => this.loadFile(path.join(this.targetDir, file)))
            );
            const success = results.filter(Boolean).length;
            const failed = results.length - success;
            log.info(`Global reload complete. Success: ${success}, Failed: ${failed}`);
            return failed === 0;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Critical failure during global language reload: ${err.message}`);
            return false;
        }
    }

    public wipeCache(locale?: string): void {
        if (locale) {
            this.dictionary.delete(locale);
            const liveLocaleMap = this.liveNamespaces.get(locale);
            if (liveLocaleMap) {
                for (const [, liveRef] of liveLocaleMap) {
                    for (const key in liveRef) delete liveRef[key];
                }
                this.liveNamespaces.delete(locale);
            }
            this.rawStore.delete(locale);
            this.runtimeStore.delete(locale);
            log.warn(`Language cache for locale [${locale}] has been purged.`);
        } else {
            this.dictionary.clear();
            for (const [, liveLocaleMap] of this.liveNamespaces) {
                for (const [, liveRef] of liveLocaleMap) {
                    for (const key in liveRef) delete liveRef[key];
                }
            }
            this.liveNamespaces.clear();
            this.rawStore.clear();
            this.runtimeStore.clear();
            log.warn('Global language dictionary has been purged.');
        }
    }

    public getRaw(namespace: string, locale?: string): Record<string, unknown> | null {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = locale || masterLocale;
        const fallbacks = [targetLocale];
        const baseLocale = targetLocale.split('-')[0];
        if (baseLocale !== targetLocale) fallbacks.push(baseLocale);
        if (masterLocale !== targetLocale && masterLocale !== baseLocale) fallbacks.push(masterLocale);
        if (!fallbacks.includes('en')) fallbacks.push('en');
        for (const loc of fallbacks) {
            const tree = this.rawStore.get(loc)?.get(namespace);
            if (tree !== undefined) {
                return JSON5.parse(JSON5.stringify(tree)) as Record<string, unknown>;
            }
        }
        return null;
    }

    public getRedacted(namespace: string, locale?: string): Record<string, unknown> | null {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = locale || masterLocale;
        const fallbacks = [targetLocale];
        const baseLocale = targetLocale.split('-')[0];
        if (baseLocale !== targetLocale) fallbacks.push(baseLocale);
        if (masterLocale !== targetLocale && masterLocale !== baseLocale) fallbacks.push(masterLocale);
        if (!fallbacks.includes('en')) fallbacks.push('en');
        for (const loc of fallbacks) {
            const tree = this.runtimeStore.get(loc)?.get(namespace);
            if (tree !== undefined) {
                return redactExpandedForApi(tree) as Record<string, unknown>;
            }
        }
        return null;
    }

    public getNamespace(namespace: string, locale?: string): Readonly<Record<string, CompiledTranslation>> | null {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = locale || masterLocale;
        const localeMap = this.liveNamespaces.get(targetLocale);
        if (!localeMap) return null;
        const ns = localeMap.get(namespace);
        return ns ?? null;
    }

    public get(namespace: string, key: string, variables?: TranslationVars, requestedLocale?: string): string {
        const masterLocale = secrets.getOptional('DefaultLocale') || 'en';
        const targetLocale = guildLocale.resolveLocale(undefined, requestedLocale ?? null);
        const fallbacks = [targetLocale];
        const baseLocale = targetLocale.split('-')[0];
        if (baseLocale !== targetLocale) fallbacks.push(baseLocale);
        if (masterLocale !== targetLocale && masterLocale !== baseLocale) fallbacks.push(masterLocale);
        if (!fallbacks.includes('en')) fallbacks.push('en');
        for (let i = 0; i < fallbacks.length; i++) {
            const loc = fallbacks[i];
            const compiledFn = this.dictionary.get(loc)?.get(namespace)?.get(key);
            if (compiledFn) return compiledFn(variables);
        }
        log.warn(`Missing translation key: [${namespace}] -> '${key}'`);
        return `${namespace}:${key}`;
    }

    private recordLangFailure(pluginId: string | null, fileLabel: string): void {
        if (!pluginId) return;
        const list = this.langValidationFailures.get(pluginId) ?? [];
        if (!list.includes(fileLabel)) list.push(fileLabel);
        this.langValidationFailures.set(pluginId, list);
    }

    public getLangValidationFailures(): ReadonlyMap<string, readonly string[]> {
        return this.langValidationFailures;
    }

    public hasLangValidationFailure(pluginId: string): boolean {
        const list = this.langValidationFailures.get(pluginId);
        return !!list && list.length > 0;
    }

    public clearLangValidationFailures(): void {
        this.langValidationFailures.clear();
    }
}

export const i18n = new LanguageManager();
