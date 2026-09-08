import type { UpdatePlan } from './types.js';
import { getLogger } from '#core/utils/logger.js';
import { loadUpdaterConfig } from './config.js';

const log = getLogger('Updater');

export function emptyPlan(
    reason: string,
    baselineOnly = false,
    installPlugin: string | null = null,
    dryRun?: boolean,
): UpdatePlan {
    const cfgDry = dryRun ?? loadUpdaterConfig().dryRun;
    return {
        fromTag: null,
        toTag: '',
        toCommit: '',
        allowed: false,
        reason,
        dirtyFiles: [],
        pluginDecisions: [],
        filesToOverwrite: [],
        filesToAdd: [],
        filesToKeep: [],
        dryRun: cfgDry,
        baselineOnly,
        installPlugin,
    };
}

export function printPlan(plan: UpdatePlan): void {
    log.info('── Plan ─────────────────────────────────────');
    log.info(
        `  Mode        : ${plan.baselineOnly ? 'baseline-only' : plan.installPlugin ? 'install-plugin' : 'update'}`,
    );
    log.info(`  From        : ${plan.fromTag ?? '(none)'}`);
    log.info(`  To / Against: ${plan.toTag || '(n/a)'}`);
    log.info(`  Reason      : ${plan.reason}`);
    log.info(`  Core overwrite/add: ${plan.filesToOverwrite.length}/${plan.filesToAdd.length}`);
    if (plan.pluginDecisions.length) {
        log.info('  Plugins:');
        for (const d of plan.pluginDecisions) {
            log.info(
                `    [${d.action}] ${d.pluginId} – ${d.reason}${d.selectedPluginTag ? ` @ ${d.selectedPluginTag}` : ''}`,
            );
        }
    }
    log.info('────────────────────────────────────────────');
}
