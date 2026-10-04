import { useMemo } from 'react';
import { Stack } from '../../design-system/primitives.js';
import { LayoutGrid } from '../../layout/LayoutGrid.js';
import { createEmptyBreakpoint } from '../../layout/engine.js';
import type { WidgetInstance } from '../../widgets/types.js';
import { renderBuiltinWidget } from '../../widgets/builtin.js';
import { getIdentity } from '../../identity/store.js';
import { logger } from '../../lib/logger.js';

function defaultHomeWidgets(): WidgetInstance[] {
  return [
    {
      instanceId: 'w_welcome',
      widgetId: 'welcome',
      definition: { id: 'welcome', type: 'welcome', title: 'Welcome' },
      col: 0,
      row: 0,
      colSpan: 8,
      rowSpan: 1,
    },
    {
      instanceId: 'w_session',
      widgetId: 'session',
      definition: { id: 'session', type: 'session', title: 'Session' },
      col: 8,
      row: 0,
      colSpan: 4,
      rowSpan: 1,
    },
    {
      instanceId: 'w_status',
      widgetId: 'status',
      definition: { id: 'status', type: 'status', title: 'Status' },
      col: 0,
      row: 1,
      colSpan: 6,
      rowSpan: 1,
    },
    {
      instanceId: 'w_actions',
      widgetId: 'quick-actions',
      definition: { id: 'quick-actions', type: 'quick-actions', title: 'Quick actions' },
      col: 6,
      row: 1,
      colSpan: 6,
      rowSpan: 1,
    },
  ];
}

export function DashboardHomePage() {
  const layout = useMemo(() => {
    const bp = createEmptyBreakpoint('desktop');
    bp.widgets = defaultHomeWidgets();
    logger.debug('dashboard.page.resolve', { page: 'dashboard.home', widgetCount: bp.widgets.length });
    logger.debug('dashboard.layout.load', { surfaceId: 'dashboard.home', breakpoint: 'desktop' });
    return bp;
  }, []);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{getIdentity().botName} — Dashboard</h1>
      <LayoutGrid state={layout} renderWidget={renderBuiltinWidget} />
    </Stack>
  );
}
