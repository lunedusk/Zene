import { configManager } from '#core/manager/config.js';
import { i18n } from '#core/manager/lang.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('PluginConfigGate');

export interface PluginDisableReason {
    pluginId: string;
    configFiles: string[];
    langFiles: string[];
}

export function getPluginDisableReason(pluginId: string): PluginDisableReason | null {
    const configFiles = [...(configManager.getConfigValidationFailures().get(pluginId) ?? [])];
    const langFiles = [...(i18n.getLangValidationFailures().get(pluginId) ?? [])];
    if (configFiles.length === 0 && langFiles.length === 0) return null;
    return { pluginId, configFiles, langFiles };
}

export function shouldDisablePluginForConfig(pluginId: string): boolean {
    return getPluginDisableReason(pluginId) !== null;
}

export function shouldDisablePlugin(pluginId: string): boolean {
    return shouldDisablePluginForConfig(pluginId);
}

/** Format a structured disable reason into a human-readable diagnostic. */
export function formatPluginDisableReason(reason: PluginDisableReason): string {
    const parts: string[] = [];
    if (reason.configFiles.length) {
        parts.push(
            `config: ${reason.configFiles.map((f) => (f.endsWith('.json5') ? f : f + '.json5')).join(', ')}`,
        );
    }
    if (reason.langFiles.length) {
        parts.push(`lang: ${reason.langFiles.join(', ')}`);
    }
    return (
        `[${reason.pluginId}] Boot SKIPPED – validation failed (${parts.join('; ')}). ` +
        `Fix configuration / configuration/lang files or plugin data/schema|rules.`
    );
}

export function formatPluginDisableMessage(pluginId: string): string {
    const reason = getPluginDisableReason(pluginId);
    if (!reason) return '';
    return formatPluginDisableReason(reason);
}

export function logDisabledPlugins(): void {
    const ids = new Set<string>([
        ...configManager.getConfigValidationFailures().keys(),
        ...i18n.getLangValidationFailures().keys()
    ]);
    for (const pluginId of ids) {
        log.error(formatPluginDisableMessage(pluginId));
    }
}
