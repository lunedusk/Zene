import fs from 'node:fs/promises';
import path from 'node:path';
import { pluginManager as coreLoader } from '#core/loader/index.js';
import { eventBus } from '#core/manager/events/EventBus.js';
import { secrets } from '#core/helpers/secretManager.js';
import {
    DASH_SURFACE_KINDS,
    type DashRegistrySnapshot,
    type DashSurfaceBase,
    type DashSurfaceKind,
    type DashSurfaceResolved,
    type DashUiTier,
    type PluginDashboardManifest,
    type PluginSignedStatus,
} from '#core/types/dashSdk.js';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('DashRegistry');

const KIND_SET = new Set<string>(DASH_SURFACE_KINDS);
const TIER_SET = new Set<number>([1, 2, 3]);

const REGISTRY_EVENT = 'dash.registry.updated';

let registryVersion = 1;
let cachedSnapshot: DashRegistrySnapshot | null = null;

export function getPluginAssetsOrigin(): string {
    const fromEnv = secrets.getOptional('PluginAssetsOrigin', '')?.trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const port = secrets.getOptional('APIPort', '3000') || '3000';
    return `http://plugin-assets.localhost:${port}`;
}

function isValidTier(v: unknown): v is DashUiTier {
    return typeof v === 'number' && TIER_SET.has(v);
}

function isValidKind(v: unknown): v is DashSurfaceKind {
    return typeof v === 'string' && KIND_SET.has(v);
}

function normalizeManifest(raw: unknown, pluginId: string): PluginDashboardManifest | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const m = raw as Record<string, unknown>;
    if (m.schemaVersion !== 1) {
        log.warn(`[${pluginId}] dashboard manifest rejected: schemaVersion must be 1`);
        return null;
    }
    if (!Array.isArray(m.surfaces)) {
        log.warn(`[${pluginId}] dashboard manifest rejected: surfaces must be an array`);
        return null;
    }
    const surfaces: DashSurfaceBase[] = [];
    for (const item of m.surfaces) {
        if (!item || typeof item !== 'object') continue;
        const s = item as Record<string, unknown>;
        if (typeof s.id !== 'string' || !s.id) {
            log.warn(`[${pluginId}] surface missing id — dropped`);
            continue;
        }
        if (!isValidKind(s.kind)) {
            log.warn(`[${pluginId}] surface ${s.id}: unknown kind — dropped`);
            continue;
        }
        if (!isValidTier(s.tier)) {
            log.warn(`[${pluginId}] surface ${s.id}: unknown tier — dropped`);
            continue;
        }
        if (typeof s.title !== 'string' || !s.title) {
            log.warn(`[${pluginId}] surface ${s.id}: missing title — dropped`);
            continue;
        }
        surfaces.push(s as unknown as DashSurfaceBase);
    }
    return {
        schemaVersion: 1,
        pluginId: typeof m.pluginId === 'string' ? m.pluginId : pluginId,
        label: typeof m.label === 'string' ? m.label : undefined,
        surfaces,
        themePresets: Array.isArray(m.themePresets)
            ? (m.themePresets as PluginDashboardManifest['themePresets'])
            : undefined,
        dashCompat: typeof m.dashCompat === 'string' ? m.dashCompat : '>=1.0.0',
    };
}

async function readDashboardManifest(pluginDir: string, pluginId: string): Promise<PluginDashboardManifest | null> {
    const candidates = [
        path.join(pluginDir, 'dashboard', 'manifest.json'),
        path.join(pluginDir, 'dashboard', 'manifest.json5'),
    ];
    for (const file of candidates) {
        try {
            const raw = await fs.readFile(file, 'utf8');
            const parsed: unknown = JSON.parse(raw);
            return normalizeManifest(parsed, pluginId);
        } catch {
            continue;
        }
    }
    return null;
}

function resolveSigned(pluginId: string): PluginSignedStatus {
    const status = coreLoader.getIntegrityStatus(pluginId);
    if (status === 'signed' || status === 'unsigned' || status === 'failed' || status === 'bypassed') {
        return status;
    }
    return 'unknown';
}

function applySurfaceGate(
    _pluginId: string,
    surface: DashSurfaceBase,
): { surface: DashSurfaceBase | null; blockedReason?: string } {
    if (surface.tier === 1 || surface.tier === 2 || surface.tier === 3) {
        return { surface };
    }
    return { surface: null, blockedReason: 'unknown_tier' };
}

function visibilityEstimate(
    surface: DashSurfaceBase,
    bits: ReadonlySet<string>,
    isEnvOwner: boolean,
    userId: string,
): { visible: boolean; reason?: string } {
    const v = surface.visibility;
    if (!v) return { visible: true };
    if (v.denyUserIds?.includes(userId)) return { visible: false, reason: 'deny_user' };
    if (v.envOwnerOnly && !isEnvOwner && !bits.has('bot.owner')) return { visible: false, reason: 'env_owner_only' };
    if (v.allowUserIds && v.allowUserIds.length > 0 && !v.allowUserIds.includes(userId)) {
        return { visible: false, reason: 'allow_user' };
    }
    if (v.defaultHidden) return { visible: false, reason: 'default_hidden' };
    const required = v.requiredBits ?? [];
    if (required.length === 0) return { visible: true };
    const mode = v.bitsMode ?? 'all';
    if (mode === 'any') {
        const ok = required.some((b) => bits.has(b) || bits.has('bot.owner'));
        return ok ? { visible: true } : { visible: false, reason: 'bits' };
    }
    const ok = required.every((b) => bits.has(b) || bits.has('bot.owner'));
    return ok ? { visible: true } : { visible: false, reason: 'bits' };
}

function assetUrls(
    pluginId: string,
    surface: DashSurfaceBase,
    origin: string,
): { assetOrigin: string | null; assetEntryUrl: string | null } {
    const base = origin.replace(/\/$/, '');
    if (surface.tier === 2 && surface.iframe?.entryHtml) {
        const entry = surface.iframe.entryHtml.replace(/^\//, '');
        return {
            assetOrigin: base,
            assetEntryUrl: `${base}/plugins/${encodeURIComponent(pluginId)}/${entry}`,
        };
    }
    if (surface.tier === 3 && surface.hostModule?.moduleKey) {
        const entry = surface.hostModule.moduleKey.replace(/^\//, '');
        return {
            assetOrigin: base,
            assetEntryUrl: `${base}/plugins/${encodeURIComponent(pluginId)}/${entry}`,
        };
    }
    return { assetOrigin: null, assetEntryUrl: null };
}

export async function buildRegistrySnapshot(filter?: {
    bits?: ReadonlySet<string>;
    userId?: string;
    isEnvOwner?: boolean;
}): Promise<DashRegistrySnapshot> {
    const origin = getPluginAssetsOrigin();
    const bits = filter?.bits ?? new Set<string>();
    const userId = filter?.userId ?? '';
    const isEnvOwner = filter?.isEnvOwner ?? false;

    const plugins: DashRegistrySnapshot['plugins'] = [];

    for (const plugin of coreLoader.listLoadedPlugins()) {
        const pluginId = plugin.manifest.id;
        const signed = resolveSigned(pluginId);
        const dir = coreLoader.getPluginDir(pluginId);
        let manifest: PluginDashboardManifest | null = null;
        if (dir) {
            manifest = await readDashboardManifest(dir, pluginId);
        }
        if (!manifest) {
            plugins.push({
                pluginId,
                signed,
                unsignedBadge: signed !== 'signed',
                state: plugin.state,
                manifest: null,
                surfaces: [],
            });
            continue;
        }

        const surfaces: DashSurfaceResolved[] = [];
        for (const raw of manifest.surfaces) {
            const gated = applySurfaceGate(pluginId, raw);
            if (!gated.surface) {
                log.debug(`[${pluginId}] surface ${raw.id} blocked: ${gated.blockedReason}`);
                continue;
            }
            const vis = visibilityEstimate(gated.surface, bits, isEnvOwner, userId);
            const assets = assetUrls(pluginId, gated.surface, origin);
            surfaces.push({
                ...gated.surface,
                pluginId,
                visibleEstimate: vis.visible,
                blockedReason: gated.blockedReason ?? vis.reason,
                assetOrigin: assets.assetOrigin,
                assetEntryUrl: assets.assetEntryUrl,
            });
        }

        const unsignedBadge = signed !== 'signed';
        plugins.push({
            pluginId,
            signed,
            unsignedBadge,
            state: plugin.state,
            manifest,
            surfaces,
        });
    }

    plugins.sort((a, b) => a.pluginId.localeCompare(b.pluginId));

    const snapshot: DashRegistrySnapshot = {
        version: registryVersion,
        generatedAt: Math.floor(Date.now() / 1000),
        assetOrigin: origin,
        plugins,
    };
    cachedSnapshot = snapshot;
    return snapshot;
}

export function bumpRegistryVersion(reason: string): number {
    registryVersion += 1;
    cachedSnapshot = null;
    log.info(`dash registry version → ${registryVersion} (${reason})`);
    void eventBus
        .emit(REGISTRY_EVENT, { version: registryVersion, reason })
        .catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            log.error(`emit ${REGISTRY_EVENT} failed: ${e.message}`);
        });
    return registryVersion;
}

export function getRegistryVersion(): number {
    return registryVersion;
}

export function getCachedSnapshot(): DashRegistrySnapshot | null {
    return cachedSnapshot;
}

/**
 * Project an internal snapshot to the browser-safe external registry.
 * Unauthorized surfaces are omitted entirely (no visibleEstimate: false leak).
 */
export function projectExternalRegistry(
    snapshot: DashRegistrySnapshot,
): import('#core/types/dashSdk.js').DashRegistryExternalSnapshot {
    const plugins: import('#core/types/dashSdk.js').DashRegistryPluginExternal[] = [];
    for (const p of snapshot.plugins) {
        const surfaces = p.surfaces
            .filter((s) => s.visibleEstimate)
            .map((s) => {
                const { visibleEstimate: _v, blockedReason: _b, ...rest } = s;
                return {
                    id: rest.id,
                    kind: rest.kind,
                    tier: rest.tier,
                    title: rest.title,
                    description: rest.description,
                    icon: rest.icon,
                    order: rest.order,
                    priority: rest.priority,
                    pluginId: rest.pluginId,
                    nav: rest.nav,
                    inject: rest.inject,
                    theme: rest.theme,
                    dashCompat: rest.dashCompat,
                    dependencies: rest.dependencies,
                    settingsSchemaId: rest.settingsSchemaId,
                    declarative: rest.declarative,
                    iframe: rest.iframe,
                    hostModule: rest.hostModule,
                    assetOrigin: rest.assetOrigin,
                    assetEntryUrl: rest.assetEntryUrl,
                    access: 'read' as const,
                };
            });
        if (surfaces.length === 0 && !p.manifest) {
            // Omit plugins with no discoverable surfaces and no manifest from external nav noise
            // unless they are loaded with empty surfaces intentionally — still list plugin shell
            // only when signed state is useful for owners; external users get plugins with surfaces.
            continue;
        }
        if (surfaces.length === 0) continue;
        plugins.push({
            pluginId: p.pluginId,
            signed: p.signed,
            unsignedBadge: p.unsignedBadge,
            state: p.state,
            label: p.manifest?.label,
            surfaces,
        });
    }
    return {
        registrySchemaVersion: 2,
        version: snapshot.version,
        generatedAt: snapshot.generatedAt,
        assetOrigin: snapshot.assetOrigin,
        plugins,
    };
}

/**
 * Diagnostics view — must be gated by dashboard.registry.diagnostics capability.
 */
export function projectRegistryDiagnostics(
    snapshot: DashRegistrySnapshot,
): import('#core/types/dashSdk.js').DashRegistryDiagnostics {
    const surfaces: import('#core/types/dashSdk.js').DashSurfaceDiagnostic[] = [];
    for (const p of snapshot.plugins) {
        for (const s of p.surfaces) {
            surfaces.push({
                pluginId: p.pluginId,
                surfaceId: s.id,
                visibleEstimate: s.visibleEstimate,
                blockedReason: s.blockedReason,
                requiredBits: s.visibility?.requiredBits,
            });
        }
    }
    return {
        registrySchemaVersion: 2,
        version: snapshot.version,
        generatedAt: snapshot.generatedAt,
        surfaces,
    };
}

export { REGISTRY_EVENT };
