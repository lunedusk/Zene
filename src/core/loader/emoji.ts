import fs from 'node:fs/promises';
import path from 'node:path';
import { type Client } from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import { EmojiSyncer } from '#core/helpers/emojiSync.js';

const log = getLogger('EmojiLoader');

export class EmojiLoader {
    private readonly pluginsDir: string;
    private readonly globalEmojiFile: string;

    constructor(baseDir: string = process.cwd()) {
        this.pluginsDir = path.join(baseDir, 'plugins');
        this.globalEmojiFile = path.join(baseDir, '.data', 'emojis.json');
    }

    public async init(client: Client): Promise<void> {
        log.info('Scanning plugins for emoji assets...');

        const foldersToSync: string[] = [];
        const programmaticEmojis: Record<string, string> = {};
        let pluginCount = 0;

        try {
            const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

            const scanPromises = entries.map(async (entry) => {
                if (!entry.isDirectory()) return;

                const pluginName = entry.name;
                const pluginDataDir = path.join(this.pluginsDir, pluginName, 'data');
                
                const localEmojiDir = path.join(pluginDataDir, 'emoji');
                const remoteEmojiFile = path.join(pluginDataDir, 'emoji.json');

                let hasAssets = false;

                try {
                    const stat = await fs.stat(localEmojiDir);
                    if (stat.isDirectory()) {
                        foldersToSync.push(localEmojiDir);
                        hasAssets = true;
                    }
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code !== 'ENOENT') {
                        log.warn(`[${pluginName}] Error accessing local emoji directory: ${err.message}`);
                    }
                }

                try {
                    const rawJson = await fs.readFile(remoteEmojiFile, 'utf-8');
                    const urlMap = JSON.parse(rawJson);
                    
                    if (typeof urlMap !== 'object' || urlMap === null || Array.isArray(urlMap)) {
                        throw new TypeError('Root of emoji.json must be a JSON object (dictionary).');
                    }
                    
                    for (const [emojiName, url] of Object.entries(urlMap)) {
                        if (typeof url !== 'string') continue;
                        
                        if (programmaticEmojis[emojiName]) {
                            log.warn(`[Conflict] Emoji '${emojiName}' from ${pluginName} overwrites a previous definition.`);
                        }
                        
                        programmaticEmojis[emojiName] = url;
                    }
                    hasAssets = true;

                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code === 'ENOENT') {
                        /* optional emoji.json absent — skip */
                    } else if (error instanceof SyntaxError) {
                        log.error(`[${pluginName}] Malformed emoji.json syntax. Skipping URL map.`);
                    } else {
                        const msg = error instanceof Error ? error.message : String(error);
                        log.error(`[${pluginName}] Failed to read emoji.json: ${msg}`);
                    }
                }

                if (hasAssets) pluginCount++;
            });

            await Promise.all(scanPromises);

            const totalUrls = Object.keys(programmaticEmojis).length;

            if (foldersToSync.length > 0 || totalUrls > 0) {
                log.info(`Found emoji assets in ${pluginCount} plugin(s). (${foldersToSync.length} folders, ${totalUrls} remote URLs)`);
                
                const syncer = new EmojiSyncer(
                    client, 
                    foldersToSync, 
                    this.globalEmojiFile, 
                    programmaticEmojis
                );
                
                await syncer.sync();
            } else {
                log.info('No plugin emojis found. Asset cache is up to date.');
            }

        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') {
                log.debug('Plugins directory not found. Skipping emoji loader.');
            } else {
                const msg = error instanceof Error ? error.message : String(error);
                log.error(`Critical failure during emoji discovery: ${msg}`);
            }
        }
    }
}

export const emojiLoader = new EmojiLoader();