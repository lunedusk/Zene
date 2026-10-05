export type DashUiTier = 1 | 2 | 3;

export type DashSurfaceKind =
    | 'page'
    | 'subpage'
    | 'home_widget'
    | 'tab'
    | 'settings_section'
    | 'server_page'
    | 'modal'
    | 'drawer'
    | 'row_action'
    | 'header_badge'
    | 'command_palette'
    | 'toast'
    | 'onboarding_step';

export const DASH_SURFACE_KINDS: readonly DashSurfaceKind[] = [
    'page',
    'subpage',
    'home_widget',
    'tab',
    'settings_section',
    'server_page',
    'modal',
    'drawer',
    'row_action',
    'header_badge',
    'command_palette',
    'toast',
    'onboarding_step',
] as const;

export type BitsMode = 'all' | 'any';

export interface DashVisibilityRule {
    requiredBits?: string[];
    bitsMode?: BitsMode;
    envOwnerOnly?: boolean;
    allowRoleBotOwner?: boolean;
    allowUserIds?: string[];
    denyUserIds?: string[];
    guildIds?: string[];
    denyGuildIds?: string[];
    featureFlag?: string;
    defaultHidden?: boolean;
    readBits?: string[];
    writeBits?: string[];
    memberVisibility?: 'self' | 'moderators' | 'admins' | 'owner' | 'all_permitted';
}

export interface DashThemePrefs {
    inheritTokens?: boolean;
    accent?: string;
    font?: string;
    icon?: string;
    colorScheme?: 'inherit' | 'light' | 'dark';
    customCssPath?: string;
}

export type DashDeclarativePayload =
    | { type: 'config_form'; pluginId?: string; configStem?: string }
    | { type: 'lang_editor'; pluginId?: string; locale?: string }
    | { type: 'stats_cards'; metrics: string[] }
    | { type: 'table'; source: string; columns: Array<{ key: string; label: string }> }
    | { type: 'markdown'; contentKey: string }
    | { type: 'link_out'; url: string; external: true };

export interface DashSurfaceBase {
    id: string;
    kind: DashSurfaceKind;
    tier: DashUiTier;
    title: string;
    description?: string;
    icon?: string;
    order?: number;
    priority?: number;
    visibility?: DashVisibilityRule;
    theme?: DashThemePrefs;
    dashCompat?: string;
    dependencies?: string[];
    settingsSchemaId?: string;
    settingsSchema?: Record<string, unknown>;
    declarative?: DashDeclarativePayload;
    iframe?: {
        entryHtml: string;
        originKey?: string;
    };
    hostModule?: {
        exportName?: string;
        moduleKey: string;
    };
    nav?: {
        sidebar?: boolean;
        group?: string;
        parentSurfaceId?: string;
    };
    inject?: {
        targetPageId?: string;
        targetTableId?: string;
        slot?: string;
    };
}

export interface PluginDashboardManifest {
    schemaVersion: 1;
    pluginId: string;
    label?: string;
    surfaces: DashSurfaceBase[];
    themePresets?: Array<{ id: string; name: string; tokens: Record<string, string> }>;
    dashCompat: string;
}

export type PluginSignedStatus = 'signed' | 'unsigned' | 'failed' | 'bypassed' | 'unknown';

export interface DashSurfaceResolved extends DashSurfaceBase {
    pluginId: string;
    visibleEstimate: boolean;
    blockedReason?: string;
    assetOrigin?: string | null;
    assetEntryUrl?: string | null;
}

export interface DashRegistryPluginEntry {
    pluginId: string;
    signed: PluginSignedStatus;
    unsignedBadge: boolean;
    state: string;
    manifest: PluginDashboardManifest | null;
    surfaces: DashSurfaceResolved[];
}

export interface DashRegistrySnapshot {
    version: number;
    generatedAt: number;
    assetOrigin: string;
    plugins: DashRegistryPluginEntry[];
}



export type DashSdkSchemaVersion = 1 | 2;

/** External registry surface — no internal diagnostics. */
export interface DashSurfaceExternal {
    id: string;
    kind: DashSurfaceKind;
    tier: DashUiTier;
    title: string;
    description?: string;
    icon?: string;
    order?: number;
    priority?: number;
    pluginId: string;
    nav?: DashSurfaceBase['nav'];
    inject?: DashSurfaceBase['inject'];
    theme?: DashThemePrefs;
    dashCompat?: string;
    dependencies?: string[];
    settingsSchemaId?: string;
    declarative?: DashDeclarativePayload;
    iframe?: DashSurfaceBase['iframe'];
    hostModule?: DashSurfaceBase['hostModule'];
    /** Read/write hints for clients — never a security boundary. */
    access?: 'read' | 'write' | 'none';
    assetOrigin?: string | null;
    assetEntryUrl?: string | null;
}

export interface DashRegistryPluginExternal {
    pluginId: string;
    signed: PluginSignedStatus;
    unsignedBadge: boolean;
    state: string;
    label?: string;
    surfaces: DashSurfaceExternal[];
}

export interface DashRegistryExternalSnapshot {
    registrySchemaVersion: 2;
    version: number;
    generatedAt: number;
    assetOrigin: string;
    plugins: DashRegistryPluginExternal[];
}

/** Internal-only diagnostics (separate capability). */
export interface DashSurfaceDiagnostic {
    pluginId: string;
    surfaceId: string;
    visibleEstimate: boolean;
    blockedReason?: string;
    requiredBits?: string[];
}

export interface DashRegistryDiagnostics {
    registrySchemaVersion: 2;
    version: number;
    generatedAt: number;
    surfaces: DashSurfaceDiagnostic[];
}

/**
 * Normalize a V1 plugin dashboard manifest into the canonical shape used internally.
 * Rejects invalid structure; preserves valid V1 fields.
 */
export function normalizePluginDashboardManifest(
    raw: unknown,
    pluginId: string,
): PluginDashboardManifest | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const m = raw as Record<string, unknown>;
    const schemaVersion = m.schemaVersion;
    if (schemaVersion !== 1 && schemaVersion !== 2) return null;
    if (!Array.isArray(m.surfaces)) return null;
    const surfaces: DashSurfaceBase[] = [];
    for (const item of m.surfaces) {
        if (!item || typeof item !== 'object') continue;
        const s = item as Record<string, unknown>;
        if (typeof s.id !== 'string' || !s.id) continue;
        if (typeof s.kind !== 'string' || !(DASH_SURFACE_KINDS as readonly string[]).includes(s.kind)) continue;
        if (typeof s.tier !== 'number' || (s.tier !== 1 && s.tier !== 2 && s.tier !== 3)) continue;
        if (typeof s.title !== 'string' || !s.title) continue;
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
        dashCompat: typeof m.dashCompat === 'string' ? m.dashCompat : '1',
    };
}

/** Project an internal resolved surface to the browser-safe external shape. */
export function toExternalSurface(s: DashSurfaceResolved): DashSurfaceExternal {
    return {
        id: s.id,
        kind: s.kind,
        tier: s.tier,
        title: s.title,
        description: s.description,
        icon: s.icon,
        order: s.order,
        priority: s.priority,
        pluginId: s.pluginId,
        nav: s.nav,
        inject: s.inject,
        theme: s.theme,
        dashCompat: s.dashCompat,
        dependencies: s.dependencies,
        settingsSchemaId: s.settingsSchemaId,
        declarative: s.declarative,
        iframe: s.iframe,
        hostModule: s.hostModule,
        assetOrigin: s.assetOrigin,
        assetEntryUrl: s.assetEntryUrl,
        access: s.visibleEstimate ? 'read' : 'none',
    };
}



export type VisibilityLeaf =
    | { type: 'bit'; bit: string }
    | { type: 'owner' }
    | { type: 'user'; userId: string }
    | { type: 'guild'; guildId: string }
    | { type: 'featureFlag'; flag: string }
    | { type: 'pluginEnabled'; pluginId: string }
    | { type: 'crossHostEnabled' }
    | { type: 'runtime'; key: string; equals?: string };

export type VisibilityExpr =
    | VisibilityLeaf
    | { type: 'and'; of: VisibilityExpr[] }
    | { type: 'or'; of: VisibilityExpr[] }
    | { type: 'not'; of: VisibilityExpr };

export interface WidgetAuthHints {
    read?: string[];
    write?: string[];
}

export interface DashSurfaceV2Extensions {
    visibilityExpr?: VisibilityExpr;
    widgetAuth?: WidgetAuthHints;
}

/** Evaluate visibility expression for UX hints only — never final authorization. */
export function evalVisibilityExpr(
    expr: VisibilityExpr,
    ctx: {
        bits: ReadonlySet<string>;
        isOwner: boolean;
        userId: string;
        guildId?: string;
        featureFlags?: ReadonlySet<string>;
        enabledPlugins?: ReadonlySet<string>;
        crossHostEnabled?: boolean;
        runtime?: Record<string, string>;
    },
): boolean {
    switch (expr.type) {
        case 'bit':
            return ctx.bits.has(expr.bit) || ctx.bits.has('bot.owner') || ctx.isOwner;
        case 'owner':
            return ctx.isOwner || ctx.bits.has('bot.owner');
        case 'user':
            return ctx.userId === expr.userId;
        case 'guild':
            return ctx.guildId === expr.guildId;
        case 'featureFlag':
            return ctx.featureFlags?.has(expr.flag) === true;
        case 'pluginEnabled':
            return ctx.enabledPlugins?.has(expr.pluginId) === true;
        case 'crossHostEnabled':
            return ctx.crossHostEnabled === true;
        case 'runtime':
            return ctx.runtime?.[expr.key] === (expr.equals ?? 'true');
        case 'and':
            return expr.of.every((e) => evalVisibilityExpr(e, ctx));
        case 'or':
            return expr.of.some((e) => evalVisibilityExpr(e, ctx));
        case 'not':
            return !evalVisibilityExpr(expr.of, ctx);
        default:
            return false;
    }
}
