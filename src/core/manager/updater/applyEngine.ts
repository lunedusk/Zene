
/**
 * ApplyEngine — filesystem apply / backup / restore helpers for the updater.
 * Updater orchestrates planning; this module owns destructive apply steps.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { UpdatePlan, UpdaterConfig } from './types.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('Updater.Apply');

export class ApplyEngine {
    constructor(
        private readonly config: UpdaterConfig,
        private readonly stateDir: string,
        private readonly backupDir: string,
        private readonly stagingDir: string,
        private readonly hardExcludes: ReadonlySet<string>,
    ) {}

    public pruneBackups(): void {
        try {
            if (!fs.existsSync(this.backupDir)) return;
            const entries = fs
                .readdirSync(this.backupDir, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => ({
                    name: e.name,
                    mtime: fs.statSync(path.join(this.backupDir, e.name)).mtimeMs,
                }))
                .sort((a, b) => b.mtime - a.mtime);
            const keep = Math.max(1, this.config.maxBackups);
            for (const e of entries.slice(keep)) {
                const full = path.join(this.backupDir, e.name);
                fs.rmSync(full, { recursive: true, force: true });
                log.info(`Pruned old backup ${e.name}`);
            }
        } catch (err) {
            log.warn(`Backup prune failed: ${(err as Error).message}`);
        }
    }
}
