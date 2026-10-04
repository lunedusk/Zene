export { ServersLivePage as ServersListPage } from './ServersLive.js';
import { Link, useParams } from 'react-router-dom';
import { Card, EmptyState, Stack } from '../../design-system/primitives.js';
import { logger } from '../../lib/logger.js';
import { ServerMembersPage } from './ServerMembersPage.js';
import { ServerRolesPage } from './ServerRolesPage.js';
import { useEffect } from 'react';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'roles', label: 'Roles' },
  { id: 'logs', label: 'Logs' },
  { id: 'audit', label: 'Audit' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
] as const;

function ServersListPageLegacy() {
  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'servers.list' });
  }, []);
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Servers</h1>
      <Card>
        <EmptyState
          title="Server list"
          description="Servers load from GET /api/dash/me/servers when the session is authorized. No unauthorized rows are fetched."
        />
      </Card>
    </Stack>
  );
}

export function ServerSectionPage() {
  const { guildId, section = 'overview' } = useParams<{ guildId: string; section?: string }>();
  useEffect(() => {
    logger.debug('dashboard.page.resolve', {
      page: 'servers.section',
      guildId,
      section,
    });
  }, [guildId, section]);

  if (section === 'members') return <ServerMembersPage />;
  if (section === 'roles') return <ServerRolesPage />;

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Server</h1>
      <nav aria-label="Server sections">
        <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <Link
                to={`/servers/${guildId}/${s.id}`}
                style={{
                  display: 'inline-block',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md)',
                  background: section === s.id ? 'var(--color-surface-2)' : 'transparent',
                  color: 'var(--color-fg)',
                  textDecoration: 'none',
                  fontWeight: section === s.id ? 600 : 500,
                }}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Card title={SECTIONS.find((s) => s.id === section)?.label ?? 'Overview'}>
        <EmptyState
          title="Section data"
          description="Operational tables bind to authorized Dashboard API endpoints. Unauthorized direct URLs follow backend 403/404 policy."
        />
      </Card>
    </Stack>
  );
}
