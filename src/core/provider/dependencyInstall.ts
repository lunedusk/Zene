/**
 * Phase 2A — Wire Phase 1C dependency install backends into the provider registry.
 *
 * Does not replace the specialized DependencyInstallBackend interface; it registers
 * those implementations under category `dependency.install`.
 */

import {
    bunBackend,
    npmBackend,
    type DependencyInstallBackend,
} from '#core/helpers/dependency/backends.js';
import { providerRegistry } from './registry.js';
import type { ProviderRegistration } from './types.js';

export const DEPENDENCY_INSTALL_CATEGORY = 'dependency.install' as const;

/**
 * Seed core dependency-install providers if missing.
 * Default priorities: npm (100) preferred over bun (50) unless env forces bun.
 */
export function seedDependencyInstallProviders(): void {
    if (!providerRegistry.get(DEPENDENCY_INSTALL_CATEGORY, 'npm')) {
        providerRegistry.register({
            id: 'npm',
            category: DEPENDENCY_INSTALL_CATEGORY,
            version: '1.0.0',
            priority: 100,
            trusted: true,
            available: true,
            implementation: npmBackend,
        });
    }
    if (!providerRegistry.get(DEPENDENCY_INSTALL_CATEGORY, 'bun')) {
        providerRegistry.register({
            id: 'bun',
            category: DEPENDENCY_INSTALL_CATEGORY,
            version: '1.0.0',
            priority: 50,
            trusted: true,
            available: true,
            implementation: bunBackend,
        });
    }
}

/**
 * Resolve install backend: explicit env → named provider → highest eligible priority.
 * Falls back to npm implementation if registry empty (tests / early boot).
 */
export function selectDependencyInstallProvider(
    env: NodeJS.ProcessEnv = process.env,
): DependencyInstallBackend {
    seedDependencyInstallProviders();

    const explicit = (
        env.PluginDependencyBackend ||
        env.DependencyBackend ||
        ''
    )
        .trim()
        .toLowerCase();

    if (explicit === 'npm' || explicit === 'bun') {
        const named = providerRegistry.getKnown(
            DEPENDENCY_INSTALL_CATEGORY,
            explicit,
        );
        if (named && providerRegistry.evaluateEligibility(named).eligible) {
            return named.implementation;
        }
        return explicit === 'bun' ? bunBackend : npmBackend;
    }

    const result = providerRegistry.selectKnown(DEPENDENCY_INSTALL_CATEGORY);
    if (result.ok) {
        return result.provider.implementation;
    }
    return npmBackend;
}
