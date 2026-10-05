



import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card, EmptyState, ErrorState } from '../design-system/primitives.js';
import { logger } from '../lib/logger.js';
import type { RegistryPlugin } from '../api/dashboardApis.js';

export interface ContributionSurface {
  id: string;
  label?: string;
  path?: string;
  icon?: string;
  kind?: string;
  title?: string;
}

class PluginErrorBoundary extends Component<
  { pluginId: string; surfaceId: string; children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(err: Error): { error: string } {
    return { error: err.message };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    logger.debug('dashboard.plugin.contribution.failed', {
      pluginId: this.props.pluginId,
      surfaceId: this.props.surfaceId,
      reason: error.message,
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorState
          title={`Plugin ${this.props.pluginId} failed`}
          message="This contribution failed in isolation. The rest of the dashboard remains available."
        />
      );
    }
    return this.props.children;
  }
}

export function PluginContributionView({
  plugin,
  surface,
}: {
  plugin: RegistryPlugin;
  surface: ContributionSurface;
}) {
  logger.debug('dashboard.plugin.contribution.resolved', {
    pluginId: plugin.pluginId,
    surfaceId: surface.id,
    kind: surface.kind,
  });

  return (
    <PluginErrorBoundary pluginId={plugin.pluginId} surfaceId={surface.id}>
      <Card title={surface.title ?? surface.label ?? surface.id}>
        <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
          Plugin <code>{plugin.pluginId}</code> · {surface.kind ?? 'surface'} · {surface.id}
        </p>
        {surface.path ? (
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>Path: {surface.path}</p>
        ) : (
          <EmptyState
            title="Contribution shell"
            description="Declarative/hostModule payloads render when the plugin SDK provides them via the registry."
          />
        )}
      </Card>
    </PluginErrorBoundary>
  );
}

export function renderPluginContributions(plugins: RegistryPlugin[]): ReactNode {
  const nodes: ReactNode[] = [];
  for (const plugin of plugins) {
    const surfaces = plugin.surfaces ?? [];
    for (const s of surfaces) {
      nodes.push(
        <PluginContributionView
          key={`${plugin.pluginId}:${s.id}`}
          plugin={plugin}
          surface={s as ContributionSurface}
        />,
      );
    }
  }
  if (nodes.length === 0) {
    return <EmptyState title="No plugin contributions" description="Registry returned no authorized surfaces." />;
  }
  return <>{nodes}</>;
}
