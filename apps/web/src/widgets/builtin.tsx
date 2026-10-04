import { WidgetFrame } from './WidgetFrame.js';
import { getIdentity } from '../identity/store.js';
import { getSessionState } from '../auth/session.js';
import type { WidgetInstance } from './types.js';
import { logger } from '../lib/logger.js';

export function renderBuiltinWidget(w: WidgetInstance) {
  logger.debug('dashboard.widget.resolve', {
    widgetId: w.widgetId,
    instanceId: w.instanceId,
    type: w.definition.type,
  });
  switch (w.definition.type) {
    case 'welcome':
      return (
        <WidgetFrame title={w.definition.title}>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            Welcome to <strong style={{ color: 'var(--color-fg)' }}>{getIdentity().botName}</strong>.
            Configure layouts and widgets from Owner when authorized.
          </p>
        </WidgetFrame>
      );
    case 'session':
      return (
        <WidgetFrame title={w.definition.title}>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            {getSessionState().user?.username ?? getSessionState().user?.id ?? 'Signed in'}
          </p>
        </WidgetFrame>
      );
    case 'status':
      return (
        <WidgetFrame title={w.definition.title}>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>System status is provided by the Dashboard API when available.</p>
        </WidgetFrame>
      );
    case 'quick-actions':
      return (
        <WidgetFrame title={w.definition.title}>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>Quick actions will bind to authorized Dashboard operations.</p>
        </WidgetFrame>
      );
    default:
      return (
        <WidgetFrame title={w.definition.title || w.widgetId} state="empty" />
      );
  }
}
