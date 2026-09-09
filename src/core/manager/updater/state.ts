import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import type {
    ApplyState,
    BackupInfo,
    Baseline,
    PendingHealth,
    UpdatePlan,
    UpdateReceipt,
} from './types.js';
import {
    APPLY_STATE,
    BACKUP_DIR,
    BASELINE,
    ensureDirs,
    PENDING_HEALTH,
    RECEIPTS_DIR,
} from './paths.js';

const log = getLogger('Updater');

export function readPendingHealth(): PendingHealth | null {
    try {
        if (!fs.existsSync(PENDING_HEALTH)) return null;
        return JSON.parse(fs.readFileSync(PENDING_HEALTH, 'utf-8')) as PendingHealth;
    } catch {
        return null;
    }
}

export function writePendingHealth(p: PendingHealth): void {
    ensureDirs();
    fs.writeFileSync(PENDING_HEALTH, JSON.stringify(p, null, 2), 'utf-8');
}

export function clearPendingHealth(): void {
    try {
        if (fs.existsSync(PENDING_HEALTH)) fs.unlinkSync(PENDING_HEALTH);
    } catch {
        /* ignore */
    }
}

export function markUpdaterHealthy(): void {
    const pending = readPendingHealth();
    if (!pending) return;
    pending.healthy = true;
    writePendingHealth(pending);
    clearPendingHealth();
    log.info(`Updater health cleared (boot OK for ${pending.toTag})`);
}

export function readApplyState(): ApplyState | null {
    try {
        if (!fs.existsSync(APPLY_STATE)) return null;
        return JSON.parse(fs.readFileSync(APPLY_STATE, 'utf-8')) as ApplyState;
    } catch {
        return null;
    }
}

export function writeApplyState(state: ApplyState): void {
    ensureDirs();
    fs.writeFileSync(APPLY_STATE, JSON.stringify(state, null, 2), 'utf-8');
}

export function clearApplyState(): void {
    try {
        if (fs.existsSync(APPLY_STATE)) fs.unlinkSync(APPLY_STATE);
    } catch {
        /* ignore */
    }
}

export function readBaseline(): Baseline | null {
    try {
        if (!fs.existsSync(BASELINE)) return null;
        return JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) as Baseline;
    } catch {
        log.warn('Baseline unreadable – treating as missing');
        return null;
    }
}

export function writeBaseline(b: Baseline): void {
    ensureDirs();
    fs.writeFileSync(BASELINE, JSON.stringify(b, null, 2), 'utf-8');
    log.info(`Baseline written for tag ${b.tag}`);
}

function receiptId(at: Date = new Date()): string {
    return at.toISOString().replace(/[:.]/g, '-');
}

function planMode(plan: UpdatePlan): UpdateReceipt['mode'] {
    if (plan.baselineOnly) return 'baseline-only';
    if (plan.installPlugin) return 'install-plugin';
    if (
        plan.filesToOverwrite.length === 0 &&
        plan.filesToAdd.length === 0 &&
        plan.pluginDecisions.some((d) => d.action === 'update' || d.action === 'add')
    ) {
        return 'plugin-only';
    }
    if (plan.toTag || plan.allowed) return 'update';
    return 'other';
}

export function writeReceipt(
    plan: UpdatePlan,
    extra: {
        durationMs: number;
        backupDir?: string | null;
        pendingHealthWritten?: boolean;
        restoredFrom?: string | null;
        depsInstall?: UpdateReceipt['depsInstall'];
        mode?: UpdateReceipt['mode'];
        targetTag?: string | null;
        downgrade?: boolean;
    },
): string {
    ensureDirs();
    const id = receiptId();
    const receipt: UpdateReceipt = {
        schemaVersion: 1,
        id,
        at: new Date().toISOString(),
        durationMs: extra.durationMs,
        mode: extra.mode ?? planMode(plan),
        allowed: plan.allowed,
        dryRun: plan.dryRun,
        reason: plan.reason,
        fromTag: plan.fromTag,
        toTag: plan.toTag,
        toCommit: plan.toCommit,
        installPlugin: plan.installPlugin,
        targetTag: extra.targetTag ?? null,
        downgrade: extra.downgrade ?? false,
        core: {
            overwrite: plan.filesToOverwrite.length,
            add: plan.filesToAdd.length,
            keep: plan.filesToKeep.length,
            dirtyBlocked: plan.dirtyFiles.length,
        },
        plugins: plan.pluginDecisions.map((d) => ({
            id: d.pluginId,
            action: d.action,
            reason: d.reason,
            tag: d.selectedPluginTag,
        })),
        backupDir: extra.backupDir ?? null,
        pendingHealthWritten: extra.pendingHealthWritten ?? false,
        restoredFrom: extra.restoredFrom ?? null,
        depsInstall: extra.depsInstall ?? null,
    };
    const file = path.join(RECEIPTS_DIR, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2), 'utf-8');
    log.info(`Receipt → ${file}`);
    return file;
}

export function listBackupInfos(): BackupInfo[] {
    ensureDirs();
    if (!fs.existsSync(BACKUP_DIR)) return [];
    const out: BackupInfo[] = [];
    for (const name of fs.readdirSync(BACKUP_DIR)) {
        const dir = path.join(BACKUP_DIR, name);
        let st: fs.Stats;
        try {
            st = fs.statSync(dir);
        } catch {
            continue;
        }
        if (!st.isDirectory()) continue;
        const us = name.indexOf('_');
        const tag = us >= 0 ? name.slice(us + 1) : name;
        out.push({
            id: name,
            dir,
            tag,
            createdAt: name.slice(0, Math.max(us, 0)) || name,
            mtimeMs: st.mtimeMs,
            hasCore: fs.existsSync(path.join(dir, 'core')),
            hasPackageJson: fs.existsSync(path.join(dir, 'package.json')),
        });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function listBackups(): BackupInfo[] {
    return listBackupInfos();
}
