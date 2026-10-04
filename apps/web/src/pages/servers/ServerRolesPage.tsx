/**
 * Server roles — GET /api/dash/servers/:guildId/roles (or list via permissions surface)
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { logger } from '../../lib/logger.js';

interface RoleRow {
  id: string;
  name?: string;
  color?: number | string;
  position?: number;
  [key: string]: unknown;
}

export function ServerRolesPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError(null);
    logger.debug('dashboard.table.load', { resource: 'roles', guildId });
    try {
      // Prefer guild-scoped roles endpoint when present
      const data = (await apiClient.request<unknown>(`/servers/${encodeURIComponent(guildId)}/roles`)) as unknown;
      const list = Array.isArray(data)
        ? (data as RoleRow[])
        : Array.isArray((data as { items?: RoleRow[] })?.items)
          ? ((data as { items: RoleRow[] }).items)
          : [];
      setRows(list);
    } catch (e) {
      setRows([]);
      setError(e instanceof DashApiError ? e.message : 'Unable to load roles');
      logger.debug('dashboard.table.error', { resource: 'roles', guildId });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'servers.roles', guildId });
    void load();
  }, [guildId]);

  return (
    <Stack gap={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Roles</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/servers/${guildId}/overview`}>Overview</Link>
          <Button onClick={() => void load()}>Refresh</Button>
        </div>
      </div>
      {loading ? <LoadingState label="Loading roles…" /> : null}
      {error ? <ErrorState title="Roles unavailable" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No roles" description="No authorized roles returned for this server." />
      ) : null}
      {rows.length > 0 ? (
        <Card>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li
                key={r.id}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>{r.name ?? r.id}</span>
                <span style={{ color: 'var(--color-muted)', fontFamily: 'monospace', fontSize: 12 }}>{r.id}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Stack>
  );
}
