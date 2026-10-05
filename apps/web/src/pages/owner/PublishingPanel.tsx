



import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { logger } from '../../lib/logger.js';

interface OverrideRecord {
  overrideId: string;
  targetKind: string;
  targetKey: string;
  state: string;
  version: number;
  changeSummary?: string;
  authorUserId?: string;
  updatedAt?: number;
  scheduledAt?: number;
}

export function PublishingPanel({
  targetKind = 'layout',
  targetKey = 'global',
}: {
  targetKind?: string;
  targetKey?: string;
}) {
  const [current, setCurrent] = useState<OverrideRecord | null>(null);
  const [versions, setVersions] = useState<OverrideRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [scheduleIso, setScheduleIso] = useState('');
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewExpires, setPreviewExpires] = useState<number | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const cur = (await apiClient.request<OverrideRecord | null>('/owner/overrides/current', {
        query: { targetKind, targetKey },
      })) as OverrideRecord | null;
      setCurrent(cur);
      const vers = (await apiClient.request<OverrideRecord[]>('/owner/overrides/versions', {
        query: { targetKind, targetKey },
      })) as OverrideRecord[];
      setVersions(Array.isArray(vers) ? vers : []);
      logger.debug('dashboard.version.load', { targetKind, targetKey, count: Array.isArray(vers) ? vers.length : 0 });
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Unable to load versions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [targetKind, targetKey]);

  async function ensureDraft(): Promise<string | null> {
    if (current?.overrideId) return current.overrideId;
    const rec = (await apiClient.request<OverrideRecord>('/owner/overrides/draft', {
      method: 'POST',
      body: {
        targetKind,
        targetKey,
        payload: { widgets: [] },
        changeSummary: 'editor draft',
      },
    })) as OverrideRecord;
    setCurrent(rec);
    return rec.overrideId;
  }

  async function publishNow() {
    setStatus('Publishing…');
    try {
      const id = await ensureDraft();
      if (!id) return;
      const rec = (await apiClient.request<OverrideRecord>(`/owner/overrides/${encodeURIComponent(id)}/publish`, {
        method: 'POST',
        body: {},
      })) as OverrideRecord;
      setCurrent(rec);
      setStatus(`Published v${rec.version}`);
      logger.debug('dashboard.publish.publish', { overrideId: id, version: rec.version });
      await reload();
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Publish failed');
      logger.debug('dashboard.publish.failed', { reason: e instanceof Error ? e.message : 'unknown' });
    }
  }

  async function schedule() {
    const at = Date.parse(scheduleIso);
    if (!Number.isFinite(at) || at <= Date.now()) {
      setStatus('Schedule time must be a future ISO datetime');
      return;
    }
    setStatus('Scheduling…');
    try {
      const id = await ensureDraft();
      if (!id) return;
      const rec = (await apiClient.request<OverrideRecord>(`/owner/overrides/${encodeURIComponent(id)}/schedule`, {
        method: 'POST',
        body: { scheduledAt: at },
      })) as OverrideRecord;
      setCurrent(rec);
      setStatus(`Scheduled for ${new Date(at).toISOString()}`);
      logger.debug('dashboard.publish.schedule', { overrideId: id, scheduledAt: at });
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Schedule failed');
    }
  }

  async function cancelSchedule() {
    if (!current?.overrideId) return;
    try {
      const rec = (await apiClient.request<OverrideRecord>(
        `/owner/overrides/${encodeURIComponent(current.overrideId)}/schedule`,
        { method: 'DELETE' },
      )) as OverrideRecord;
      setCurrent(rec);
      setStatus('Schedule cancelled');
      logger.debug('dashboard.publish.cancel', { overrideId: current.overrideId });
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Cancel failed');
    }
  }

  async function createPreview() {
    try {
      const id = await ensureDraft();
      if (!id) return;
      const data = (await apiClient.request<{ token: string; expiresAt: number }>(
        `/owner/overrides/${encodeURIComponent(id)}/preview`,
        { method: 'POST', body: { ttlSeconds: 900 } },
      )) as { token: string; expiresAt: number };
      setPreviewToken(data.token);
      setPreviewExpires(data.expiresAt);
      setStatus('Preview token issued (noindex, expires)');
      window.open(`/preview?token=${encodeURIComponent(data.token)}`, '_blank', 'noopener,noreferrer');
      logger.debug('dashboard.preview.create', { overrideId: id, expiresAt: data.expiresAt });
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Preview failed');
    }
  }

  async function restore(version: number) {
    try {
      const rec = (await apiClient.request<OverrideRecord>('/owner/overrides/restore', {
        method: 'POST',
        body: { targetKind, targetKey, version },
      })) as OverrideRecord;
      setCurrent(rec);
      setStatus(`Restored v${version} into editable state`);
      logger.debug('dashboard.version.restore', { version });
      await reload();
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Restore failed');
    }
  }

  async function rollback(version: number) {
    try {
      const rec = (await apiClient.request<OverrideRecord>('/owner/overrides/rollback', {
        method: 'POST',
        body: { targetKind, targetKey, version },
      })) as OverrideRecord;
      setCurrent(rec);
      setStatus(`Rolled back to published state from v${version}`);
      logger.debug('dashboard.version.rollback', { version });
      await reload();
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Rollback failed');
    }
  }

  if (loading) return <LoadingState label="Loading publish state…" />;
  if (error) return <ErrorState title="Publishing unavailable" message={error} onRetry={() => void reload()} />;

  return (
    <Stack gap={16}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Publish & versions</h2>
      <Card title="Current">
        {current ? (
          <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
            {current.state} · v{current.version}
            {current.scheduledAt ? ` · scheduled ${new Date(current.scheduledAt).toISOString()}` : ''}
          </p>
        ) : (
          <EmptyState title="No override yet" description="Save a draft or publish to create one." />
        )}
      </Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="primary" onClick={() => void publishNow()}>
          Publish now
        </Button>
        <Button onClick={() => void createPreview()}>Create preview</Button>
        <Button onClick={() => void cancelSchedule()} disabled={current?.state !== 'scheduled'}>
          Cancel schedule
        </Button>
      </div>
      <Card title="Schedule">
        <Stack gap={8}>
          <Input
            type="datetime-local"
            aria-label="Schedule time"
            value={scheduleIso}
            onChange={(e) => setScheduleIso(e.target.value)}
          />
          <Button onClick={() => void schedule()}>Schedule publish</Button>
        </Stack>
      </Card>
      {previewToken ? (
        <Card title="Preview token">
          <p style={{ margin: 0, fontSize: 12, wordBreak: 'break-all', color: 'var(--color-muted)' }}>
            Token issued. Use /api/dash/owner/overrides/preview/validate?token=… — robots noindex.
            {previewExpires ? ` Expires ${new Date(previewExpires).toISOString()}` : ''}
          </p>
          <meta name="robots" content="noindex,nofollow" />
        </Card>
      ) : null}
      {status ? <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>{status}</p> : null}
      <Card title="Version history (latest 4 retained)">
        {versions.length === 0 ? (
          <EmptyState title="No versions" />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...versions].reverse().map((v) => (
              <li
                key={`${v.overrideId}-${v.version}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <span style={{ flex: 1, fontSize: 13 }}>
                  v{v.version} · {v.state} · {v.changeSummary ?? '—'}
                </span>
                <Button onClick={() => void restore(v.version)}>Restore</Button>
                <Button variant="primary" onClick={() => void rollback(v.version)}>
                  Rollback
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Stack>
  );
}
