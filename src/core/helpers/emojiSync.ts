import fs from 'node:fs/promises';
import path from 'node:path';
import { type Client, type RateLimitData, type ApplicationEmoji, DiscordAPIError } from 'discord.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('EmojiSync');

const MAX_FILE_SIZE = 256 * 1024;
const MAX_APP_EMOJIS = 2000;
const VALID_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

interface UploadTask {
    safeName: string;
    type: 'file' | 'url';
    target: string;
}

export class EmojiSyncer {
    private readonly client: Client;
    private readonly jsonPath: string;
    private readonly folders: string[];
    private readonly programmaticEmojis: Record<string, string>;
    
    private startTime = 0;
    private totalTasks = 0;
    private completedTasks = 0;
    private failedTasks = 0;

    constructor(
        client: Client, 
        emojiFolders: string[], 
        jsonPath: string, 
        programmaticEmojis: Record<string, string> = {}
    ) {
        this.client = client;
        this.folders = emojiFolders;
        this.jsonPath = jsonPath;
        this.programmaticEmojis = programmaticEmojis;
    }

    private sanitizeName(name: string): string {
        let cleanName = name.replace(/[^a-zA-Z0-9_]/g, '');
        if (cleanName.length < 2) cleanName += '_emoji';
        return cleanName.slice(0, 32);
    }

    private formatETA(ms: number): string {
        if (!isFinite(ms) || ms <= 0) return 'calculating...';
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    private logProgress(currentFile: string): void {
        const elapsed = Date.now() - this.startTime;
        const avgTimePerTask = this.completedTasks > 0 ? elapsed / this.completedTasks : 0;
        const remainingTasks = this.totalTasks - this.completedTasks;
        const etaMs = avgTimePerTask * remainingTasks;
        
        const percent = ((this.completedTasks / this.totalTasks) * 100).toFixed(1);
        
        log.info(
            `[Sync] ${this.completedTasks}/${this.totalTasks} (${percent}%) ` +
            `| ETA: ${this.formatETA(etaMs)} ` +
            `| Fails: ${this.failedTasks} ` +
            `| Processing: :${currentFile}:`
        );
    }

    private async atomicWrite(targetPath: string, data: any): Promise<void> {
        const tempPath = `${targetPath}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(tempPath, JSON.stringify(data, null, 4), 'utf-8');
            await fs.rename(tempPath, targetPath);
        } catch (error: unknown) {
            await fs.unlink(tempPath).catch(() => {});
            throw error;
        }
    }

    private processUrlMap(
        urlMap: Record<string, string>,
        appEmojisMap: Map<string, ApplicationEmoji>,
        tasks: UploadTask[],
        queuedUploads: Set<string>,
        sourceName: string
    ): void {
        for (const [name, url] of Object.entries(urlMap)) {
            const safeName = this.sanitizeName(name);
            
            if (appEmojisMap.has(safeName) || queuedUploads.has(safeName)) continue;

            try { 
                new URL(url); 
            } catch { 
                log.warn(`[${sourceName}] Invalid URL format for emoji '${name}': ${url}`);
                continue; 
            }

            tasks.push({ safeName, type: 'url', target: url });
            queuedUploads.add(safeName);
        }
    }

    public async sync(): Promise<void> {
        if (!this.client.isReady() || !this.client.application) {
            log.error('EmojiSyncer: Client/Application not ready.');
            return;
        }

        const rateLimitHandler = (data: RateLimitData) => {
            log.warn(`[REST] Rate limit hit. Route: ${data.route} | Method: ${data.method} | Reset: ${data.timeToReset}ms`);
            if (data.global) {
                log.error('GLOBAL Rate limit hit. All bot network traffic is being throttled by Discord.');
            }
        };
        this.client.rest.on('rateLimited', rateLimitHandler);

        try {
            await fs.mkdir(path.dirname(this.jsonPath), { recursive: true });
            
            const rawAppEmojis = await this.client.application.emojis.fetch();
            const appEmojisMap = new Map<string, ApplicationEmoji>();
            const validEmojiIds = new Set<string>();

            for (const [_, emoji] of rawAppEmojis) {
                if (emoji.name) {
                    appEmojisMap.set(emoji.name, emoji);
                    validEmojiIds.add(emoji.id);
                }
            }

            const finalEmojiData: Record<string, string> = {};

            try {
                const raw = await fs.readFile(this.jsonPath, 'utf-8');
                const existing = JSON.parse(raw);

                for (const [key, val] of Object.entries(existing)) {
                    if (typeof val !== 'string') continue;

                    const match = val.match(/<a?:[a-zA-Z0-9_]+:(\d+)>/);
                    if (match) {
                        const emojiId = match[1];
                        if (validEmojiIds.has(emojiId)) {
                            finalEmojiData[key] = val;
                        } else {
                            log.debug(`[Purge] Removed dead/foreign emoji reference: ${key}`);
                        }
                    } else {
                        finalEmojiData[key] = val;
                    }
                }
            } catch {
                log.debug('Starting with a fresh emoji map.');
            }

            for (const [name, emoji] of appEmojisMap) {
                finalEmojiData[name] = emoji.toString();
            }

            const tasks: UploadTask[] = [];
            const queuedUploads = new Set<string>();

            if (Object.keys(this.programmaticEmojis).length > 0) {
                this.processUrlMap(this.programmaticEmojis, appEmojisMap, tasks, queuedUploads, 'Programmatic Payload');
            }

            for (const folder of this.folders) {
                const files = await fs.readdir(folder).catch(() => []);
                
                for (const fileName of files) {
                    const fullPath = path.join(folder, fileName);

                    if (fileName === 'emoji.json') {
                        try {
                            const rawJson = await fs.readFile(fullPath, 'utf-8');
                            const urlMap: Record<string, string> = JSON.parse(rawJson);
                            this.processUrlMap(urlMap, appEmojisMap, tasks, queuedUploads, `File: ${folder}`);
                        } catch (error: unknown) {
                            const err = error instanceof Error ? error : new Error(String(error));
                            log.warn(`[${folder}] Malformed emoji.json: ${err.message}`);
                        }
                        continue;
                    }

                    const ext = path.extname(fileName).toLowerCase();
                    if (!VALID_EXTENSIONS.has(ext)) continue;

                    const safeName = this.sanitizeName(path.basename(fileName, ext));
                    
                    if (appEmojisMap.has(safeName) || queuedUploads.has(safeName)) continue;

                    const stats = await fs.stat(fullPath);
                    if (stats.size > MAX_FILE_SIZE) {
                        log.warn(`[SKIP] Local file ${fileName} exceeds 256KB limit.`);
                        continue;
                    }

                    tasks.push({ safeName, type: 'file', target: fullPath });
                    queuedUploads.add(safeName);
                }
            }

            if (tasks.length > 0) {
                const limit = MAX_APP_EMOJIS - appEmojisMap.size;
                const finalTasks = tasks.slice(0, limit);

                this.totalTasks = finalTasks.length;
                this.completedTasks = 0;
                this.failedTasks = 0;
                this.startTime = Date.now();

                log.info(`Syncing ${finalTasks.length} missing emojis to Discord...`);
                await this.processQueue(finalTasks, finalEmojiData, 2);
            }

            await this.atomicWrite(this.jsonPath, finalEmojiData);
            log.info('Emoji synchronization complete.');

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.error(`Critical failure during emoji sync: ${err.message}`);
        } finally {
            this.client.rest.off('rateLimited', rateLimitHandler);
        }
    }

    private async fetchRemoteBuffer(url: string): Promise<Buffer> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            
            if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
                throw new Error(`Exceeds 256KB limit (${(arrayBuffer.byteLength / 1024).toFixed(1)}KB)`);
            }

            return Buffer.from(arrayBuffer);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (err.name === 'AbortError') {
                throw new Error('Request timed out', { cause: error });
            }
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async processQueue(tasks: UploadTask[], emojiData: Record<string, string>, concurrency: number): Promise<void> {
        let currentIndex = 0;
        
        const workers = Array(concurrency).fill(null).map(async () => {
            while (currentIndex < tasks.length) {
                const task = tasks[currentIndex++];
                
                try {
                    const imageBuffer = task.type === 'file' 
                        ? await fs.readFile(task.target)
                        : await this.fetchRemoteBuffer(task.target);

                    const created = await this.client.application!.emojis.create({
                        attachment: imageBuffer,
                        name: task.safeName
                    });

                    emojiData[task.safeName] = created.toString();
                    this.completedTasks++;
                    this.logProgress(task.safeName);
                    
                    await new Promise(r => setTimeout(r, 250));
                } catch (error: unknown) {
                    this.completedTasks++;
                    this.failedTasks++;
                    
                    const err = error instanceof Error ? error : new Error(String(error));
                    log.error(`Failed to upload [${task.safeName}] from ${task.type}: ${err.message}`);
                    
                    if (error instanceof DiscordAPIError && error.status === 429) {
                        const retryAfter = 5000;
                        log.warn(`Emergency pause: Hit hard 429 rate limit. Waiting ${retryAfter}ms`);
                        await new Promise(r => setTimeout(r, retryAfter));
                    }
                }
            }
        });

        await Promise.all(workers);
    }
}