import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { logger } from '../../lib/logger.js';

export function OwnerAnalyticsPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    logger.debug('dashboard.table.load', { resource: 'analytics' });
    try {
      const res = (await apiClient.request<Record<string, unknown>>('/admin/analytics/overview')) as Record<
        string,
        unknown
      >;
      setData(res);
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Analytics unavailable');
      logger.debug('dashboard.table.error', { resource: 'analytics' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.analytics' });
    void load();
  }, []);

  return (
    <Stack gap={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Analytics</h1>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState title="Analytics unavailable" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !data ? <EmptyState title="No analytics data" /> : null}
      {data ? (
        <Card>
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
        </Card>
      ) : null}
    </Stack>
  );
}

export function OwnerLogsPage() {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    logger.debug('dashboard.table.load', { resource: 'logs' });
    try {
      const res = await apiClient.request('/admin/logs');
      setData(res);
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Logs unavailable');
      logger.debug('dashboard.table.error', { resource: 'logs' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.logs' });
    void load();
  }, []);

  return (
    <Stack gap={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Logs</h1>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState title="Logs unavailable" message={error} onRetry={() => void load()} /> : null}
      {data ? (
        <Card>
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 480, overflow: 'auto' }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </Card>
      ) : null}
    </Stack>
  );
}
