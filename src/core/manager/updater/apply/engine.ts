/**
 * ApplyEngine — stage, backup, restore, apply core, rebuild, prune.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '#core/utils/logger.js';
import { audit } from '#core/audit/index.js';
import type { GitHubClient } from '../github.js';
import type { UpdatePlan, UpdateReceipt, UpdaterConfig } from '../types.js';
import {
    BACKUP_DIR,
    STAGING_DIR,
    computeLocalHashes,
    ensureDirs,
    isPluginPath,
    shouldHardExclude,
    walkLocal,
} from '../paths.js';
import {
    clearApplyState,
    listBackupInfos,
    readBaseline,
    writeApplyState,
    writeBaseline,
    writeReceipt,
} from '../state.js';
import { emptyPlan, printPlan } from '../planner.js';

const execFileAsync = promisify(execFile);
const log = getLogger('Updater.Apply');

export class ApplyEngine {
    constructor(
        private readonly config: UpdaterConfig,
        private readonly gh: GitHubClient,
    ) {}

    public async stageArchive(owner: string, repo: string, ref: string): Promise<string> {
        const dest = path.join(STAGING_DIR, ref.replace(/[^\w.-]/g, '_'));
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });

        log.info(`Downloading ${ref}…`);
        const buf = await this.gh.downloadArchive(owner, repo, ref);
        const archivePath = path.join(STAGING_DIR, `${ref}.tar.gz`);
        fs.writeFileSync(archivePath, buf);

        try {
            await execFileAsync('tar', ['-xzf', archivePath, '-C', dest, '--strip-components=1'], {
                timeout: 60_000,
            });
        } catch {
            await execFileAsync('tar', ['-xzf', archivePath, '-C', dest], { timeout: 60_000 });
            const entries = fs.readdirSync(dest);
            if (entries.length === 1) {
                const inner = path.join(dest, entries[0]!);
                if (fs.statSync(inner).isDirectory()) {
                    for (const name of fs.readdirSync(inner)) {
                        fs.renameSync(path.join(inner, name), path.join(dest, name));
                    }
                    fs.rmSync(inner, { recursive: true, force: true });
                }
            }
        } finally {
            try {
                fs.unlinkSync(archivePath);
            } catch {
                /* ignore */
            }
        }
        return dest;
    }

    public collectRemoteFiles(stagingRoot: string): string[] {
        const files: string[] = [];
        function recurse(dir: string, rel: string): void {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (ent.name === '.git' || ent.name === 'node_modules') continue;
                const r = rel ? `${rel}/${ent.name}` : ent.name;
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) recurse(full, r);
                else if (ent.isFile()) files.push(r.replace(/\\/g, '/'));
            }
        }
        recurse(stagingRoot, '');
        return files;
    }

    public async createBackup(tag: string, applyPaths: string[] = []): Promise<string> {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.join(BACKUP_DIR, `${ts}_${tag}`);
        fs.mkdirSync(dir, { recursive: true });
        const cwd = process.cwd();
        const always = [
            'package.json',
            'package-lock.json',
            'pnpm-lock.yaml',
            'yarn.lock',
            'tsconfig.json',
            'index.js',
            'index.d.ts',
        ];
        const pathSet = new Set<string>([...always, ...applyPaths.map((p) => p.replace(/\\/g, '/'))]);

        for (const rel of pathSet) {
            if (rel === 'core' || rel.startsWith('core/')) continue;
            const src = path.join(cwd, rel);
            if (!fs.existsSync(src)) continue;
            const st = fs.statSync(src);
            const dest = path.join(dir, rel);
            if (st.isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                await execFileAsync('cp', ['-a', src + '/.', dest]).catch(async () => {
                    await execFileAsync('cp', ['-a', src, path.dirname(dest)]);
                });
            } else if (st.isFile()) {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.copyFileSync(src, dest);
            }
        }

        const needCore =
            pathSet.has('core') ||
            [...pathSet].some((p) => p.startsWith('core/')) ||
            fs.existsSync(path.join(cwd, 'core'));
        if (needCore) {
            const coreSrc = path.join(cwd, 'core');
            if (fs.existsSync(coreSrc)) {
                try {
                    await execFileAsync('cp', ['-a', coreSrc, path.join(dir, 'core')]);
                } catch (e) {
                    try {
                        fs.rmSync(dir, { recursive: true, force: true });
                    } catch {
                        /* ignore */
                    }
                    throw new Error(
                        `createBackup failed copying core/: ${(e as Error).message}. Apply aborted.`,
                    );
                }
            }
        }

        const baselineSnap = readBaseline();
        fs.writeFileSync(
            path.join(dir, 'backup-meta.json'),
            JSON.stringify(
                {
                    tag,
                    createdAt: new Date().toISOString(),
                    previousTag: baselineSnap?.tag ?? null,
                    commit: baselineSnap?.commit ?? null,
                    paths: [...pathSet],
                },
                null,
                2,
            ),
            'utf-8',
        );
        log.info(`Backup → ${dir} (${pathSet.size} path(s))`);
        return dir;
    }

    public async restoreFromBackup(backupId: string, dryRun: boolean): Promise<UpdatePlan> {
        const t0 = Date.now();
        ensureDirs();
        const infos = listBackupInfos();
        const match = infos.find(
            (b) => b.id === backupId || b.dir === backupId || b.id.startsWith(backupId),
        );
        if (!match) {
            const plan = emptyPlan(`Backup not found: ${backupId}`, false, null);
            writeReceipt(plan, { durationMs: Date.now() - t0, mode: 'restore-backup' });
            return plan;
        }

        const plan: UpdatePlan = {
            fromTag: readBaseline()?.tag ?? null,
            toTag: match.tag || backupId,
            toCommit: '',
            allowed: true,
            reason: `Restore backup ${match.id}`,
            dirtyFiles: [],
            pluginDecisions: [],
            filesToOverwrite: [],
            filesToAdd: [],
            filesToKeep: [],
            dryRun,
            baselineOnly: false,
            installPlugin: null,
        };
        printPlan(plan);
        if (dryRun) {
            log.info(`Dry-run restore would copy from ${match.dir}`);
            writeReceipt(plan, {
                durationMs: Date.now() - t0,
                mode: 'restore-backup',
                restoredFrom: match.id,
            });
            return plan;
        }

        writeApplyState({
            phase: 'restoring',
            backupId: match.id,
            toTag: match.tag || backupId,
            fromTag: readBaseline()?.tag ?? null,
            startedAt: new Date().toISOString(),
        });

        const safety = await this.createBackup(`pre-restore_${readBaseline()?.tag ?? 'current'}`);

        const cwd = process.cwd();
        const skipNames = new Set(['backup-meta.json']);
        const walkBackup = (dir: string, relBase: string): void => {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (skipNames.has(ent.name)) continue;
                const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
                const src = path.join(dir, ent.name);
                const dest = path.join(cwd, rel);
                if (ent.isDirectory()) {
                    fs.mkdirSync(dest, { recursive: true });
                    walkBackup(src, rel);
                } else if (ent.isFile()) {
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(src, dest);
                    plan.filesToOverwrite.push(rel.replace(/\\/g, '/'));
                }
            }
        };
        walkBackup(match.dir, '');

        let deps: UpdateReceipt['depsInstall'] = 'skipped';
        try {
            await this.rebuild();
            deps = fs.existsSync(path.join(cwd, 'package-lock.json')) ? 'npm-ci' : 'npm-install';
        } catch (e) {
            log.error('Rebuild after restore failed', e);
            plan.allowed = false;
            plan.reason = `Restore copied files but rebuild failed: ${(e as Error).message}`;
            writeReceipt(plan, {
                durationMs: Date.now() - t0,
                mode: 'restore-backup',
                restoredFrom: match.id,
                backupDir: safety,
                depsInstall: 'failed',
            });
            return plan;
        }

        let meta: { tag?: string; commit?: string | null } = {};
        try {
            const metaPath = path.join(match.dir, 'backup-meta.json');
            if (fs.existsSync(metaPath)) {
                meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
                    tag?: string;
                    commit?: string | null;
                };
            }
        } catch {
            /* ignore */
        }

        const rehashFiles = walkLocal().filter((f) => !shouldHardExclude(f));
        const freshHashes = await computeLocalHashes(rehashFiles);
        const prev = readBaseline();
        const tagFromMeta = meta.tag || match.tag;
        writeBaseline({
            tag:
                tagFromMeta.startsWith('v') || /^\d/.test(tagFromMeta)
                    ? tagFromMeta
                    : (prev?.tag ?? tagFromMeta),
            commit: meta.commit ?? prev?.commit ?? '',
            timestamp: new Date().toISOString(),
            previousTag: prev?.tag ?? null,
            previousCommit: prev?.commit ?? null,
            files: freshHashes,
        });

        clearApplyState();
        log.info(`Restored from backup ${match.id}`);
        writeReceipt(plan, {
            durationMs: Date.now() - t0,
            mode: 'restore-backup',
            restoredFrom: match.id,
            backupDir: safety,
            depsInstall: deps,
        });
        return plan;
    }

    public listBackupsAndLog(): UpdatePlan {
        const t0 = Date.now();
        const infos = listBackupInfos();
        if (infos.length === 0) {
            log.info('No backups under .data/updater/backups/');
        } else {
            log.info(`── Backups (${infos.length}) ─────────────────────`);
            for (const b of infos) {
                log.info(
                    `  ${b.id}  tag=${b.tag}  core=${b.hasCore ? 'yes' : 'no'}  pkg=${b.hasPackageJson ? 'yes' : 'no'}`,
                );
            }
            log.info('────────────────────────────────────────────');
            log.info('Restore: npm run updater -- --restore-backup <id>');
        }
        const plan = emptyPlan(
            infos.length ? `Listed ${infos.length} backup(s)` : 'No backups found',
            false,
            null,
        );
        plan.allowed = true;
        plan.reason = infos.length ? `Listed ${infos.length} backup(s)` : 'No backups found';
        writeReceipt(plan, { durationMs: Date.now() - t0, mode: 'list-backups' });
        return plan;
    }

    public async applyCoreFromStaging(stagingRoot: string, plan: UpdatePlan): Promise<void> {
        const all = [...plan.filesToOverwrite, ...plan.filesToAdd].filter((rel) => !isPluginPath(rel));
        const coreRels = all.filter((rel) => rel === 'core' || rel.startsWith('core/'));
        const otherRels = all.filter((rel) => rel !== 'core' && !rel.startsWith('core/'));
        const cwd = process.cwd();

        for (const rel of otherRels) {
            const src = path.join(stagingRoot, rel);
            const dest = path.join(cwd, rel);
            if (!fs.existsSync(src)) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }

        const stagingCore = path.join(stagingRoot, 'core');
        const hasStagingCore = fs.existsSync(stagingCore);
        if (hasStagingCore || coreRels.length > 0) {
            const coreNew = path.join(cwd, 'core.new');
            const coreOld = path.join(cwd, 'core.old');
            const coreLive = path.join(cwd, 'core');
            if (fs.existsSync(coreNew)) fs.rmSync(coreNew, { recursive: true, force: true });
            if (hasStagingCore) {
                await execFileAsync('cp', ['-a', stagingCore, coreNew]);
            } else {
                for (const rel of coreRels) {
                    const src = path.join(stagingRoot, rel);
                    if (!fs.existsSync(src)) continue;
                    const dest = path.join(cwd, rel.replace(/^core(?=\/|$)/, 'core.new'));
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(src, dest);
                }
            }
            if (fs.existsSync(coreNew)) {
                if (fs.existsSync(coreOld)) fs.rmSync(coreOld, { recursive: true, force: true });
                if (fs.existsSync(coreLive)) fs.renameSync(coreLive, coreOld);
                fs.renameSync(coreNew, coreLive);
                try {
                    fs.rmSync(coreOld, { recursive: true, force: true });
                } catch {
                    /* ignore */
                }
            }
        }

        log.info(`Applied ${all.length} core file(s)`);
        void audit.record({
            actorType: 'system',
            actorId: 'system',
            action: 'updater.apply',
            target: 'core',
            outcome: 'success',
            meta: { count: all.length },
        });
    }

    public async reinstallDependencies(): Promise<void> {
        const cwd = process.cwd();
        const hasLock =
            fs.existsSync(path.join(cwd, 'package-lock.json')) ||
            fs.existsSync(path.join(cwd, 'npm-shrinkwrap.json'));
        const installTimeout = Math.max(this.config.timeoutMs, 600_000);

        if (hasLock) {
            log.info('Installing dependencies via npm ci (lockfile present)…');
            try {
                await execFileAsync('npm', ['ci'], {
                    cwd,
                    timeout: installTimeout,
                    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
                });
                log.info('npm ci finished');
                return;
            } catch (e) {
                log.warn('npm ci failed – falling back to npm install', e);
            }
        }

        log.info('Installing dependencies via npm install…');
        await execFileAsync('npm', ['install'], {
            cwd,
            timeout: installTimeout,
            env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
        });
        log.info('npm install finished');
    }

    public async rebuild(): Promise<void> {
        log.info('Rebuild sequence…');
        await this.reinstallDependencies();
        try {
            await execFileAsync('npm', ['run', 'clean'], { cwd: process.cwd(), timeout: 60_000 });
        } catch {
            /* optional */
        }
        await execFileAsync('npm', ['run', 'build'], {
            cwd: process.cwd(),
            timeout: this.config.timeoutMs,
        });
        log.info('Rebuild finished');
    }

    public pruneBackups(): void {
        try {
            if (!fs.existsSync(BACKUP_DIR)) return;
            const entries = fs
                .readdirSync(BACKUP_DIR)
                .map((name) => ({
                    name,
                    full: path.join(BACKUP_DIR, name),
                    mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs,
                }))
                .sort((a, b) => b.mtime - a.mtime);
            for (const e of entries.slice(this.config.maxBackups)) {
                fs.rmSync(e.full, { recursive: true, force: true });
            }
        } catch {
            /* ignore */
        }
    }
}
