import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger, flushLogs } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';
import { SemVer, SemVerRange } from '#core/utils/semver.js';
import { GitHubClient } from './github.js';
import { parsePluginsTxt } from './pluginsTxt.js';
import type {
    Baseline,
    BaselineFileEntry,
    BackupInfo,
    DirtyFile,
    PendingHealth,
    PluginDecision,
    PluginSourceLine,
    UpdatePlan,
    UpdateReceipt,
    UpdaterConfig,
    TagInfo,
    TakebacksFile,
    ApplyState
} from './types.js';
import { hashFile } from '#core/helpers/hash/index.js';
import { audit } from '#core/audit/index.js';
import { loadUpdaterConfig, HARD_EXCLUDES } from './config.js';
import { emptyPlan, printPlan } from './planner.js';
import { ApplyEngine } from './apply/engine.js';
import {
    STATE_DIR,
    BASELINE,
    BACKUP_DIR,
    STAGING_DIR,
    ensureDirs,
    isPluginPath,
    pluginRoot,
    shouldHardExclude,
    sourcePluginPath,
    runtimePluginPath,
    localPluginDir,
    walkLocal,
    computeLocalHashes,
    copyDirRecursive,
} from './paths.js';
import {
    readPendingHealth,
    writePendingHealth,
    clearPendingHealth,
    markUpdaterHealthy,
    readApplyState,
    writeApplyState,
    clearApplyState,
    readBaseline,
    writeBaseline,
    writeReceipt,
    listBackupInfos,
    listBackups,
} from './state.js';
import {
    readPackageVersion,
    readLocalManifestId,
    manifestCompatible,
    detectLayout,
    mirrorPluginToRuntime,
} from './plugins/layout.js';

const execFileAsync = promisify(execFile);
const log = getLogger('Updater');

export { markUpdaterHealthy, listBackups };

export function getUpdaterConfig(): UpdaterConfig {
    return loadUpdaterConfig();
}

export class Updater {
    private readonly config: UpdaterConfig;
    private readonly gh: GitHubClient;
    private readonly apply: ApplyEngine;

    constructor() {
        this.config = loadUpdaterConfig();
        this.gh = new GitHubClient(this.config.githubPat, Math.min(this.config.timeoutMs, 60_000));
        this.apply = new ApplyEngine(this.config, this.gh);
    }

    async run(options: {
        force?: boolean;
        dryRun?: boolean;
        baselineOnly?: boolean;
        installPlugin?: string | null;
        targetTag?: string | null;
        downgrade?: boolean;
        pluginTag?: string | null;
        listBackups?: boolean;
        restoreBackup?: string | null;
    } = {}): Promise<UpdatePlan> {
        ensureDirs();
        const runStartedAt = Date.now();
        const force         = options.force ?? false;
        const dryRun        = options.dryRun ?? this.config.dryRun;
        const baselineOnly  = options.baselineOnly ?? false;
        const installPlugin = this.normalizePluginArg(options.installPlugin ?? null);
        const targetTag     = options.targetTag?.trim() || null;
        const downgrade     = options.downgrade ?? false;
        const pluginTagPin  = options.pluginTag?.trim() || null;
        const listBackupsOpt = options.listBackups ?? false;
        const restoreBackupId = options.restoreBackup?.trim() || null;

        if (listBackupsOpt) {
            return this.apply.listBackupsAndLog();
        }
        if (restoreBackupId) {
            return this.apply.restoreFromBackup(restoreBackupId, dryRun);
        }

        log.info(
            `Updater start (baselineOnly=${baselineOnly}, dryRun=${dryRun}, force=${force}, ` +
            `installPlugin=${installPlugin ?? '-'}, target=${targetTag ?? '-'}, downgrade=${downgrade})`
        );

        if (
            !this.config.autoUpdater &&
            !targetTag &&
            !downgrade &&
            !installPlugin &&
            !baselineOnly &&
            !listBackupsOpt &&
            !restoreBackupId
        ) {
            log.warn(
                'AutoUpdater=false – refusing automatic update ' +
                '(--target / --downgrade / --install-plugin / --baseline-only still allowed)'
            );
            return emptyPlan('AutoUpdater disabled', baselineOnly, installPlugin);
        }

        if (this.config.autoRollback && !targetTag && !downgrade && !installPlugin && !baselineOnly) {
            const rolled = await this.maybeAutoRollback();
            if (rolled) return rolled;
        }

        let owner: string;
        let repo: string;

        if (this.config.repositoryUrl) {
            try {
                ({ owner, repo } = GitHubClient.parseRepo(this.config.repositoryUrl));
            } catch (e) {
                log.warn(`RepositoryUrl invalid – aborting: ${(e as Error).message}`);
                return emptyPlan('Invalid RepositoryUrl', baselineOnly, installPlugin);
            }
        } else {
            ({ owner, repo } = GitHubClient.parseRepo(this.config.defaultRepo));
        }
        log.info(`Repository: ${owner}/${repo}`);

        const baseline = readBaseline();
        let currentSemVer: SemVer | null = null;
        if (baseline) {
            try { currentSemVer = SemVer.parse(baseline.tag); } catch { }
        }
        if (!currentSemVer) currentSemVer = readPackageVersion();

        if (baselineOnly) {
            let target: TagInfo | null;
            try {
                target = await this.gh.findNearestTag(owner, repo, currentSemVer);
            } catch (e) {
                if (this.config.repositoryUrl) {
                    return emptyPlan(`RepositoryUrl unreachable: ${(e as Error).message}`, true, installPlugin);
                }
                throw e;
            }
            if (!target?.semver) return emptyPlan('No suitable tag', true, installPlugin);
            const stagingRoot = await this.apply.stageArchive(owner, repo, target.name);
            const remoteFiles = this.apply.collectRemoteFiles(stagingRoot);
            return this.runBaselineOnly({
                target, stagingRoot, remoteFiles, dryRun, force
            });
        }

        let coreTarget: TagInfo | null = null;
        try {
            if (downgrade) {
                let recommend: string | null = null;
                const localTb = path.join(process.cwd(), 'takebacks.json');
                if (fs.existsSync(localTb) && baseline?.tag) {
                    try {
                        const tb = JSON.parse(fs.readFileSync(localTb, 'utf-8')) as TakebacksFile;
                        const ent = tb.entries?.find(
                            e => e.tag === baseline.tag && e.active !== false && e.recommend
                        );
                        recommend = ent?.recommend ?? null;
                    } catch { }
                }
                const want = recommend || baseline?.previousTag || null;
                if (!want) {
                    log.warn('Downgrade: no recommend and no previousTag – nothing to do');
                    return emptyPlan('No downgrade target available', false, installPlugin);
                }
                coreTarget = await this.gh.getTagByName(owner, repo, want);
                if (!coreTarget) {
                    log.warn(`Downgrade target tag not found: ${want}`);
                    return emptyPlan(`Downgrade tag not found: ${want}`, false, installPlugin);
                }
                log.info(`Downgrade target: ${coreTarget.name}`);
            } else if (targetTag) {
                coreTarget = await this.gh.getTagByName(owner, repo, targetTag);
                if (!coreTarget) {
                    return emptyPlan(`Target tag not found: ${targetTag}`, false, installPlugin);
                }
                log.info(`Explicit target: ${coreTarget.name}`);
            } else {
                const takebacks = await this.loadTakebacksFile(owner, repo);
                const yanked = this.yankedTagSet(takebacks);
                if (yanked.size > 0) {
                    log.info(`Takebacks: skipping ${yanked.size} superseded tag(s) on normal update`);
                }

                if (baseline?.tag && takebacks) {
                    const cur = takebacks.entries?.find(
                        e => e.tag === baseline.tag && e.active !== false && e.status === 'superseded' && e.recommend
                    );
                    if (cur?.recommend) {
                        const rec = await this.gh.getTagByName(owner, repo, cur.recommend);
                        if (rec && !yanked.has(rec.name)) {
                            log.info(`Baseline ${baseline.tag} is superseded → recommend ${rec.name}`);
                            coreTarget = rec;
                        }
                    }
                }

                if (!coreTarget) {
                    coreTarget = await this.gh.getLatestAllowedTag(
                        owner, repo, currentSemVer, this.config.devBuilds, yanked
                    );
                }
            }
        } catch (e) {
            if (this.config.repositoryUrl) {
                return emptyPlan(`RepositoryUrl unreachable: ${(e as Error).message}`, false, installPlugin);
            }
            throw e;
        }

        let coreForCompat: SemVer | null =
            coreTarget?.semver ?? currentSemVer ?? readPackageVersion();

        const pluginsTxtRef = coreTarget?.name ?? baseline?.tag ?? null;
        let officialLines: PluginSourceLine[] = [];
        let pluginsTxtSource: string | null = null;
        let pluginsTxtFetchOk = false;
        try {
            const headBody = await this.gh.getFileText(owner, repo, this.config.branch, 'plugins.txt');
            if (headBody) {
                officialLines = parsePluginsTxt(headBody);
                pluginsTxtSource = `branch:${this.config.branch}`;
                pluginsTxtFetchOk = true;
                log.info(
                    `Branch ${this.config.branch} plugins.txt → ${officialLines.length} plugin line(s)`,
                );
            }
        } catch (e) {
            log.warn(
                `plugins.txt HEAD (${this.config.branch}) failed: ${(e as Error).message} — falling back to tag`,
            );
        }
        if (!pluginsTxtFetchOk && pluginsTxtRef) {
            try {
                const body = await this.gh.getFileText(owner, repo, pluginsTxtRef, 'plugins.txt');
                if (body) {
                    officialLines = parsePluginsTxt(body);
                    pluginsTxtSource = `tag:${pluginsTxtRef}`;
                    pluginsTxtFetchOk = true;
                    log.info(
                        `Tag ${pluginsTxtRef} plugins.txt → ${officialLines.length} plugin line(s)`,
                    );
                }
            } catch (e) {
                log.warn(
                    `plugins.txt tag ${pluginsTxtRef} failed: ${(e as Error).message}`,
                );
            }
        }
        if (!pluginsTxtFetchOk) {
            log.warn(
                'plugins.txt unavailable (HEAD and tag) — skipping plugin plan changes (no removals)',
            );
        }

        if (installPlugin) {
            if (!pluginsTxtRef || officialLines.length === 0 || !coreForCompat) {
                const tags = (await this.gh.listTags(owner, repo))
                    .filter(t => t.semver !== null)
                    .sort((a, b) => b.semver!.compare(a.semver!));
                const latest = tags[0] ?? null;
                if (latest) {
                    coreForCompat = coreForCompat ?? latest.semver;
                    const body = await this.gh.getFileText(owner, repo, latest.name, 'plugins.txt');
                    if (body) officialLines = parsePluginsTxt(body);
                    if (!coreTarget) coreTarget = latest;
                }
            }
            return this.runInstallPlugin({
                owner, repo, pluginName: installPlugin,
                officialLines, coreForCompat, baseline,
                dryRun, force, coreTarget,
                pluginTagPin
            });
        }

        if (!coreTarget?.semver) {
            log.info('No newer core tag. Checking plugins against current core only…');
            const pluginDecisions = await this.planPluginUpdates({
                owner, repo,
                officialLines,
                coreForCompat: coreForCompat!,
                baseline,
                force,
                allowAdd: false,
                pluginTagPin
            });
            const toApply = pluginDecisions.filter(
                d => d.action === 'update' || d.action === 'add' || d.action === 'remove'
            );
            if (toApply.length === 0) {
                return emptyPlan('No suitable core tag and no plugin updates', false, null);
            }
            const plan: UpdatePlan = {
                fromTag: baseline?.tag ?? null,
                toTag: baseline?.tag ?? currentSemVer?.toString() ?? '',
                toCommit: baseline?.commit ?? '',
                allowed: true,
                reason: 'Plugin-only updates (core already current)',
                dirtyFiles: [],
                pluginDecisions,
                filesToOverwrite: [],
                filesToAdd: [],
                filesToKeep: [],
                dryRun,
                baselineOnly: false,
                installPlugin: null
            };
            printPlan(plan);
            if (dryRun) {
                writeReceipt(plan, { durationMs: Date.now() - runStartedAt });
                return plan;
            }
            await this.applyPluginDecisions(owner, repo, toApply, force);
            await this.refreshBaselineAfterPlugins(baseline, toApply);
            this.apply.pruneBackups();
            writeReceipt(plan, { durationMs: Date.now() - runStartedAt });
            return plan;
        }

        const stagingRoot = await this.apply.stageArchive(owner, repo, coreTarget.name);
        const remoteFiles = this.apply.collectRemoteFiles(stagingRoot);
        const remoteSet = new Set(remoteFiles);
        const localFiles = walkLocal().filter(f => !shouldHardExclude(f));

        const dirtyCore: DirtyFile[] = [];
        if (this.config.safeUpdate && baseline && !force) {
            for (const [rel, entry] of Object.entries(baseline.files)) {
                if (isPluginPath(rel)) continue;
                if (shouldHardExclude(rel)) continue;
                const full = path.join(process.cwd(), rel);
                if (!fs.existsSync(full)) continue;
                try {
                    const current = await hashFile(full);
                    if (current.hash !== entry.hash) {
                        dirtyCore.push({
                            path: rel,
                            baselineHash: entry.hash,
                            currentHash: current.hash,
                            category: 'core'
                        });
                    }
                } catch { }
            }
        }

        if (dirtyCore.length > 0 && this.config.safeUpdate && !force) {
            log.warn(`SafeUpdate blocked core update – ${dirtyCore.length} modified core file(s):`);
            for (const d of dirtyCore.slice(0, 15)) log.warn(`  • ${d.path}`);
            const blocked: UpdatePlan = {
                fromTag: baseline?.tag ?? null,
                toTag: coreTarget.name,
                toCommit: coreTarget.commit,
                allowed: false,
                reason: `SafeUpdate blocked: ${dirtyCore.length} user-modified core file(s)`,
                dirtyFiles: dirtyCore,
                pluginDecisions: [],
                filesToOverwrite: [],
                filesToAdd: [],
                filesToKeep: [],
                dryRun,
                baselineOnly: false,
                installPlugin: null
            };
            writeReceipt(blocked, { durationMs: Date.now() - runStartedAt });
            return blocked;
        }

        const filesToOverwrite: string[] = [];
        const filesToAdd: string[] = [];
        const filesToKeep: string[] = [];

        for (const rel of localFiles) {
            if (isPluginPath(rel)) continue;
            if (remoteSet.has(rel)) filesToOverwrite.push(rel);
            else if (this.config.keepExtra) filesToKeep.push(rel);
        }
        for (const rel of remoteFiles) {
            if (isPluginPath(rel)) continue;
            if (!localFiles.includes(rel)) filesToAdd.push(rel);
        }

        let coreIsDowngrade = false;
        if (currentSemVer && coreTarget.semver) {
            coreIsDowngrade = coreTarget.semver.compare(currentSemVer) < 0;
        } else if (downgrade) {
            coreIsDowngrade = true;
        }

        const pluginDecisions = await this.planPluginUpdates({
            owner, repo,
            officialLines,
            coreForCompat: coreTarget.semver,
            baseline,
            force,
            allowAdd: false,
            allowRemoveIncompatible: coreIsDowngrade,
            pluginTagPin
        });

        const plan: UpdatePlan = {
            fromTag: baseline?.tag ?? null,
            toTag: coreTarget.name,
            toCommit: coreTarget.commit,
            allowed: true,
            reason: coreIsDowngrade
                ? `Downgrade to ${coreTarget.name}`
                : `Update to ${coreTarget.name}`,
            dirtyFiles: dirtyCore,
            pluginDecisions,
            filesToOverwrite,
            filesToAdd,
            filesToKeep,
            dryRun,
            baselineOnly: false,
            installPlugin: null
        };
        printPlan(plan);

        if (dryRun) {
            log.info('Dry-run – no changes written.');
            writeReceipt(plan, { durationMs: Date.now() - runStartedAt });
            return plan;
        }

        const filesPlanned = [...filesToOverwrite, ...filesToAdd].filter(rel => !isPluginPath(rel));
        writeApplyState({
            phase: 'backing_up',
            backupId: null,
            toTag: coreTarget.name,
            fromTag: baseline?.tag ?? null,
            startedAt: new Date().toISOString(),
            filesPlanned
        });
        const backupDir = await this.apply.createBackup(baseline?.tag ?? 'unknown', filesPlanned);
        const backupId = path.basename(backupDir);
        writeApplyState({
            phase: 'applying',
            backupId,
            toTag: coreTarget.name,
            fromTag: baseline?.tag ?? null,
            startedAt: new Date().toISOString(),
            filesPlanned
        });
        try {
            await this.apply.applyCoreFromStaging(stagingRoot, plan);
        } catch (err) {
            void audit.record({
                actorType: 'system',
                actorId: 'system',
                action: 'updater.apply',
                target: 'core',
                outcome: 'fail',
                reason: 'error',
                meta: { name: coreTarget.name },
            });
            throw err;
        }
        let depsInstall: UpdateReceipt['depsInstall'] = null;
        try {
            writeApplyState({
                phase: 'rebuilding',
                backupId,
                toTag: coreTarget.name,
                fromTag: baseline?.tag ?? null,
                startedAt: new Date().toISOString(),
                filesPlanned
            });
            await this.apply.rebuild();
            depsInstall = fs.existsSync(path.join(process.cwd(), 'package-lock.json')) ? 'npm-ci' : 'npm-install';
        } catch (e) {
            depsInstall = 'failed';
            throw e;
        }

        const pluginsToApply = pluginDecisions.filter(
            d => d.action === 'update' || d.action === 'add' || d.action === 'remove'
        );
        await this.applyPluginDecisions(owner, repo, pluginsToApply, force);

        const managedCore = [...filesToOverwrite, ...filesToAdd];
        const newHashes = await computeLocalHashes(managedCore);
        const mergedFiles: Record<string, BaselineFileEntry> = { ...newHashes };
        if (baseline) {
            for (const [rel, entry] of Object.entries(baseline.files)) {
                if (!isPluginPath(rel)) continue;
                const root = pluginRoot(rel);
                const skipped = pluginDecisions.some(
                    d => d.action === 'leave' || d.action === 'skip'
                ) && root && pluginDecisions.some(
                    d => (d.localPath === root || d.pluginId === root.split('/').pop()) &&
                        (d.action === 'leave' || d.action === 'skip')
                );
                if (skipped && !mergedFiles[rel]) mergedFiles[rel] = entry;
            }
        }
        for (const d of pluginsToApply) {
            const root = d.localPath || `src/plugins/${d.pluginId}`;
            const files = walkLocal(path.join(process.cwd(), root)).map(
                f => path.join(root, f).replace(/\\/g, '/')
            );
        }
        const allLocal = walkLocal().filter(f => !shouldHardExclude(f));
        for (const d of pluginsToApply) {
            const root = (d.localPath || `src/plugins/${d.pluginId}`).replace(/\\/g, '/');
            const pluginFiles = allLocal.filter(f => f === root || f.startsWith(root + '/'));
            Object.assign(mergedFiles, await computeLocalHashes(pluginFiles));
        }

        writeApplyState({
            phase: 'baselining',
            backupId,
            toTag: coreTarget.name,
            fromTag: baseline?.tag ?? null,
            startedAt: new Date().toISOString(),
            filesPlanned
        });
        writeBaseline({
            tag: coreTarget.name,
            commit: coreTarget.commit,
            timestamp: new Date().toISOString(),
            previousTag: baseline?.tag ?? null,
            previousCommit: baseline?.commit ?? null,
            files: mergedFiles
        });

        if (this.config.autoRollback && baseline?.tag && baseline.tag !== coreTarget.name) {
            writePendingHealth({
                toTag: coreTarget.name,
                previousTag: baseline.tag,
                previousCommit: baseline.commit ?? null,
                at: new Date().toISOString(),
                healthy: false,
                backupId
            });
            log.info(`Pending health set for ${coreTarget.name} (rollback target ${baseline.tag}, backup ${backupId})`);
        }
        clearApplyState();

        if (this.config.postUpdateCmd) {
            try {
                await execFileAsync('bash', ['-c', this.config.postUpdateCmd], {
                    cwd: process.cwd(), timeout: 60_000
                });
            } catch (e) {
                log.error('Post-update command failed', e);
            }
        }
        this.apply.pruneBackups();
        log.info(`Update to ${coreTarget.name} completed.`);
        const pendingWritten = !!(
            this.config.autoRollback && baseline?.tag && baseline.tag !== coreTarget.name
        );
        writeReceipt(plan, {
            durationMs: Date.now() - runStartedAt,
            backupDir,
            depsInstall,
            pendingHealthWritten: pendingWritten
        });
        return plan;
    }

    private normalizePluginArg(raw: string | null): string | null {
        if (!raw) return null;
        const t = raw.trim();
        if (!t) return null;
        return t.startsWith('plugin-') ? t.slice('plugin-'.length) : t;
    }

    private async maybeAutoRollback(): Promise<UpdatePlan | null> {
        const pending = readPendingHealth();
        if (!pending || pending.healthy) return null;
        if (!pending.previousTag) {
            log.warn('Pending health has no previousTag – cannot auto-rollback');
            clearPendingHealth();
            return null;
        }

        const age = Date.now() - new Date(pending.at).getTime();
        if (age < this.config.healthGraceMs) {
            log.info(
                `Pending health for ${pending.toTag} still in grace ` +
                `(${Math.round(age / 1000)}s / ${Math.round(this.config.healthGraceMs / 1000)}s) – no rollback yet`
            );
            return null;
        }

        log.warn(
            `Auto-rollback: ${pending.toTag} never marked healthy after grace – ` +
            `restoring ${pending.previousTag}`
        );
        const pendingBackupId = pending.backupId ?? null;
        clearPendingHealth();
        if (pendingBackupId) {
            try {
                return await this.apply.restoreFromBackup(pendingBackupId, false);
            } catch (e) {
                log.error('Local backup restore failed – falling back to network tag', e);
            }
        }
        return this.run({
            targetTag: pending.previousTag,
            force: true,
            dryRun: false
        });
    }

    private async loadTakebacksFile(owner: string, repo: string): Promise<TakebacksFile | null> {
        const local = path.join(process.cwd(), 'takebacks.json');
        if (fs.existsSync(local)) {
            try {
                return JSON.parse(fs.readFileSync(local, 'utf-8')) as TakebacksFile;
            } catch {
                log.warn('Local takebacks.json unreadable');
            }
        }
        try {
            const body = await this.gh.getFileText(owner, repo, this.config.branch, 'takebacks.json');
            if (body) return JSON.parse(body) as TakebacksFile;
        } catch { }
        return null;
    }

    private yankedTagSet(tb: TakebacksFile | null): Set<string> {
        const s = new Set<string>();
        if (!tb?.entries) return s;
        for (const e of tb.entries) {
            if (e.active === false) continue;
            if (e.status === 'superseded' || e.status === 'withdrawn') {
                if (e.tag) s.add(e.tag);
            }
        }
        return s;
    }

    private async planPluginUpdates(ctx: {
        owner: string;
        repo: string;
        officialLines: PluginSourceLine[];
        coreForCompat: SemVer;
        baseline: Baseline | null;
        force: boolean;
        allowAdd: boolean;
        allowRemoveIncompatible?: boolean;
        onlyName?: string;
        pluginTagPin?: string | null;
    }): Promise<PluginDecision[]> {
        const decisions: PluginDecision[] = [];
        const lines = ctx.onlyName
            ? ctx.officialLines.filter(l => l.id === ctx.onlyName)
            : ctx.officialLines;

        log.info(`Planning ${lines.length} plugin line(s) (core ${ctx.coreForCompat})…`);
        for (const line of lines) {
            const pluginName = line.id;
            log.info(`── Plugin plan: ${pluginName} ──`);
            const localRel = localPluginDir(pluginName);
            const srcPath = sourcePluginPath(pluginName);
            const rtPath = runtimePluginPath(pluginName);

            if (!localRel && !ctx.allowAdd) {
                decisions.push({
                    pluginId: pluginName,
                    localPath: srcPath,
                    runtimePath: rtPath,
                    remotePath: null,
                    action: 'skip',
                    reason: 'Not installed locally – auto-install disabled (use --install-plugin)',
                    source: line
                });
                continue;
            }

            let pOwner = ctx.owner;
            let pRepo = ctx.repo;
            if (line.kind === 'external' && line.repo) {
                try {
                    ({ owner: pOwner, repo: pRepo } = GitHubClient.parseRepo(line.repo));
                } catch (e) {
                    decisions.push({
                        pluginId: pluginName,
                        localPath: localRel ?? srcPath,
                        runtimePath: rtPath,
                        remotePath: null,
                        action: 'skip',
                        reason: `Invalid external repo: ${(e as Error).message}`,
                        source: line
                    });
                    continue;
                }
            }

            let selected: TagInfo | null = null;
            let selectedReq = '';

            const effectivePin =
                (ctx.onlyName && ctx.pluginTagPin) ? ctx.pluginTagPin :
                line.pinnedTag;

            if (effectivePin) {
                selected = await this.gh.getTagByName(pOwner, pRepo, effectivePin);
                if (!selected) {
                    decisions.push({
                        pluginId: pluginName,
                        localPath: localRel ?? srcPath,
                        runtimePath: rtPath,
                        remotePath: null,
                        action: 'skip',
                        reason: `Pinned tag not found: ${effectivePin} (tags only)`,
                        source: line
                    });
                    continue;
                }
            } else {
                log.info(`[plugin] ${pluginName}: resolving tags (${line.kind}) on ${pOwner}/${pRepo}…`);
                let pluginTags = await this.gh.listTagsForPluginScheme(line.kind, pOwner, pRepo, pluginName);
                log.info(`[plugin] ${pluginName}: ${pluginTags.length} plugin-* tag(s)`);

                if (line.kind !== 'in-repo' && pluginTags.length === 0) {
                    const semverAll = await this.gh.listSemverTags(pOwner, pRepo);
                    pluginTags = semverAll.slice(0, 15);
                    log.info(
                        `[plugin] ${pluginName}: no plugin-* tags; probing newest ${pluginTags.length}/${semverAll.length} semver tag(s)`
                    );
                }

                const seen = new Set<string>();
                let tags = pluginTags.filter(t => {
                    if (seen.has(t.name)) return false;
                    seen.add(t.name);
                    return true;
                });

                const MAX_TAG_PROBES = 20;
                if (tags.length > MAX_TAG_PROBES) {
                    log.info(`[plugin] ${pluginName}: capping tag probes ${tags.length} → ${MAX_TAG_PROBES}`);
                    tags = tags.slice(0, MAX_TAG_PROBES);
                }

                if (tags.length === 0) {
                    decisions.push({
                        pluginId: pluginName,
                        localPath: localRel ?? srcPath,
                        runtimePath: rtPath,
                        remotePath: null,
                        action: 'skip',
                        reason: line.kind === 'in-repo'
                            ? `No tags matching plugin-${pluginName}-v* (in-repo scheme)`
                            : 'No v* semver tags on external/standalone repo',
                        source: line
                    });
                    continue;
                }

                for (let ti = 0; ti < tags.length; ti++) {
                    const tag = tags[ti];
                    log.info(`[plugin] ${pluginName}: probe ${ti + 1}/${tags.length} tag ${tag.name}`);
                    const paths = [
                        `src/plugins/${pluginName}/manifest.json`,
                        `plugins/${pluginName}/manifest.json`,
                        'manifest.json'
                    ];
                    let text: string | null = null;
                    for (const mp of paths) {
                        try {
                            text = await this.gh.getFileText(pOwner, pRepo, tag.name, mp);
                        } catch (e) {
                            log.warn(`[plugin] ${pluginName}: getFileText ${tag.name}:${mp} failed: ${(e as Error).message}`);
                            text = null;
                        }
                        if (text) break;
                    }
                    if (!text) {
                        log.info(`[plugin] ${pluginName}: ${tag.name} has no manifest – skip`);
                        continue;
                    }
                    const { ok, req } = manifestCompatible(text, ctx.coreForCompat);
                    if (ok) {
                        selected = tag;
                        selectedReq = req;
                        log.info(`[plugin] ${pluginName}: selected ${tag.name} (zene_version ${req})`);
                        break;
                    }
                    log.info(`[plugin] ${pluginName}: ${tag.name} incompatible (requires ${req})`);
                }
            }

            if (!selected) {
                if (localRel && ctx.allowRemoveIncompatible) {
                    if (this.config.safeUpdate && !ctx.force && ctx.baseline) {
                        const dirty =
                            (await this.isPluginDirty(localRel, ctx.baseline)) ||
                            (await this.isPluginDirty(rtPath, ctx.baseline));
                        if (dirty) {
                            decisions.push({
                                pluginId: pluginName,
                                localPath: srcPath,
                                runtimePath: rtPath,
                                remotePath: null,
                                action: 'leave',
                                reason:
                                    'No compatible plugin tag for older core, but SafeUpdate: local plugin is dirty – not removing',
                                source: line
                            });
                            continue;
                        }
                    }
                    decisions.push({
                        pluginId: pluginName,
                        localPath: srcPath,
                        runtimePath: rtPath,
                        remotePath: null,
                        action: 'remove',
                        reason:
                            'No compatible plugin tag for target core – removing local install (downgrade)',
                        source: line
                    });
                    continue;
                }
                decisions.push({
                    pluginId: pluginName,
                    localPath: localRel ?? srcPath,
                    runtimePath: rtPath,
                    remotePath: null,
                    action: 'skip',
                    reason: 'No compatible plugin tag for current core version (tags only)',
                    source: line
                });
                continue;
            }

            const chosen = selected;

            let remoteId: string | undefined;
            let compatOk = true;
            for (const mp of [
                `src/plugins/${pluginName}/manifest.json`,
                `plugins/${pluginName}/manifest.json`,
                'manifest.json'
            ]) {
                const remoteMan = await this.gh.getFileText(pOwner, pRepo, chosen.name, mp);
                if (!remoteMan) continue;
                try {
                    const j = JSON.parse(remoteMan);
                    remoteId = j.id || j.name;
                    if (!selectedReq && j.zene_version) {
                        const { ok, req } = manifestCompatible(remoteMan, ctx.coreForCompat);
                        selectedReq = req;
                        if (!ok && !line.pinnedTag) {
                            compatOk = false;
                        }
                    }
                    break;
                } catch { }
            }
            if (!compatOk) {
                decisions.push({
                    pluginId: pluginName,
                    localPath: localRel ?? srcPath,
                    runtimePath: rtPath,
                    remotePath: null,
                    action: 'skip',
                    reason: 'Incompatible zene_version after manifest read',
                    source: line
                });
                continue;
            }

            if (localRel) {
                const localId =
                    readLocalManifestId(localRel, this.config.pluginManifest) ||
                    readLocalManifestId(localRel, 'manifest.json');
                if (localId && remoteId && localId !== remoteId) {
                    decisions.push({
                        pluginId: pluginName,
                        localPath: srcPath,
                        runtimePath: rtPath,
                        remotePath: `src/plugins/${pluginName}`,
                        action: 'leave',
                        reason: `id mismatch (local="${localId}" vs remote="${remoteId}")`,
                        localManifestId: localId,
                        remoteManifestId: remoteId,
                        selectedPluginTag: chosen.name,
                        source: line
                    });
                    continue;
                }

                if (this.config.safeUpdate && !ctx.force && ctx.baseline) {
                    const dirty =
                        (await this.isPluginDirty(localRel, ctx.baseline)) ||
                        (await this.isPluginDirty(rtPath, ctx.baseline));
                    if (dirty) {
                        decisions.push({
                            pluginId: pluginName,
                            localPath: srcPath,
                            runtimePath: rtPath,
                            remotePath: `src/plugins/${pluginName}`,
                            action: 'leave',
                            reason: 'SafeUpdate: local plugin files differ from baseline',
                            localManifestId: localId,
                            remoteManifestId: remoteId,
                            selectedPluginTag: chosen.name,
                            source: line
                        });
                        continue;
                    }
                }

                decisions.push({
                    pluginId: pluginName,
                    localPath: srcPath,
                    runtimePath: rtPath,
                    remotePath: `src/plugins/${pluginName}`,
                    action: 'update',
                    reason: `Compatible tag ${chosen.name}${selectedReq ? ` (requires ${selectedReq})` : ''}`,
                    localManifestId: localId,
                    remoteManifestId: remoteId,
                    selectedPluginTag: chosen.name,
                    source: line
                });
            } else {
                decisions.push({
                    pluginId: pluginName,
                    localPath: srcPath,
                    runtimePath: rtPath,
                    remotePath: `src/plugins/${pluginName}`,
                    action: 'add',
                    reason: `Install from ${chosen.name}${selectedReq ? ` (requires ${selectedReq})` : ''}`,
                    remoteManifestId: remoteId,
                    selectedPluginTag: chosen.name,
                    source: line
                });
            }
        }

        return decisions;
    }

    private async isPluginDirty(pluginRel: string, baseline: Baseline): Promise<boolean> {
        const prefix = pluginRel.replace(/\\/g, '/');
        for (const [rel, entry] of Object.entries(baseline.files)) {
            if (rel !== prefix && !rel.startsWith(prefix + '/')) continue;
            const full = path.join(process.cwd(), rel);
            if (!fs.existsSync(full)) continue;
            try {
                const cur = await hashFile(full);
                if (cur.hash !== entry.hash) return true;
            } catch { }
        }
        return false;
    }

    private async runInstallPlugin(ctx: {
        owner: string;
        repo: string;
        pluginName: string;
        officialLines: PluginSourceLine[];
        coreForCompat: SemVer | null;
        baseline: Baseline | null;
        dryRun: boolean;
        force: boolean;
        coreTarget: TagInfo | null;
        pluginTagPin?: string | null;
    }): Promise<UpdatePlan> {
        const { pluginName, officialLines, dryRun, force } = ctx;

        if (!ctx.coreForCompat) {
            return emptyPlan('Cannot resolve core version for plugin compatibility', false, pluginName);
        }

        if (!officialLines.some(l => l.id === pluginName)) {
            log.warn(`Plugin "${pluginName}" is not listed in the tag's plugins.txt`);
            return emptyPlan(
                `Plugin "${pluginName}" not in tag plugins.txt – refusing install`,
                false,
                pluginName
            );
        }

        const decisions = await this.planPluginUpdates({
            owner: ctx.owner,
            repo: ctx.repo,
            officialLines,
            coreForCompat: ctx.coreForCompat,
            baseline: ctx.baseline,
            force,
            allowAdd: true,
            onlyName: pluginName,
            pluginTagPin: ctx.pluginTagPin
        });

        const plan: UpdatePlan = {
            fromTag: ctx.baseline?.tag ?? null,
            toTag: ctx.coreTarget?.name ?? ctx.baseline?.tag ?? '',
            toCommit: ctx.coreTarget?.commit ?? ctx.baseline?.commit ?? '',
            allowed: decisions.some(d => d.action === 'add' || d.action === 'update'),
            reason: `Install/update plugin ${pluginName}`,
            dirtyFiles: [],
            pluginDecisions: decisions,
            filesToOverwrite: [],
            filesToAdd: [],
            filesToKeep: [],
            dryRun,
            baselineOnly: false,
            installPlugin: pluginName
        };
        printPlan(plan);

        if (!plan.allowed) {
            writeReceipt(plan, { durationMs: 0 });
            return plan;
        }
        if (dryRun) {
            writeReceipt(plan, { durationMs: 0 });
            return plan;
        }

        const toApply = decisions.filter(
            d => d.action === 'add' || d.action === 'update' || d.action === 'remove'
        );
        await this.applyPluginDecisions(ctx.owner, ctx.repo, toApply, force);
        await this.refreshBaselineAfterPlugins(ctx.baseline, toApply);
        log.info(`Plugin ${pluginName} install/update finished.`);
        writeReceipt(plan, { durationMs: 0 });
        return plan;
    }

    private async applyPluginDecisions(
        owner: string,
        repo: string,
        decisions: PluginDecision[],
        _force: boolean
    ): Promise<void> {
        for (const d of decisions) {
            if (d.action === 'remove') {
                for (const rel of [sourcePluginPath(d.pluginId), runtimePluginPath(d.pluginId)]) {
                    const full = path.join(process.cwd(), rel);
                    if (fs.existsSync(full)) {
                        fs.rmSync(full, { recursive: true, force: true });
                        log.info(`Removed plugin ${d.pluginId} → ${rel}`);
                    }
                }
                continue;
            }

            if (!d.selectedPluginTag) continue;

            let pOwner = owner;
            let pRepo = repo;
            if (d.source?.kind === 'external' && d.source.repo) {
                ({ owner: pOwner, repo: pRepo } = GitHubClient.parseRepo(d.source.repo));
            }

            log.info(`Fetching plugin ${d.pluginId} from ${pOwner}/${pRepo}@${d.selectedPluginTag}…`);
            const staging = await this.apply.stageArchive(pOwner, pRepo, d.selectedPluginTag);
            const detected = detectLayout(staging, d.pluginId);
            if (!detected) {
                log.warn(`Tag ${d.selectedPluginTag} has no L1/L2/L3 layout for ${d.pluginId} – skip`);
                continue;
            }

            const destSrc = path.join(process.cwd(), sourcePluginPath(d.pluginId));
            fs.mkdirSync(path.dirname(destSrc), { recursive: true });
            if (fs.existsSync(destSrc)) fs.rmSync(destSrc, { recursive: true, force: true });
            await copyDirRecursive(detected.contentRoot, destSrc);
            log.info(`Applied plugin ${d.pluginId} → ${sourcePluginPath(d.pluginId)} (layout ${detected.layout})`);
            await mirrorPluginToRuntime(d.pluginId);
        }
    }


    private async refreshBaselineAfterPlugins(
        baseline: Baseline | null,
        applied: PluginDecision[]
    ): Promise<void> {
        const files: Record<string, BaselineFileEntry> = baseline ? { ...baseline.files } : {};
        const allLocal = walkLocal().filter(f => !shouldHardExclude(f));
        for (const d of applied) {
            for (const root of [
                (d.localPath || sourcePluginPath(d.pluginId)).replace(/\\/g, '/'),
                (d.runtimePath || runtimePluginPath(d.pluginId)).replace(/\\/g, '/')
            ]) {
                for (const k of Object.keys(files)) {
                    if (k === root || k.startsWith(root + '/')) delete files[k];
                }
                if (d.action === 'remove') continue;
                const pluginFiles = allLocal.filter(f => f === root || f.startsWith(root + '/'));
                Object.assign(files, await computeLocalHashes(pluginFiles));
            }
        }
        writeBaseline({
            tag: baseline?.tag ?? readPackageVersion()?.toString() ?? 'unknown',
            commit: baseline?.commit ?? '',
            timestamp: new Date().toISOString(),
            previousTag: baseline?.previousTag ?? null,
            previousCommit: baseline?.previousCommit ?? null,
            files
        });
    }

    private async runBaselineOnly(ctx: {
        target: TagInfo;
        stagingRoot: string;
        remoteFiles: string[];
        dryRun: boolean;
        force: boolean;
    }): Promise<UpdatePlan> {
        const { target, stagingRoot, remoteFiles, dryRun } = ctx;
        log.info(`Building baseline from nearest tag ${target.name}…`);

        const matching: Record<string, BaselineFileEntry> = {};
        const mismatched: string[] = [];

        for (const rel of remoteFiles) {
            if (shouldHardExclude(rel)) continue;
            const localFull = path.join(process.cwd(), rel);
            const remoteFull = path.join(stagingRoot, rel);
            if (!fs.existsSync(localFull) || !fs.existsSync(remoteFull)) continue;
            try {
                const localResult = await hashFile(localFull);
                const remoteResult = await hashFile(remoteFull);
                if (localResult.hash === remoteResult.hash) {
                    matching[rel] = { hash: localResult.hash, size: localResult.size };
                } else {
                    mismatched.push(rel);
                }
            } catch { }
        }

        const plan: UpdatePlan = {
            fromTag: null,
            toTag: target.name,
            toCommit: target.commit,
            allowed: true,
            reason: `baseline-only against nearest tag ${target.name}`,
            dirtyFiles: mismatched.map(p => ({
                path: p,
                baselineHash: '',
                currentHash: '',
                category: isPluginPath(p) ? 'plugin' : 'core'
            })),
            pluginDecisions: [],
            filesToOverwrite: [],
            filesToAdd: [],
            filesToKeep: mismatched,
            dryRun,
            baselineOnly: true,
            installPlugin: null
        };
        printPlan(plan);
        if (dryRun) {
            writeReceipt(plan, { durationMs: 0 });
            return plan;
        }

        writeBaseline({
            tag: target.name,
            commit: target.commit,
            timestamp: new Date().toISOString(),
            files: matching
        });
        log.info(`Baseline-only complete for tag ${target.name}`);
        writeReceipt(plan, { durationMs: 0 });
        return plan;
    }
}

export async function runUpdater(options: {
    force?: boolean;
    dryRun?: boolean;
    baselineOnly?: boolean;
    installPlugin?: string | null;
    targetTag?: string | null;
    downgrade?: boolean;
    pluginTag?: string | null;
    listBackups?: boolean;
    restoreBackup?: string | null;
} = {}): Promise<void> {
    const updater = new Updater();
    const plan = await updater.run(options);

    if (!plan.allowed && plan.dirtyFiles.length > 0) process.exitCode = 2;
    else if (!plan.allowed) process.exitCode = plan.installPlugin ? 1 : 0;
    else process.exitCode = 0;
}

export async function checkPendingRollbackOnBoot(): Promise<boolean> {
    const cfg = loadUpdaterConfig();
    const updater = new Updater();

    const applyState = readApplyState();
    if (applyState && applyState.phase !== 'complete') {
        if (!applyState.backupId) {
            log.error(
                `Incomplete apply (phase=${applyState.phase}) has no backupId – manual recovery required`
            );
            return false;
        }
        log.error(
            `Incomplete apply detected (phase=${applyState.phase}) – restoring local backup ${applyState.backupId}`
        );
        try {
            const plan = await updater.run({
                restoreBackup: applyState.backupId,
                dryRun: false
            });
            if (plan.allowed) {
                clearApplyState();
                return true;
            }
            log.error('Restore from incomplete-apply backup did not succeed – marker left for retry');
            return false;
        } catch (e) {
            log.error('Restore from incomplete-apply backup failed – marker left for retry', e);
            return false;
        }
    }

    if (!cfg.autoRollback) return false;

    const pending = readPendingHealth();
    if (!pending || pending.healthy || !pending.previousTag) return false;

    const attempts = (pending.bootAttempts ?? 0) + 1;
    pending.bootAttempts = attempts;
    writePendingHealth(pending);

    const age = Date.now() - new Date(pending.at).getTime();
    const shouldRollback = attempts >= 2 || age >= cfg.healthGraceMs;

    if (!shouldRollback) {
        log.warn(
            `Pending update ${pending.toTag} not yet healthy ` +
            `(boot attempt ${attempts}, age ${Math.round(age / 1000)}s) – continuing boot`
        );
        return false;
    }

    log.error(
        `Auto-rollback on boot: ${pending.toTag} failed health ` +
        `(attempts=${attempts}) → ${pending.previousTag}`
    );
    const pendingBackupId = pending.backupId ?? null;
    clearPendingHealth();
    if (pendingBackupId) {
        try {
            const plan = await updater.run({
                restoreBackup: pendingBackupId,
                dryRun: false
            });
            if (plan.allowed) return true;
            log.error('Local backup restore on boot failed – falling back to network tag');
        } catch (e) {
            log.error('Local backup restore on boot failed – falling back to network tag', e);
        }
    }
    const plan = await updater.run({
        targetTag: pending.previousTag,
        force: true,
        dryRun: false
    });
    return plan.allowed;
}

export function startBackgroundUpdater(opts?: { skipInitial?: boolean }): () => void {
    const cfg = loadUpdaterConfig();
    if (cfg.mode !== 'background' || !cfg.autoUpdater) {
        log.info('Background updater not started (UpdaterMode/AutoUpdater)');
        return () => {};
    }

    const interval = Math.max(60_000, cfg.intervalMs || 6 * 60 * 60 * 1000);
    const skipInitial = opts?.skipInitial === true;
    log.info(
        skipInitial
            ? `Background updater every ${Math.round(interval / 1000)}s (apply=${cfg.backgroundApply}, initial skipped)`
            : `Background updater initial 30s + every ${Math.round(interval / 1000)}s (apply=${cfg.backgroundApply})`
    );

    let stopped = false;
    let running = false;

    const tick = async () => {
        if (stopped || running) return;
        running = true;
        try {
            log.info('Background updater tick…');
            const updater = new Updater();
            const plan = await updater.run({ dryRun: !cfg.backgroundApply });
            log.info(`Background tick done: ${plan.reason}`);
            const coreChanged =
                !!plan.toTag &&
                plan.fromTag !== plan.toTag &&
                (plan.filesToOverwrite.length > 0 || plan.filesToAdd.length > 0);
            const pluginsChanged = plan.pluginDecisions.some(
                d => d.action === 'update' || d.action === 'add' || d.action === 'remove'
            );
            if (cfg.backgroundApply && plan.allowed && !plan.dryRun && (coreChanged || pluginsChanged)) {
                log.info(`Background update applied; exiting for restart`);
                await flushLogs().catch(() => {});
                process.exit(0);
            }
        } catch (e) {
            log.error('Background updater tick failed', e);
        } finally {
            running = false;
        }
    };

    let initial: ReturnType<typeof setTimeout> | null = null;
    if (!skipInitial) {
        initial = setTimeout(() => { void tick(); }, 30_000);
    }
    const handle = setInterval(() => { void tick(); }, interval);
    handle.unref();
    if (initial) initial.unref();

    return () => {
        stopped = true;
        if (initial) clearTimeout(initial);
        clearInterval(handle);
    };
}
