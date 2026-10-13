import fs from 'node:fs';
import path from 'node:path';
import { getUpdaterConfig } from '#core/manager/updater/index.js';
import type { Baseline, UpdateReceipt, ApplyState } from '#core/manager/updater/types.js';

export interface UpdaterStatusDto {
    coreVersion: string;
    baselineTag: string | null;
    baselineCommit: string | null;
    availableTag: string | null;
    availableCommit: string | null;
    updateAvailable: boolean;
    lastCheckAt: number | null;
    lastApply: {
        at: number;
        fromTag: string | null;
        toTag: string | null;
        outcome: 'success' | 'fail' | 'unknown';
        phase: string | null;
    } | null;
    backgroundApplyEnabled: boolean;
    message: string | null;
    mode: 'combined' | 'standalone_metadata';
}

const STATE_DIR = path.join(process.cwd(), '.data', 'updater');
const BASELINE_PATH = path.join(STATE_DIR, 'baseline.json');
const RECEIPTS_DIR = path.join(STATE_DIR, 'receipts');
const APPLY_STATE_PATH = path.join(STATE_DIR, 'apply-state.json');

function readJsonFile<T>(file: string): T | null {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

function corePackageVersion(): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
            version?: string;
        };
        return pkg.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function latestReceipt(): UpdateReceipt | null {
    try {
        if (!fs.existsSync(RECEIPTS_DIR)) return null;
        const files = fs
            .readdirSync(RECEIPTS_DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({
                f,
                m: fs.statSync(path.join(RECEIPTS_DIR, f)).mtimeMs,
            }))
            .sort((a, b) => b.m - a.m);
        if (files.length === 0) return null;
        return readJsonFile<UpdateReceipt>(path.join(RECEIPTS_DIR, files[0].f));
    } catch {
        return null;
    }
}

function parseIsoToUnix(iso: string | undefined | null): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return Math.floor(t / 1000);
}

export function buildUpdaterStatusDto(): UpdaterStatusDto {
    const coreVersion = corePackageVersion();
    const baseline = readJsonFile<Baseline>(BASELINE_PATH);
    const receipt = latestReceipt();
    const applyState = readJsonFile<ApplyState>(APPLY_STATE_PATH);

    let backgroundApplyEnabled = false;
    let message: string | null = null;
    let mode: UpdaterStatusDto['mode'];

    try {
        const cfg = getUpdaterConfig();
        backgroundApplyEnabled = cfg.backgroundApply === true;
        mode = 'combined';
    } catch {
        mode = 'standalone_metadata';
        message = 'Updater config unavailable; reporting package metadata only';
    }

    const availableTag: string | null = null;
    const availableCommit: string | null = null;
    const updateAvailable = false;
    const lastCheckAt: number | null = null;

    let lastApply: UpdaterStatusDto['lastApply'] = null;
    if (receipt) {
        const outcome: 'success' | 'fail' | 'unknown' = receipt.allowed
            ? receipt.dryRun
                ? 'unknown'
                : 'success'
            : 'fail';
        lastApply = {
            at: parseIsoToUnix(receipt.at) ?? 0,
            fromTag: receipt.fromTag,
            toTag: receipt.toTag,
            outcome,
            phase: applyState?.phase ?? (receipt.dryRun ? 'dry_run' : 'complete'),
        };
    } else if (applyState) {
        lastApply = {
            at: parseIsoToUnix(applyState.startedAt) ?? 0,
            fromTag: applyState.fromTag,
            toTag: applyState.toTag,
            outcome: applyState.phase === 'complete' ? 'success' : 'unknown',
            phase: applyState.phase,
        };
    }

    if (!baseline && mode === 'combined') {
        message = message ?? 'No updater baseline yet (run CLI updater or baseline-only)';
    }

    return {
        coreVersion,
        baselineTag: baseline?.tag ?? null,
        baselineCommit: baseline?.commit ?? null,
        availableTag,
        availableCommit,
        updateAvailable,
        lastCheckAt,
        lastApply,
        backgroundApplyEnabled,
        message,
        mode,
    };
}
