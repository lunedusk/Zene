import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { normalizeRegistryPlugins, type RegistryPlugin, createDataRightsRequest } from '../../api/dashboardApis.js';
import { logger } from '../../lib/logger.js';
import { renderPluginContributions } from '../../plugins/contributionRenderer.js';
import { DashApiError } from '../../api/types.js';

export function OwnerJobsPage() {
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.jobs' });
  }, []);

  async function load() {
    if (!jobId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.request(`/jobs/${encodeURIComponent(jobId.trim())}`);
      setJob(data);
      logger.debug('dashboard.table.load', { resource: 'job' });
    } catch (e) {
      setJob(null);
      setError(e instanceof DashApiError ? e.message : 'Job lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Jobs</h1>
      <Card>
        <Stack gap={8}>
          <Input aria-label="Job id" value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="job id" />
          <Button variant="primary" onClick={() => void load()}>
            Load job
          </Button>
        </Stack>
      </Card>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState title="Job unavailable" message={error} /> : null}
      {job ? (
        <Card title="Job">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(job, null, 2)}</pre>
        </Card>
      ) : (
        !loading && !error ? <EmptyState title="No job loaded" description="Enter a job id returned by the Dashboard API." /> : null
      )}
    </Stack>
  );
}

export function OwnerDataRightsPage() {
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.data-rights' });
  }, []);

  async function request(kind: 'export' | 'deletion') {
    setError(null);
    setStatus('Submitting…');
    try {
      const data = await createDataRightsRequest(kind);
      setStatus(`Created ${kind} request`);
      logger.debug('dashboard.table.load', { resource: 'data_rights', kind });
      return data;
    } catch (e) {
      setStatus('');
      setError(e instanceof DashApiError ? e.message : 'Request failed');
    }
  }

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Data rights</h1>
      <Card>
        <Stack gap={8}>
          <Button variant="primary" onClick={() => void request('export')}>
            Request export
          </Button>
          <Button variant="danger" onClick={() => void request('deletion')}>
            Request deletion
          </Button>
          {status ? <p style={{ margin: 0, color: 'var(--color-muted)' }}>{status}</p> : null}
          {error ? <ErrorState title="Request failed" message={error} /> : null}
        </Stack>
      </Card>
    </Stack>
  );
}

export function OwnerPluginsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<RegistryPlugin[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getRegistry();
      const list = normalizeRegistryPlugins(
        data && typeof data === 'object' ? (data as { plugins?: unknown }).plugins : [],
      );
      setPlugins(list);
      logger.debug('dashboard.plugin.surface.load', { count: list.length });
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Registry unavailable');
      logger.debug('dashboard.plugin.surface.failed', {});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.plugins' });
    void load();
  }, []);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Plugins</h1>
      <Button onClick={() => void load()}>Refresh registry</Button>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState title="Registry unavailable" message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && plugins.length === 0 ? (
        <EmptyState title="No plugin surfaces" description="External registry returned no authorized plugin contributions." />
      ) : null}
      {renderPluginContributions(plugins)}
    </Stack>
  );
}
