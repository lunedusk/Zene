



import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { logger } from '../../lib/logger.js';
import { subscribeInvalidation, matchesKey } from '../../realtime/invalidation.js';

interface MemberRow {
  id: string;
  username?: string;
  displayName?: string;
  nickname?: string | null;
  roles?: string[];
  [key: string]: unknown;
}

interface PaginatedMembers {
  items?: MemberRow[];
  data?: MemberRow[];
  total?: number;
  page?: number;
  limit?: number;
}

export function ServerMembersPage() {
  const { guildId = '' } = useParams<{ guildId: string }>();
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  async function load(p = page) {
    if (!guildId) return;
    setLoading(true);
    setError(null);
    const started = Date.now();
    logger.debug('dashboard.table.load', { resource: 'members', guildId, page: p });
    try {
      const data = (await apiClient.request<PaginatedMembers>(`/servers/${encodeURIComponent(guildId)}/members`, {
        query: { page: p, limit: 25 },
      })) as PaginatedMembers;
      const list = data.items ?? data.data ?? (Array.isArray(data) ? (data as MemberRow[]) : []);
      setRows(list);
      setTotal(typeof data.total === 'number' ? data.total : list.length);
      logger.debug('dashboard.table.load', {
        resource: 'members',
        guildId,
        durationMs: Date.now() - started,
        count: list.length,
      });
    } catch (e) {
      setRows([]);
      setError(e instanceof DashApiError ? e.message : 'Unable to load members');
      logger.debug('dashboard.table.error', { resource: 'members', guildId });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'servers.members', guildId });
    void load(1);
    return subscribeInvalidation((keys) => {
      if (matchesKey(keys, 'guild') || matchesKey(keys, `guild:${guildId}`)) {
        logger.debug('dashboard.realtime.reconcile', { resource: 'members', guildId });
        void load(page);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);


  async function memberAction(userId: string, action: 'kick' | 'ban' | 'mute') {
    if (!window.confirm(`Confirm ${action} for user ${userId}?`)) return;
    try {
      await apiClient.request(`/servers/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/${action}`, {
        method: 'POST',
        body: {},
      });
      logger.debug('dashboard.table.action', { resource: 'members', action, guildId });
      void load(page);
    } catch (e) {
      logger.debug('dashboard.table.error', {
        resource: 'members',
        action,
        reason: e instanceof DashApiError ? e.message : 'failed',
      });
      window.alert(e instanceof DashApiError ? e.message : `${action} failed`);
    }
  }

  return (
    <Stack gap={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Members</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/servers/${guildId}/overview`}>Overview</Link>
          <Button onClick={() => void load(page)}>Refresh</Button>
        </div>
      </div>
      {loading ? <LoadingState label="Loading members…" /> : null}
      {error ? <ErrorState title="Members unavailable" message={error} onRetry={() => void load(page)} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No members" description="No authorized members returned for this server." />
      ) : null}
      {!loading && rows.length > 0 ? (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-muted)' }}>
                <th style={{ padding: '8px 4px' }}>User</th>
                <th style={{ padding: '8px 4px' }}>ID</th>
                <th style={{ padding: '8px 4px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '8px 4px' }}>{m.displayName ?? m.nickname ?? m.username ?? '—'}</td>
                  <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 12 }}>{m.id}</td>
                  <td style={{ padding: '8px 4px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Button onClick={() => void memberAction(m.id, 'kick')}>Kick</Button>
                      <Button onClick={() => void memberAction(m.id, 'ban')}>Ban</Button>
                      <Button onClick={() => void memberAction(m.id, 'mute')}>Mute</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <Button
              disabled={page <= 1}
              onClick={() => {
                const next = page - 1;
                setPage(next);
                void load(next);
              }}
            >
              Previous
            </Button>
            <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
              Page {page} · {total} total
            </span>
            <Button
              disabled={rows.length < 25}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void load(next);
              }}
            >
              Next
            </Button>
          </div>
        </Card>
      ) : null}
    </Stack>
  );
}
