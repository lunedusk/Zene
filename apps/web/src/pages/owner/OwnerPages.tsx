import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, Input, Stack } from '../../design-system/primitives.js';
import { EditorSession } from '../../editor/draftStore.js';
import { LayoutGrid } from '../../layout/LayoutGrid.js';
import { addWidget, moveWidget, removeWidget, resizeWidget } from '../../layout/engine.js';
import type { WidgetInstance } from '../../widgets/types.js';
import { renderBuiltinWidget } from '../../widgets/builtin.js';
import { logger } from '../../lib/logger.js';
import { getIdentity } from '../../identity/store.js';
import { NavigationEditorPage } from './NavigationEditorPage.js';
import { PageEditorPage } from './PageEditorPage.js';
import { ThemeEditorFull } from './ThemeEditorFull.js';
import { OwnerJobsPage, OwnerDataRightsPage, OwnerPluginsPage } from './OpsTables.js';
import { PublishingPanel } from './PublishingPanel.js';
import { OwnerAnalyticsPage, OwnerLogsPage } from './AnalyticsLogsPages.js';
import { PropertyInspector } from '../../editor/PropertyInspector.js';
import { PublicSiteEditorPage } from './PublicSiteEditorPage.js';

const OWNER_NAV = [
  { id: 'overview', path: '/owner/overview', label: 'Overview' },
  { id: 'theme', path: '/owner/theme', label: 'Theme' },
  { id: 'layout', path: '/owner/layout', label: 'Layout editor' },
  { id: 'navigation', path: '/owner/navigation', label: 'Navigation' },
  { id: 'pages', path: '/owner/pages', label: 'Pages' },
  { id: 'widgets', path: '/owner/widgets', label: 'Widgets' },
  { id: 'plugins', path: '/owner/plugins', label: 'Plugins' },
  { id: 'analytics', path: '/owner/analytics', label: 'Analytics' },
  { id: 'logs', path: '/owner/logs', label: 'Logs' },
  { id: 'public', path: '/owner/public', label: 'Public site' },
  { id: 'privacy', path: '/owner/privacy', label: 'Privacy' },
  { id: 'data-rights', path: '/owner/data-rights', label: 'Data rights' },
  { id: 'jobs', path: '/owner/jobs', label: 'Jobs' },
  { id: 'security', path: '/owner/security', label: 'Security' },
  { id: 'settings', path: '/owner/settings', label: 'Settings' },
] as const;

function OwnerSubnav({ active }: { active: string }) {
  return (
    <nav aria-label="Owner">
      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
        {OWNER_NAV.map((item) => (
          <li key={item.id}>
            <Link
              to={item.path}
              style={{
                display: 'inline-block',
                padding: '6px 10px',
                borderRadius: 'var(--radius-md)',
                background: active === item.id ? 'var(--color-surface-2)' : 'transparent',
                color: 'var(--color-fg)',
                textDecoration: 'none',
                fontWeight: active === item.id ? 600 : 500,
              }}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function OwnerOverviewPage() {
  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.overview' });
  }, []);
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Owner</h1>
      <OwnerSubnav active="overview" />
      <Card title="Customization">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          Customize {getIdentity().botName} layouts, theme, and navigation. Changes stay in draft until published via the
          Dashboard API.
        </p>
      </Card>
      <PublishingPanel targetKind="layout" targetKey="global" />
    </Stack>
  );
}

export function OwnerThemeEditorPage() {
  const [accent, setAccent] = useState(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#3b6cff');
  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.theme' });
    logger.debug('dashboard.theme.resolve', {});
  }, []);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Theme</h1>
      <OwnerSubnav active="theme" />
      <Card title="Accent">
        <Stack gap={8}>
          <label htmlFor="accent">Accent color</label>
          <Input
            id="accent"
            type="color"
            value={accent.startsWith('#') ? accent : '#3b6cff'}
            onChange={(e) => {
              const v = e.target.value;
              setAccent(v);
              document.documentElement.style.setProperty('--color-accent', v);
              logger.debug('dashboard.theme.apply', { key: 'accent' });
            }}
          />
          <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
            Live preview only. Persist through owner theme API / draft publish.
          </p>
        </Stack>
      </Card>
    </Stack>
  );
}

export function OwnerLayoutEditorPage() {
  const session = useMemo(() => new EditorSession('dashboard.home'), []);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.layout' });
  }, []);

  const bp = session.draft.layout.breakpoints[session.activeBreakpoint];

  const addDemo = () => {
    const widget: WidgetInstance = {
      instanceId: `w_${Date.now()}`,
      widgetId: 'status',
      definition: { id: 'status', type: 'status', title: 'Status' },
      col: 0,
      row: 0,
      colSpan: 4,
      rowSpan: 1,
    };
    const next = addWidget(bp, widget);
    if (next) {
      session.updateBreakpointLayout(next);
      rerender();
    }
  };

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Layout editor</h1>
      <OwnerSubnav active="layout" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={addDemo}>
          Add widget
        </Button>
        <Button
          onClick={() => {
            session.undo();
            rerender();
          }}
          disabled={!session.canUndo}
        >
          Undo
        </Button>
        <Button
          onClick={() => {
            session.redo();
            rerender();
          }}
          disabled={!session.canRedo}
        >
          Redo
        </Button>
        <Button
          onClick={() => {
            session.setMode(session.draft.mode === 'preview' ? 'edit' : 'preview');
            rerender();
          }}
        >
          {session.draft.mode === 'preview' ? 'Exit preview' : 'Preview'}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            // Publish is API-backed; local mark is draft UX only until API wired.
            session.markPublished(`local-${Date.now()}`);
            rerender();
          }}
        >
          Mark published (local)
        </Button>
        {(['desktop', 'tablet', 'mobile'] as const).map((b) => (
          <Button
            key={b}
            variant={session.activeBreakpoint === b ? 'primary' : 'default'}
            onClick={() => {
              session.setBreakpoint(b);
              rerender();
            }}
          >
            {b}
          </Button>
        ))}
      </div>
      <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
        Status: {session.draft.status}
        {session.draft.dirty ? ' · dirty' : ''} · mode: {session.draft.mode}
        {selectedId ? ` · selected: ${selectedId}` : ''}
      </p>
      <LayoutGrid
        state={bp}
        selectedId={selectedId}
        onSelect={setSelectedId}
        renderWidget={renderBuiltinWidget}
      />
      {selectedId ? (
        <Card title="Inspector">
          <Stack gap={8}>
            <PropertyInspector
              selection={{
                kind: 'widget',
                widget: bp.widgets.find((w) => w.instanceId === selectedId)!,
              }}
              onChangeWidget={(next) => {
                const widgets = bp.widgets.map((w) => (w.instanceId === next.instanceId ? next : w));
                session.updateBreakpointLayout({ ...bp, widgets });
                rerender();
              }}
            />
            <Button
              onClick={() => {
                const moved = moveWidget(bp, selectedId, 0, 0);
                if (moved) {
                  session.updateBreakpointLayout(moved);
                  rerender();
                }
              }}
            >
              Move to origin
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                session.updateBreakpointLayout(removeWidget(bp, selectedId));
                setSelectedId(undefined);
                rerender();
              }}
            >
              Delete
            </Button>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

export function OwnerPlaceholderPage({ title, active }: { title: string; active: string }) {
  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: `owner.${active}` });
  }, [active]);
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      <OwnerSubnav active={active} />
      <Card>
        <EmptyState
          title={title}
          description="Bound to authorized Dashboard API surfaces. No fake production data."
        />
      </Card>
    </Stack>
  );
}

export function OwnerRoutePage() {
  const { section = 'overview' } = useParams<{ section?: string }>();
  if (section === 'overview' || !section) return <OwnerOverviewPage />;
  if (section === 'theme') return <ThemeEditorFull />;
  if (section === 'layout') return <OwnerLayoutEditorPage />;
  if (section === 'navigation') return <NavigationEditorPage />;
  if (section === 'pages') return <PageEditorPage />;
  if (section === 'plugins') return <OwnerPluginsPage />;
  if (section === 'data-rights') return <OwnerDataRightsPage />;
  if (section === 'jobs') return <OwnerJobsPage />;
  if (section === 'analytics') return <OwnerAnalyticsPage />;
  if (section === 'logs') return <OwnerLogsPage />;
  if (section === 'public') return <PublicSiteEditorPage />;
  const label = OWNER_NAV.find((n) => n.id === section)?.label ?? section;
  return <OwnerPlaceholderPage title={label} active={section} />;
}

