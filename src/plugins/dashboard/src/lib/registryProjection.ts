




import type {
    DashRegistryDiagnostics,
    DashRegistryExternalSnapshot,
    DashRegistryPluginExternal,
    DashRegistrySnapshot,
    DashSurfaceDiagnostic,
    DashSurfaceExternal,
} from '#core/types/dashSdk.js';





export function projectExternalRegistry(snapshot: DashRegistrySnapshot): DashRegistryExternalSnapshot {
    const plugins: DashRegistryPluginExternal[] = [];
    for (const p of snapshot.plugins) {
        const surfaces: DashSurfaceExternal[] = p.surfaces
            .filter((s) => s.visibleEstimate)
            .map((s) => ({
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
                access: 'read' as const,
            }));
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




export function projectRegistryDiagnostics(snapshot: DashRegistrySnapshot): DashRegistryDiagnostics {
    const surfaces: DashSurfaceDiagnostic[] = [];
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
