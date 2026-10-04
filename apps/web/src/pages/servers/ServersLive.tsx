import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, LoadingState, Stack, Button } from '../../design-system/primitives.js';
import { fetchMyServers, type ServerSummary } from '../../api/dashboardApis.js';
import { logger } from '../../lib/logger.js';
import { DashApiError } from '../../api/types.js';
import { subscribeInvalidation, matchesKey } from '../../realtime/invalidation.js';

export function ServersLivePage() {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    logger.debug('dashboard.table.load', { resource: 'servers' });
    try {
      const list = await fetchMyServers();
      setServers(list);
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Unable to load servers');
      logger.debug('dashboard.table.error', { resource: 'servers' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'servers.list' });
    void load();
    return subscribeInvalidation((keys) => {
      if (matchesKey(keys, 'guild') || matchesKey(keys, 'registry')) {
        logger.debug('dashboard.realtime.reconcile', { resource: 'servers' });
        void load();
      }
    });
  }, []);

  return (
    <Stack gap={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Servers</h1>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>
      {loading ? <LoadingState label="Loading servers…" /> : null}
      {error ? <ErrorState title="Servers unavailable" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && servers.length === 0 ? (
        <EmptyState title="No servers" description="No authorized servers returned by the Dashboard API." />
      ) : null}
      {!loading && servers.length > 0 ? (
        <Stack gap={8}>
          {servers.map((s) => (
            <Card key={s.id}>
              <Link to={`/servers/${s.id}/overview`} style={{ color: 'var(--color-fg)', textDecoration: 'none' }}>
                <strong>{s.name ?? s.id}</strong>
              </Link>
            </Card>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
